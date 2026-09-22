import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { content, page, publicationRevision, schema, schemaActive } from '../server/db/schema'
import type { SchemaPermission } from '../server/utils/schema-permission'
import { runMigrations } from '../server/utils/install'
import { STANDALONE_DOCUMENT_STYLESHEET_PATH } from '../shared/standalone-document'
import { createTestSqliteDb } from './fixtures/sqlite'

type Handler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
const permissionState = vi.hoisted(() => ({ roleKey: 'anonymous', canRead: true }))
const authState = vi.hoisted(() => ({ authenticated: true, admin: true }))
const renderingCalls = vi.hoisted(() => ({ page: 0, content: 0 }))

vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.mock('../server/utils/schema-permission', () => ({
  getSchemaPermission: vi.fn(async (): Promise<SchemaPermission> => ({
    roleKey: permissionState.roleKey,
    canRead: permissionState.canRead,
    canWrite: false,
    canAdmin: false
  })),
  hasSchemaPermission: (permission: SchemaPermission, action: 'read' | 'write' | 'admin') => {
    if (action === 'read') return permission.canRead || permission.canWrite || permission.canAdmin
    if (action === 'write') return permission.canWrite || permission.canAdmin
    return permission.canAdmin
  },
  requireSchemaPermission: vi.fn(async () => {
    if (!permissionState.canRead) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { roleKey: permissionState.roleKey, canRead: true }
  })
}))
vi.mock('../server/utils/auth', () => ({
  getAuthSession: vi.fn(async () => authState.authenticated ? { user: { id: 'staff-1', accountType: 'staff' } } : null),
  requireStaff: vi.fn(async () => {
    if (!authState.authenticated) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: { id: 'staff-1', accountType: 'staff' } }
  }),
  requireAdmin: vi.fn(async () => {
    if (!authState.admin) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: { id: 'admin-1', accountType: 'staff' } }
  })
}))
vi.mock('../server/utils/standalone-document-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/standalone-document-renderer')>()
  return {
    ...actual,
    createStandalonePageRenderingForEvent(event: any, document: unknown) {
      renderingCalls.page += 1
      return actual.createStandalonePageRenderingForEvent(event, document)
    },
    createStandaloneStructuredRenderingForEvent(event: any, content: Record<string, unknown>, fields: any[]) {
      renderingCalls.content += 1
      return actual.createStandaloneStructuredRenderingForEvent(event, content, fields)
    }
  }
})

vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)

function responseEvent(
  path: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
) {
  const responseHeaders = new Map<string, unknown>()
  let body = ''
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
    end(value?: unknown) {
      body = value == null ? '' : String(value)
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
    status: () => response.statusCode,
    body: () => body
  }
}

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let pageDelivery: Handler
let contentDelivery: Handler
let pagePreview: Handler
let contentPreview: Handler

