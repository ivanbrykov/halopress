import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPreviewDataState } from '../app/utils/preview-delivery'
import { content, page, schema, schemaActive } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type EndpointHandler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
const authState = vi.hoisted(() => ({ authenticated: true, admin: true, canRead: true }))

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => dbState.current)
}))

vi.mock('../server/utils/auth', () => ({
  getAuthSession: vi.fn(async () => authState.authenticated ? { user: { id: 'admin-1', role: 'admin' } } : null),
  requireAdmin: vi.fn(async () => {
    if (!authState.admin) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: { id: 'admin-1', role: 'admin' } }
  }),
  requireStaff: vi.fn(async () => {
    if (!authState.authenticated) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: { id: 'admin-1', role: 'admin', accountType: 'staff' } }
  })
}))

vi.mock('../server/utils/schema-permission', () => ({
  requireSchemaPermission: vi.fn(async () => {
    if (!authState.canRead) throw Object.assign(new Error('Permission denied'), { statusCode: 403 })
    return { roleKey: 'admin', canRead: true, canWrite: true, canAdmin: true }
  })
}))

vi.stubGlobal('defineEventHandler', (handler: EndpointHandler) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'http://preview.example.com' }))

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let contentPreview: EndpointHandler
let pagePreview: EndpointHandler

function responseEvent(params: Record<string, string>) {
  const headers = new Map<string, unknown>()
  let body = ''
  const response = {
    statusCode: 200,
    statusMessage: '',
    writableEnded: false,
    setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    end(value?: unknown) {
      body = value == null ? '' : String(value)
      response.writableEnded = true
    }
  }
  return {
    event: {
      context: { params },
      node: {
        req: { headers: { host: 'preview.example.com' } },
        res: response
      }
    },
    header: (name: string) => headers.get(name.toLowerCase()),
    status: () => response.statusCode,
    body: () => body
  }
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  const now = new Date('2026-07-13T00:00:00.000Z')
  await fixture.db.insert(schema).values({
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
    registryJson: JSON.stringify({ fields: [], relations: [] }),
    createdAt: now
  })
  await fixture.db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 1, updatedAt: now })
  await fixture.db.insert(content).values({
    id: 'content-draft',
    schemaKey: 'article',
    schemaVersion: 1,
    status: 'draft',
    contentJson: JSON.stringify({ title: 'Working content' }),
    publicPath: '/article/working-content',
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(page).values({
    id: 'page-draft',
    title: 'Working page',
    status: 'draft',
    contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
    publicPath: '/working-page',
    createdAt: now,
    updatedAt: now
  })
  contentPreview = (await import('../server/api/preview/content/[schemaKey]/[id].get')).default as EndpointHandler
  pagePreview = (await import('../server/api/preview/page/[id].get')).default as EndpointHandler
})

beforeEach(() => {
  authState.authenticated = true
  authState.admin = true
  authState.canRead = true
})

afterAll(() => {
  fixture.close()
  vi.unstubAllGlobals()
})

function expectPrivatePreviewHeaders(request: ReturnType<typeof responseEvent>) {
  expect(request.header('cache-control')).toBe('private, no-store')
  expect(request.header('vary')).toBe('Cookie')
  expect(request.header('x-robots-tag')).toBe('noindex, nofollow, noarchive')
}

async function expectFinalizedNotFound(
  handler: EndpointHandler,
  request: ReturnType<typeof responseEvent>,
  statusMessage: string
) {
  await expect(handler(request.event)).resolves.toBeUndefined()
  expect(request.status()).toBe(404)
  expect(JSON.parse(request.body())).toMatchObject({ statusCode: 404, statusMessage })
  expectPrivatePreviewHeaders(request)
}

describe('preview delivery', () => {
  it('uses a non-enumerating 404 while the schema is inactive', async () => {
    await fixture.db.update(schemaActive).set({ status: 'inactive' })
    try {
      await expectFinalizedNotFound(
        contentPreview,
        responseEvent({ schemaKey: 'article', id: 'content-draft' }),
        'Content not found'
      )
    } finally {
      await fixture.db.update(schemaActive).set({ status: 'active' })
    }
  })

  it('returns working content with private noindex headers', async () => {
    const request = responseEvent({ schemaKey: 'article', id: 'content-draft' })
    await expect(contentPreview(request.event)).resolves.toMatchObject({
      id: 'content-draft',
      status: 'draft',
      content: { title: 'Working content' },
      layout: { context: { canonicalPath: '/article/working-content' } }
    })
    expectPrivatePreviewHeaders(request)
  })

  it('returns working pages with private noindex headers', async () => {
    const request = responseEvent({ id: 'page-draft' })
    await expect(pagePreview(request.event)).resolves.toMatchObject({
      id: 'page-draft',
      title: 'Working page',
      status: 'draft',
      layout: { context: { canonicalPath: '/working-page' } }
    })
    expectPrivatePreviewHeaders(request)
  })

  it('does not enumerate content or pages to anonymous callers', async () => {
    authState.authenticated = false
    authState.admin = false
    const contentRequest = responseEvent({ schemaKey: 'article', id: 'content-draft' })
    const pageRequest = responseEvent({ id: 'page-draft' })
    await expectFinalizedNotFound(contentPreview, contentRequest, 'Content not found')
    await expectFinalizedNotFound(pagePreview, pageRequest, 'Page not found')
  })

  it('does not cache authenticated preview permission failures', async () => {
    authState.canRead = false
    authState.admin = false
    const contentRequest = responseEvent({ schemaKey: 'article', id: 'content-draft' })
    const pageRequest = responseEvent({ id: 'page-draft' })
    await expect(contentPreview(contentRequest.event)).rejects.toMatchObject({ statusCode: 403 })
    await expectFinalizedNotFound(pagePreview, pageRequest, 'Page not found')
    expectPrivatePreviewHeaders(contentRequest)
  })

  it('uses the same non-enumerating response for missing preview records', async () => {
    const contentRequest = responseEvent({ schemaKey: 'article', id: 'missing' })
    const pageRequest = responseEvent({ id: 'missing' })
    await expectFinalizedNotFound(contentPreview, contentRequest, 'Content not found')
    await expectFinalizedNotFound(pagePreview, pageRequest, 'Page not found')
  })
})

describe('preview route delivery', () => {
  it('returns successful preview data', () => {
    expect(getPreviewDataState({ id: 'page-1' }, null)).toBe('ready')
  })

  it.each([401, 403, 404])('normalizes access and missing errors (%s) to a non-enumerating 404', (statusCode) => {
    expect(getPreviewDataState(undefined, { statusCode, statusMessage: 'Sensitive detail' })).toBe('not-found')
  })

  it('treats an empty successful response as missing', () => {
    expect(getPreviewDataState(null, null)).toBe('not-found')
  })

  it('preserves operational failures for diagnostics', () => {
    expect(() => getPreviewDataState(undefined, { statusCode: 503, statusMessage: 'Database unavailable' }))
      .toThrow(expect.objectContaining({ statusCode: 503, statusMessage: 'Database unavailable' }))
  })
})
