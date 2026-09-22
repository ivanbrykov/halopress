import { createError } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { settings } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type Handler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
vi.stubGlobal('createError', createError)

function responseEvent(
  path: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {}
) {
  const responseHeaders = new Map<string, unknown>()
  const response = {
    statusCode: 200,
    statusMessage: '',
    writableEnded: false,
    setHeader(name: string, value: unknown) {
      responseHeaders.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    },
    end() {
      response.writableEnded = true
    }
  }
  return {
    event: {
      path,
      context: { params },
      node: {
        req: {
          url: path,
          headers: {
            host: 'press.example.com',
            'x-forwarded-proto': 'https',
            ...headers
          }
        },
        res: response
      }
    },
    header: (name: string) => responseHeaders.get(name.toLowerCase()),
    status: () => response.statusCode
  }
}

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let manifestHandler: Handler
let stylesheetHandler: Handler

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  manifestHandler = (await import('../server/api/delivery/site-theme.get')).default as Handler
  stylesheetHandler = (await import('../server/routes/_halo/theme/v1/[revision].css.get')).default as Handler
})

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
})

afterAll(() => {
  fixture.close()
  dbState.current = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('public Site Theme delivery', () => {
  it('serves a revalidated absolute manifest to anonymous consumers with safe cross-origin headers', async () => {
    const request = responseEvent('/api/delivery/site-theme')
    const manifest = await manifestHandler(request.event)
    expect(manifest).toMatchObject({
      contractVersion: 1,
      siteModeEnabled: false,
      stylesheetUrl: expect.stringMatching(/^https:\/\/press\.example\.com\/_halo\/theme\/v1\/[0-9a-f]{64}\.css$/)
    })
    expect(request.header('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(request.header('access-control-allow-origin')).toBe('*')
    expect(request.header('cross-origin-resource-policy')).toBe('cross-origin')
    expect(request.header('x-content-type-options')).toBe('nosniff')
    expect(request.header('vary')).toContain('X-Forwarded-Proto')
    expect(request.header('etag')).toMatch(/^"sha256-/)

    const conditional = responseEvent('/api/delivery/site-theme', {}, {
      'if-none-match': String(request.header('etag'))
    })
    await expect(manifestHandler(conditional.event)).resolves.toBeUndefined()
    expect(conditional.status()).toBe(304)
  })

  it('serves exact digest CSS with immutable caching, strong validators, and safe CORS', async () => {
    const manifest = await manifestHandler(responseEvent('/api/delivery/site-theme').event)
    const first = responseEvent(new URL(manifest.stylesheetUrl).pathname, {
      'revision.css': `${manifest.stylesheetRevision}.css`
    })
    const css = await stylesheetHandler(first.event)
    expect(css).toContain('--halo-color-primary')
    expect(first.header('content-type')).toBe('text/css; charset=utf-8')
    expect(first.header('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(first.header('access-control-allow-origin')).toBe('*')
    expect(first.header('cross-origin-resource-policy')).toBe('cross-origin')
    expect(first.header('x-content-type-options')).toBe('nosniff')
    expect(first.header('etag')).toMatch(/^"sha256-/)

    const conditional = responseEvent(new URL(manifest.stylesheetUrl).pathname, {
      'revision.css': `${manifest.stylesheetRevision}.css`
    }, { 'if-none-match': String(first.header('etag')) })
    await expect(stylesheetHandler(conditional.event)).resolves.toBeUndefined()
    expect(conditional.status()).toBe(304)
  })

  it('rejects poisoned origins before a first-advertisement snapshot can write', async () => {
    const clean = await createTestSqliteDb()
    const previous = dbState.current
    try {
      dbState.current = clean.db
      await runMigrations(clean.db)
      expect((await clean.db.select().from(settings))
        .filter(row => row.key.startsWith('site.theme.artifact.'))).toHaveLength(0)
      const request = responseEvent('/api/delivery/site-theme', {}, { host: 'evil.example' })
      await expect(manifestHandler(request.event)).rejects.toMatchObject({ statusCode: 400 })
      expect((await clean.db.select().from(settings))
        .filter(row => row.key.startsWith('site.theme.artifact.'))).toHaveLength(0)
    } finally {
      dbState.current = previous
      clean.close()
    }
  })

  it('returns non-cacheable 404s for unknown, malformed, or non-canonical stylesheet paths', async () => {
    const missing = responseEvent(`/_halo/theme/v1/${'f'.repeat(64)}.css`, {
      'revision.css': `${'f'.repeat(64)}.css`
    })
    await expect(stylesheetHandler(missing.event)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Theme stylesheet not found'
    })
    expect(missing.header('cache-control')).toBe('no-store')

    for (const [path, routeValue] of [
      ['/_halo/theme/v1/not-a-digest.css', 'not-a-digest.css'],
      [`/_halo/theme/v1/${'a'.repeat(64)}`, `${'a'.repeat(64)}`],
      [`/_halo/theme/v1/${'a'.repeat(64)}.cssx`, `${'a'.repeat(64)}.cssx`],
      [`/_halo/theme/v1/${'A'.repeat(64)}.css`, `${'A'.repeat(64)}.css`]
    ] as const) {
      const malformed = responseEvent(path, { 'revision.css': routeValue })
      await expect(stylesheetHandler(malformed.event)).rejects.toMatchObject({ statusCode: 404 })
      expect(malformed.header('cache-control')).toBe('no-store')
    }
  })

  it('projects Site mode publicly without exposing the administrator endpoint', async () => {
    await fixture.db.insert(settings).values({
      scope: 'global',
      key: 'site.mode',
      value: JSON.stringify({ version: 1, enabled: true }),
      valueType: 'json',
      isEncrypted: false,
      groupKey: 'site.mode',
      updatedAt: new Date('2026-07-18T00:00:00.000Z')
    }).onConflictDoUpdate({
      target: [settings.scope, settings.key],
      set: { value: JSON.stringify({ version: 1, enabled: true }) }
    })
    const manifest = await manifestHandler(responseEvent('/api/delivery/site-theme').event)
    expect(manifest.siteModeEnabled).toBe(true)
  })
})