const rawPublishedPage = {
  type: 'doc',
  customDocumentKey: { preserved: true },
  content: [
    { type: 'paragraph', attrs: { class: 'fixed', onClick: 'alert(1)' }, content: [{ type: 'text', text: 'Published page' }] },
    { type: 'pageBlock', attrs: { component: 'RetiredBlock', props: { keep: true }, custom: 'preserve' } },
    { type: 'pageBlock', attrs: { component: 'pageCard', props: { title: 'Malformed', to: 'javascript:alert(1)' } } },
    { type: 'image', attrs: { src: '/assets/page-image/raw', alt: 'Page image' } }
  ]
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  const now = new Date('2026-07-18T00:00:00.000Z')
  await fixture.db.insert(schema).values([
    {
      schemaKey: 'article',
      version: 1,
      title: 'Article v1',
      astJson: JSON.stringify({ schemaKey: 'article', title: 'Article v1', fields: [] }),
      jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
      registryJson: JSON.stringify({
        schemaKey: 'article',
        version: 1,
        title: 'Article v1',
        listing: { titleFieldKey: 'legacyTitle' },
        fields: [
          { fieldId: 'legacy-title-id', key: 'legacyTitle', kind: 'string' },
          { fieldId: 'legacy-body-id', key: 'legacyBody', kind: 'richtext' }
        ],
        relations: []
      }),
      createdAt: now
    },
    {
      schemaKey: 'article',
      version: 2,
      title: 'Article v2',
      astJson: JSON.stringify({ schemaKey: 'article', title: 'Article v2', fields: [] }),
      jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
      registryJson: JSON.stringify({
        schemaKey: 'article',
        version: 2,
        title: 'Article v2',
        listing: { titleFieldKey: 'currentTitle' },
        fields: [
          { fieldId: 'current-title-id', key: 'currentTitle', kind: 'string' },
          { fieldId: 'current-body-id', key: 'currentBody', kind: 'richtext' }
        ],
        relations: []
      }),
      createdAt: now
    }
  ])
  await fixture.db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 2, updatedAt: now })
  await fixture.db.insert(content).values({
    id: 'article-1',
    schemaKey: 'article',
    schemaVersion: 2,
    status: 'draft',
    contentJson: JSON.stringify({
      currentTitle: 'Working v2',
      currentBody: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Working body v2' }] }] }
    }),
    publishedRevisionId: 'article-revision-v1',
    firstPublishedAt: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(publicationRevision).values({
    id: 'article-revision-v1',
    documentKind: 'content',
    documentId: 'article-1',
    schemaKey: 'article',
    schemaVersion: 1,
    contentJson: JSON.stringify({
      legacyTitle: 'Published v1',
      legacyBody: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          attrs: { class: 'fixed', style: 'position:fixed' },
          content: [{ type: 'text', text: 'Published body v1' }, { type: 'image', attrs: { src: '/assets/article-image/raw' } }]
        }]
      }
    }),
    createdAt: now
  })
  await fixture.db.insert(page).values({
    id: 'portable-page',
    title: 'Working page',
    status: 'draft',
    contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Working page' }] }] }),
    publishedRevisionId: 'page-revision',
    firstPublishedAt: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(publicationRevision).values({
    id: 'page-revision',
    documentKind: 'page',
    documentId: 'portable-page',
    title: 'Published page',
    contentJson: JSON.stringify(rawPublishedPage),
    createdAt: now
  })

  pageDelivery = (await import('../server/api/delivery/page/[id].get')).default as Handler
  contentDelivery = (await import('../server/api/content/[schemaKey]/[id].get')).default as Handler
  pagePreview = (await import('../server/api/preview/page/[id].get')).default as Handler
  contentPreview = (await import('../server/api/preview/content/[schemaKey]/[id].get')).default as Handler
})

beforeEach(() => {
  permissionState.roleKey = 'anonymous'
  permissionState.canRead = true
  authState.authenticated = true
  authState.admin = true
  renderingCalls.page = 0
  renderingCalls.content = 0
  vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
})

afterAll(() => {
  fixture.close()
  dbState.current = null
  vi.unstubAllGlobals()
})

