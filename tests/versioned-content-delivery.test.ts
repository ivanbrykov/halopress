import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  content,
  page,
  publicationRevision,
  schema,
  schemaActive
} from '../server/db/schema'
import type { SchemaPermission } from '../server/utils/schema-permission'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type EndpointHandler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
const permissionState = vi.hoisted(() => ({ roleKey: 'anonymous', canRead: true }))

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => dbState.current)
}))

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
  }
}))

vi.stubGlobal('defineEventHandler', (handler: EndpointHandler) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'http://delivery.example.com' }))

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let detailHandler: EndpointHandler

function responseEvent(path: string, schemaKey = 'article', id = 'article-1') {
  const headers = new Map<string, unknown>()
  return {
    path,
    context: { params: { schemaKey, id } },
    node: {
      req: { headers: { host: 'delivery.example.com' } },
      res: {
        setHeader(name: string, value: unknown) {
          headers.set(name.toLowerCase(), value)
        },
        getHeader(name: string) {
          return headers.get(name.toLowerCase())
        }
      }
    },
    header(name: string) {
      return headers.get(name.toLowerCase())
    }
  }
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  const now = new Date('2026-07-13T00:00:00.000Z')
  await fixture.db.insert(schema).values([
    {
      schemaKey: 'article',
      version: 1,
      title: 'Article v1',
      astJson: JSON.stringify({ schemaKey: 'article', title: 'Article v1', fields: [] }),
      jsonSchema: JSON.stringify({
        type: 'object',
        properties: { legacyTitle: { type: 'string' } },
        required: ['legacyTitle']
      }),
      registryJson: JSON.stringify({
        schemaKey: 'article',
        version: 1,
        title: 'Article v1',
        listing: { titleFieldKey: 'legacyTitle' },
        fields: [{ fieldId: 'title-field', key: 'legacyTitle', kind: 'string' }],
        relations: []
      }),
      createdAt: now
    },
    {
      schemaKey: 'article',
      version: 2,
      title: 'Article v2',
      astJson: JSON.stringify({ schemaKey: 'article', title: 'Article v2', fields: [] }),
      jsonSchema: JSON.stringify({
        type: 'object',
        properties: { currentTitle: { type: 'string' } },
        required: ['currentTitle']
      }),
      registryJson: JSON.stringify({
        schemaKey: 'article',
        version: 2,
        title: 'Article v2',
        listing: { titleFieldKey: 'currentTitle' },
        fields: [{ fieldId: 'title-field', key: 'currentTitle', kind: 'string' }],
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
    contentJson: JSON.stringify({ currentTitle: 'Working v2' }),
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
    contentJson: JSON.stringify({ legacyTitle: 'Published v1' }),
    createdAt: now
  })

  detailHandler = (await import('../server/api/content/[schemaKey]/[id].get')).default as EndpointHandler
})

afterAll(() => {
  fixture.close()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  permissionState.roleKey = 'anonymous'
  permissionState.canRead = true
})

describe('versioned content delivery', () => {
  it('bundles the published revision schema and uses it for listing fallback', async () => {
    const event = responseEvent('/api/content/article/article-1?includeSchema=1')
    const result = await detailHandler(event)

    expect(result).toMatchObject({
      schemaVersion: 1,
      title: 'Published v1',
      status: 'published',
      content: { legacyTitle: 'Published v1' },
      schema: {
        version: 1,
        registry: { listing: { titleFieldKey: 'legacyTitle' } }
      }
    })
    expect(event.header('cache-control')).toContain('public')
  })

  it('bundles the working schema for authenticated draft reads', async () => {
    permissionState.roleKey = 'user'
    const event = responseEvent('/api/content/article/article-1?includeSchema=1')
    const result = await detailHandler(event)

    expect(result).toMatchObject({
      schemaVersion: 2,
      title: 'Working v2',
      status: 'draft',
      content: { currentTitle: 'Working v2' },
      schema: { version: 2 }
    })
    expect(event.header('cache-control')).toBe('private, no-store')
  })

  it('does not expose historical schema data without read permission', async () => {
    permissionState.canRead = false
    await expect(detailHandler(responseEvent('/api/content/article/article-1?includeSchema=1')))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('blocks legacy p fallback only when a standalone page row claims the route', async () => {
    const now = new Date('2026-07-13T01:00:00.000Z')
    await fixture.db.insert(schema).values({
      schemaKey: 'p',
      version: 1,
      title: 'Legacy Pages',
      astJson: JSON.stringify({ schemaKey: 'p', title: 'Legacy Pages', fields: [] }),
      jsonSchema: JSON.stringify({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title']
      }),
      registryJson: JSON.stringify({
        schemaKey: 'p',
        version: 1,
        title: 'Legacy Pages',
        listing: { titleFieldKey: 'title' },
        fields: [{ fieldId: 'title-field', key: 'title', kind: 'string' }],
        relations: []
      }),
      createdAt: now
    })
    await fixture.db.insert(schemaActive).values({ schemaKey: 'p', activeVersion: 1, updatedAt: now })
    await fixture.db.insert(content).values({
      id: 'legacy-route',
      schemaKey: 'p',
      schemaVersion: 1,
      status: 'published',
      contentJson: JSON.stringify({ title: 'Legacy route' }),
      publishedRevisionId: 'legacy-route-revision',
      firstPublishedAt: now,
      publishedAt: now,
      createdAt: now,
      updatedAt: now
    })
    await fixture.db.insert(publicationRevision).values({
      id: 'legacy-route-revision',
      documentKind: 'content',
      documentId: 'legacy-route',
      schemaKey: 'p',
      schemaVersion: 1,
      contentJson: JSON.stringify({ title: 'Legacy route' }),
      createdAt: now
    })

    await expect(detailHandler(responseEvent(
      '/api/content/p/legacy-route?status=published&routeScope=public-page&includeSchema=1',
      'p',
      'legacy-route'
    ))).resolves.toMatchObject({ id: 'legacy-route', title: 'Legacy route' })

    await fixture.db.insert(page).values({
      id: 'legacy-route',
      title: 'Unpublished standalone page',
      status: 'draft',
      contentJson: JSON.stringify({ type: 'doc', content: [] }),
      createdAt: now,
      updatedAt: now
    })

    await expect(detailHandler(responseEvent(
      '/api/content/p/legacy-route?status=published&routeScope=public-page&includeSchema=1',
      'p',
      'legacy-route'
    ))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Content not found' })

    await expect(detailHandler(responseEvent(
      '/api/content/p/legacy-route?status=published&includeSchema=1',
      'p',
      'legacy-route'
    ))).resolves.toMatchObject({ id: 'legacy-route', title: 'Legacy route' })
  })
})
