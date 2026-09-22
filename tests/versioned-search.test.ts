import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { syncSearchConfig } from '../server/cms/search-config'
import type { SchemaRegistry } from '../server/cms/types'
import {
  content,
  contentListing,
  contentSearchData,
  schema,
  schemaActive,
  searchConfig
} from '../server/db/schema'
import type { SchemaPermission } from '../server/utils/schema-permission'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type EndpointHandler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
const permissionState = vi.hoisted(() => ({ roleKey: 'anonymous' }))

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => dbState.current)
}))

vi.mock('../server/utils/schema-permission', () => ({
  getSchemaPermission: vi.fn(async (): Promise<SchemaPermission> => ({
    roleKey: permissionState.roleKey,
    canRead: true,
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

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let searchHandler: EndpointHandler
let curationHandler: EndpointHandler

function responseEvent(path: string) {
  const headers = new Map<string, unknown>()
  return {
    path,
    context: {},
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

function registry(args: {
  schemaKey: string
  version: number
  fieldId: string
  fieldKey: string
  kind: 'string' | 'integer'
}): SchemaRegistry {
  return {
    schemaKey: args.schemaKey,
    version: args.version,
    title: args.schemaKey,
    fields: [{
      fieldId: args.fieldId,
      key: args.fieldKey,
      kind: args.kind,
      search: { mode: 'exact', filterable: true, sortable: true }
    }],
    relations: []
  }
}

async function insertSchema(registryValue: SchemaRegistry) {
  const now = new Date('2026-07-13T00:00:00.000Z')
  await fixture.db.insert(schema).values({
    schemaKey: registryValue.schemaKey,
    version: registryValue.version,
    title: registryValue.title,
    astJson: JSON.stringify({ schemaKey: registryValue.schemaKey, title: registryValue.title, fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object' }),
    registryJson: JSON.stringify(registryValue),
    createdAt: now
  })
}

async function insertPublished(args: {
  id: string
  schemaKey: string
  workingVersion: number
  publishedVersion: number
  dataType: 'text' | 'integer'
  value: string | number
  fieldId?: string
}) {
  const now = new Date(`2026-07-13T00:00:${args.id.length.toString().padStart(2, '0')}.000Z`)
  await fixture.db.insert(content).values({
    id: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: args.workingVersion,
    status: args.workingVersion === args.publishedVersion ? 'published' : 'draft',
    contentJson: JSON.stringify({ value: args.value }),
    publishedRevisionId: `revision-${args.id}`,
    firstPublishedAt: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(contentListing).values({
    contentId: args.id,
    projectionScope: 'published',
    schemaKey: args.schemaKey,
    schemaVersion: args.publishedVersion,
    title: args.id,
    status: 'published',
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(contentSearchData).values({
    contentId: args.id,
    projectionScope: 'published',
    fieldId: args.fieldId ?? (args.schemaKey === 'article' ? 'score-field' : 'category-field'),
    dataType: args.dataType,
    text: args.dataType === 'text' ? String(args.value) : null,
    value: args.dataType === 'text' ? null : Number(args.value)
  })
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)

  await insertSchema(registry({
    schemaKey: 'article',
    version: 1,
    fieldId: 'score-field',
    fieldKey: 'score',
    kind: 'string'
  }))
  await insertSchema(registry({
    schemaKey: 'article',
    version: 2,
    fieldId: 'score-field',
    fieldKey: 'rating',
    kind: 'integer'
  }))
  await fixture.db.insert(searchConfig).values({
    schemaKey: 'article',
    fieldId: 'score-field',
    fieldKey: 'rating',
    kind: 'integer',
    searchMode: 'exact',
    filterable: true,
    sortable: true
  })
  await insertPublished({
    id: 'article-v1',
    schemaKey: 'article',
    workingVersion: 2,
    publishedVersion: 1,
    dataType: 'text',
    value: '10'
  })
  await insertPublished({
    id: 'article-v2',
    schemaKey: 'article',
    workingVersion: 2,
    publishedVersion: 2,
    dataType: 'integer',
    value: 20
  })

  await insertSchema(registry({
    schemaKey: 'widget-kind-drift',
    version: 1,
    fieldId: 'widget-score-field',
    fieldKey: 'score',
    kind: 'string'
  }))
  await insertSchema(registry({
    schemaKey: 'widget-kind-drift',
    version: 2,
    fieldId: 'widget-score-field',
    fieldKey: 'score',
    kind: 'integer'
  }))
  await fixture.db.insert(searchConfig).values({
    schemaKey: 'widget-kind-drift',
    fieldId: 'widget-score-field',
    fieldKey: 'score',
    kind: 'integer',
    searchMode: 'exact',
    filterable: true,
    sortable: true
  })
  await insertPublished({
    id: 'widget-kind-v1',
    schemaKey: 'widget-kind-drift',
    workingVersion: 2,
    publishedVersion: 1,
    dataType: 'text',
    value: '10',
    fieldId: 'widget-score-field'
  })
  await insertPublished({
    id: 'widget-kind-v2',
    schemaKey: 'widget-kind-drift',
    workingVersion: 2,
    publishedVersion: 2,
    dataType: 'integer',
    value: 20,
    fieldId: 'widget-score-field'
  })

  await insertSchema(registry({
    schemaKey: 'compatible',
    version: 1,
    fieldId: 'category-field',
    fieldKey: 'category',
    kind: 'string'
  }))
  await insertSchema(registry({
    schemaKey: 'compatible',
    version: 2,
    fieldId: 'category-field',
    fieldKey: 'label',
    kind: 'string'
  }))
  await fixture.db.insert(searchConfig).values({
    schemaKey: 'compatible',
    fieldId: 'category-field',
    fieldKey: 'label',
    kind: 'string',
    searchMode: 'exact',
    filterable: true,
    sortable: true
  })
  await insertPublished({
    id: 'compatible-v1',
    schemaKey: 'compatible',
    workingVersion: 2,
    publishedVersion: 1,
    dataType: 'text',
    value: 'news'
  })

  const recreatedV1 = registry({
    schemaKey: 'recreated',
    version: 1,
    fieldId: 'category-field-v1',
    fieldKey: 'category',
    kind: 'string'
  })
  recreatedV1.fields.push({
    fieldId: 'category-field-v2',
    key: 'legacyCategory',
    kind: 'string',
    search: { mode: 'exact', filterable: true, sortable: true }
  })
  await insertSchema(recreatedV1)
  await insertSchema(registry({
    schemaKey: 'recreated',
    version: 2,
    fieldId: 'category-field-v2',
    fieldKey: 'category',
    kind: 'string'
  }))
  await fixture.db.insert(searchConfig).values({
    schemaKey: 'recreated',
    fieldId: 'category-field-v2',
    fieldKey: 'category',
    kind: 'string',
    searchMode: 'exact',
    filterable: true,
    sortable: true
  })
  await insertPublished({
    id: 'recreated-v1',
    schemaKey: 'recreated',
    workingVersion: 2,
    publishedVersion: 1,
    dataType: 'text',
    value: 'archive',
    fieldId: 'category-field-v1'
  })

  await fixture.db.insert(schemaActive).values([
    { schemaKey: 'article', activeVersion: 2, updatedAt: new Date('2026-07-13T00:00:00.000Z') },
    { schemaKey: 'widget-kind-drift', activeVersion: 2, updatedAt: new Date('2026-07-13T00:00:00.000Z') },
    { schemaKey: 'compatible', activeVersion: 2, updatedAt: new Date('2026-07-13T00:00:00.000Z') },
    { schemaKey: 'recreated', activeVersion: 2, updatedAt: new Date('2026-07-13T00:00:00.000Z') }
  ])

  searchHandler = (await import('../server/api/search.get')).default as EndpointHandler
  curationHandler = (await import('../server/api/widget/curation.get')).default as EndpointHandler
})

afterAll(() => fixture.close())

beforeEach(() => {
  permissionState.roleKey = 'anonymous'
})

describe('versioned published search', () => {
  it('keeps unfiltered mixed-version listings available', async () => {
    const event = responseEvent('/api/search?schemaKey=article')
    const result = await searchHandler(event)
    expect(result.items.map((item: any) => item.id).sort()).toEqual(['article-v1', 'article-v2'])
    expect(event.header('cache-control')).toContain('public')
  })

  it('rejects incompatible published filters and sorts instead of silently dropping old revisions', async () => {
    const filters = encodeURIComponent(JSON.stringify({ field: 'rating', value: 10 }))
    await expect(searchHandler(responseEvent(`/api/search?schemaKey=article&filters=${filters}`)))
      .rejects.toMatchObject({ statusCode: 409 })
    await expect(searchHandler(responseEvent('/api/search?schemaKey=article&sort=rating:asc')))
      .rejects.toMatchObject({ statusCode: 409 })

    permissionState.roleKey = 'user'
    const authenticated = responseEvent(`/api/search?schemaKey=article&status=published&filters=${filters}`)
    await expect(searchHandler(authenticated)).rejects.toMatchObject({ statusCode: 409 })
    expect(authenticated.header('cache-control')).toBe('private, no-store')
  })

  it('uses stable field IDs for compatible key renames', async () => {
    const filters = encodeURIComponent(JSON.stringify({ field: 'label', value: 'news' }))
    const result = await searchHandler(responseEvent(`/api/search?schemaKey=compatible&filters=${filters}&sort=label:asc&fields=label`))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'compatible-v1',
      schemaVersion: 1,
      searchData: { label: 'news' }
    })
  })

  it('rejects a reused field key with a different stable ID', async () => {
    const filters = encodeURIComponent(JSON.stringify({ field: 'category', value: 'archive' }))
    await expect(searchHandler(responseEvent(`/api/search?schemaKey=recreated&filters=${filters}`)))
      .rejects.toMatchObject({ statusCode: 409 })
    await expect(searchHandler(responseEvent('/api/search?schemaKey=recreated&sort=category:asc')))
      .rejects.toMatchObject({ statusCode: 409 })
    await expect(searchHandler(responseEvent('/api/search?schemaKey=recreated&fields=category')))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects requested search data that changed kind across published versions', async () => {
    await expect(searchHandler(responseEvent('/api/search?schemaKey=article&fields=rating')))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('allows filtering again after every published projection uses the active field contract', async () => {
    await fixture.db.update(contentListing).set({ schemaVersion: 2 }).where(and(
      eq(contentListing.contentId, 'article-v1'),
      eq(contentListing.projectionScope, 'published')
    ))
    await fixture.db.update(contentSearchData).set({
      dataType: 'integer',
      text: null,
      value: 10
    }).where(and(
      eq(contentSearchData.contentId, 'article-v1'),
      eq(contentSearchData.projectionScope, 'published')
    ))

    const filters = encodeURIComponent(JSON.stringify({ field: 'rating', value: 10 }))
    const result = await searchHandler(responseEvent(`/api/search?schemaKey=article&filters=${filters}&sort=rating:asc`))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'article-v1', schemaVersion: 2 })
  })

  it('does not delete immutable published search rows when active config removes a field', async () => {
    const isolated = await createTestSqliteDb()
    try {
      await runMigrations(isolated.db)
      await isolated.db.insert(searchConfig).values({
        schemaKey: 'cleanup',
        fieldId: 'removed-field',
        fieldKey: 'removed',
        kind: 'string',
        searchMode: 'exact',
        filterable: true,
        sortable: false
      })
      await isolated.db.insert(contentSearchData).values([
        {
          contentId: 'cleanup-item',
          projectionScope: 'working',
          fieldId: 'removed-field',
          dataType: 'text',
          text: 'draft'
        },
        {
          contentId: 'cleanup-item',
          projectionScope: 'published',
          fieldId: 'removed-field',
          dataType: 'text',
          text: 'public'
        }
      ])

      await syncSearchConfig({
        db: isolated.db,
        schemaKey: 'cleanup',
        registry: {
          schemaKey: 'cleanup',
          version: 2,
          title: 'Cleanup',
          fields: [],
          relations: []
        }
      })

      expect(await isolated.db.select().from(contentSearchData)).toEqual([expect.objectContaining({
        projectionScope: 'published',
        text: 'public'
      })])
    } finally {
      isolated.close()
    }
  })
})

describe('versioned published curation widgets', () => {
  it('rejects kind drift instead of silently omitting an older published revision', async () => {
    await expect(curationHandler(responseEvent('/api/widget/curation?schema=widget-kind-drift&field=score&values=20')))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('keeps stable-ID field renames available', async () => {
    const result = await curationHandler(responseEvent('/api/widget/curation?schema=compatible&field=label&values=news'))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'compatible-v1', schemaVersion: 1 })
  })

  it('rejects a reused field key with a different stable ID', async () => {
    await expect(curationHandler(responseEvent('/api/widget/curation?schema=recreated&field=category&values=archive')))
      .rejects.toMatchObject({ statusCode: 409 })
  })
})