describe('portable Page delivery envelope', () => {
  it('preserves historical raw JSON and renders malformed/retired blocks without throwing', async () => {
    const request = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' })
    const result = await pageDelivery(request.event)

    expect(result.content).toEqual(rawPublishedPage)
    expect(result.rendering).toMatchObject({
      contractVersion: 2,
      stylesheets: [
        `https://press.example.com${STANDALONE_DOCUMENT_STYLESHEET_PATH}`
      ]
    })
    expect(result.rendering).not.toHaveProperty('themeRevision')
    expect(result.rendering).not.toHaveProperty('themeColorMode')
    expect(result.rendering.html).not.toContain('data-halo-color-mode')
    expect(renderingCalls.page).toBe(1)
    expect(result.rendering.html).toContain('src="https://press.example.com/assets/page-image/raw"')
    expect(result.rendering.html.match(/class="halo-block halo-block-fallback"/g)).toHaveLength(2)
    expect(result.rendering.html).not.toContain('fixed')
    expect(result.rendering.html).not.toContain('javascript:')
    expect(request.header('access-control-allow-origin')).toBe('*')
    expect(request.header('x-content-type-options')).toBe('nosniff')
    expect(request.header('etag')).toMatch(/^"sha256-/)
    expect(request.header('vary')).toBe('Cookie, X-Forwarded-Proto')
  })

  it('honors response validators for the canonical rendering projection', async () => {
    const first = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' })
    await pageDelivery(first.event)
    const etag = String(first.header('etag'))
    const conditional = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' }, { 'if-none-match': etag })

    await expect(pageDelivery(conditional.event)).resolves.toBeUndefined()
    expect(conditional.status()).toBe(304)
  })

  it('skips standalone serialization for the Site JSON-only projection', async () => {
    const pageRequest = responseEvent('/api/delivery/page/portable-page?rendering=0', { id: 'portable-page' })
    const contentRequest = responseEvent('/api/content/article/article-1?status=published&includeSchema=1&rendering=0', {
      schemaKey: 'article',
      id: 'article-1'
    })

    const [pageResult, contentResult] = await Promise.all([
      pageDelivery(pageRequest.event),
      contentDelivery(contentRequest.event)
    ])

    expect(pageResult).not.toHaveProperty('rendering')
    expect(contentResult).not.toHaveProperty('rendering')
    expect(renderingCalls).toEqual({ page: 0, content: 0 })
  })

  it('rejects malformed/poisoned Host and forwarding inputs instead of reflecting them', async () => {
    const credentialHost = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' }, { host: 'trusted.example@evil.example' })
    await expect(pageDelivery(credentialHost.event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid public request origin'
    })

    const forwardedHost = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' }, { 'x-forwarded-host': 'evil.example' })
    await expect(pageDelivery(forwardedHost.event)).rejects.toMatchObject({ statusCode: 400 })

    const validHostPoison = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' }, { host: 'evil.example' })
    await expect(pageDelivery(validHostPoison.event)).rejects.toMatchObject({ statusCode: 400 })

    const platformMismatch = responseEvent('/api/delivery/page/portable-page', { id: 'portable-page' })
    platformMismatch.event.web = { request: new Request('https://canonical.example/api/delivery/page/portable-page') }
    await expect(pageDelivery(platformMismatch.event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('portable structured-content delivery envelope', () => {
  it('uses the exact historical schema version that owns the published revision', async () => {
    const request = responseEvent('/api/content/article/article-1?status=published&includeSchema=1', {
      schemaKey: 'article',
      id: 'article-1'
    })
    const result = await contentDelivery(request.event)

    expect(result).toMatchObject({
      schemaVersion: 1,
      schema: { version: 1 },
      content: { legacyTitle: 'Published v1' },
      rendering: { contractVersion: 2 }
    })
    expect(Object.keys(result.rendering.fields)).toEqual(['legacyBody'])
    expect(result.rendering.fields.legacyBody).toMatchObject({
      fieldId: 'legacy-body-id',
      fieldKey: 'legacyBody'
    })
    expect(result.rendering.fields.legacyBody.html).toContain('Published body v1')
    expect(result.rendering.fields.legacyBody.html).toContain('https://press.example.com/assets/article-image/raw')
    expect(result.rendering.fields.currentBody).toBeUndefined()
    expect(request.header('access-control-allow-origin')).toBe('*')
  })

  it('uses the working schema/content for authenticated delivery without wildcard CORS', async () => {
    permissionState.roleKey = 'staff'
    const request = responseEvent('/api/content/article/article-1?includeSchema=1', {
      schemaKey: 'article',
      id: 'article-1'
    })
    const result = await contentDelivery(request.event)

    expect(result).toMatchObject({
      schemaVersion: 2,
      schema: { version: 2 },
      content: { currentTitle: 'Working v2' }
    })
    expect(Object.keys(result.rendering.fields)).toEqual(['currentBody'])
    expect(result.rendering.fields.currentBody.html).toContain('Working body v2')
    expect(request.header('cache-control')).toBe('private, no-store')
    expect(request.header('access-control-allow-origin')).toBeUndefined()
    expect(request.header('etag')).toBeUndefined()
  })
})

describe('portable private preview envelopes', () => {
  it('keeps preview private/no-store and returns version-aligned rendering after authorization', async () => {
    permissionState.roleKey = 'staff'
    const contentRequest = responseEvent('/api/preview/content/article/article-1', {
      schemaKey: 'article',
      id: 'article-1'
    })
    const pageRequest = responseEvent('/api/preview/page/portable-page', { id: 'portable-page' })
    const contentResult = await contentPreview(contentRequest.event)
    const pageResult = await pagePreview(pageRequest.event)

    expect(contentResult).toMatchObject({
      schemaVersion: 2,
      schema: { version: 2 },
      rendering: { contractVersion: 2 }
    })
    expect(Object.keys(contentResult.rendering.fields)).toEqual(['currentBody'])
    expect(pageResult.rendering.html).toContain('Working page')
    for (const request of [contentRequest, pageRequest]) {
      expect(request.header('cache-control')).toBe('private, no-store')
      expect(request.header('x-robots-tag')).toBe('noindex, nofollow, noarchive')
      expect(request.header('access-control-allow-origin')).toBeUndefined()
    }
  })

  it('authorizes before origin-dependent rendering and keeps anonymous failures non-enumerating', async () => {
    authState.authenticated = false
    authState.admin = false
    const contentRequest = responseEvent('/api/preview/content/article/article-1', {
      schemaKey: 'article',
      id: 'article-1'
    }, { host: 'trusted.example@evil.example' })
    const pageRequest = responseEvent('/api/preview/page/portable-page', { id: 'portable-page' }, {
      host: 'trusted.example@evil.example'
    })

    await expect(contentPreview(contentRequest.event)).resolves.toBeUndefined()
    await expect(pagePreview(pageRequest.event)).resolves.toBeUndefined()
    expect(contentRequest.status()).toBe(404)
    expect(pageRequest.status()).toBe(404)
    expect(contentRequest.body()).toContain('Content not found')
    expect(pageRequest.body()).toContain('Page not found')
  })
})
