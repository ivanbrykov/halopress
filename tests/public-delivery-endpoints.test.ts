import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  content as contentTable,
  contentListing as contentListingTable,
  contentRefList,
  contentSearchData,
  page as pageTable,
  publicationRevision,
  publicRoute,
  schema as schemaTable,
  schemaActive as schemaActiveTable,
  searchConfig
} from '../server/db/schema'
import type { SchemaPermission } from '../server/utils/schema-permission'
import { runMigrations, seedRoles } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type EndpointHandler = (event: any) => Promise<any>

const dbState = vi.hoisted(() => ({ current: null as any }))
const permissionState = vi.hoisted(() => ({
  roleKey: 'anonymous',
  deniedSchemas: new Set<string>()
}))

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => dbState.current)
}))

vi.mock('../server/utils/schema-permission', () => ({
  getSchemaPermission: vi.fn(async (_event: unknown, schemaKey: string): Promise<SchemaPermission> => ({
    roleKey: permissionState.roleKey,
    canRead: !permissionState.deniedSchemas.has(schemaKey),
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

const handlers = {} as Record<
  'active' | 'collection' | 'detail' | 'search' | 'recent' | 'curation',
  EndpointHandler
>

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>

function responseEvent(path: string, params: Record<string, string> = {}) {
  const headers = new Map<string, unknown>()
  const event = {
    path,
    context: { params },
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
    }
  }
  return {
    event,
    header: (name: string) => headers.get(name.toLowerCase())
  }
}

function withStatus(path: string, status: string | undefined) {
  if (status === undefined) return path
  return `${path}${path.includes('?') ? '&' : '?'}status=${encodeURIComponent(status)}`
}

function expectPublishedOnly(items: Array<{ status: string }>) {
  expect(items.length).toBeGreaterThan(0)
  expect(new Set(items.map(item => item.status))).toEqual(new Set(['published']))
}

async function addActiveSchema(schemaKey: string, title: string) {
  const now = new Date('2026-07-13T00:00:00.000Z')
  await fixture.db.insert(schemaTable).values({
    schemaKey,
    version: 1,
    title,
    astJson: JSON.stringify({ schemaKey, title, fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
    registryJson: JSON.stringify({ fields: [] }),
    createdAt: now
  })
  await fixture.db.insert(schemaActiveTable).values({
    schemaKey,
    activeVersion: 1,
    updatedAt: now
  })
}

async function addContent(args: {
  id: string
  schemaKey: string
  status: string
  title: string
  timestamp: string
  category?: string
}) {
  const timestamp = new Date(args.timestamp)
  const publishedRevisionId = args.status === 'published' ? `revision-${args.id}` : null
  await fixture.db.insert(contentTable).values({
    id: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: 1,
    status: args.status,
    contentJson: JSON.stringify({ title: args.title, category: args.category }),
    publishedRevisionId,
    firstPublishedAt: publishedRevisionId ? timestamp : null,
    publishedAt: publishedRevisionId ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  await fixture.db.insert(contentListingTable).values({
    contentId: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: 1,
    title: args.title,
    status: args.status,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  if (publishedRevisionId) {
    await fixture.db.insert(publicationRevision).values({
      id: publishedRevisionId,
      documentKind: 'content',
      documentId: args.id,
      schemaKey: args.schemaKey,
      schemaVersion: 1,
      contentJson: JSON.stringify({ title: args.title, category: args.category }),
      createdAt: timestamp
    })
    await fixture.db.insert(contentListingTable).values({
      contentId: args.id,
      projectionScope: 'published',
      schemaKey: args.schemaKey,
      schemaVersion: 1,
      title: args.title,
      status: 'published',
      createdAt: timestamp,
      updatedAt: timestamp
    })
  }
  if (args.category) {
    await fixture.db.insert(contentSearchData).values({
      contentId: args.id,
      fieldId: 'article_category',
      dataType: 'text',
      text: args.category
    })
    if (publishedRevisionId) {
      await fixture.db.insert(contentSearchData).values({
        contentId: args.id,
        projectionScope: 'published',
        fieldId: 'article_category',
        dataType: 'text',
        text: args.category
      })
    }
  }
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  await seedRoles(fixture.db)

  await addActiveSchema('article', 'Articles')
  await addActiveSchema('curation', 'Curations')
  await addActiveSchema('private-curation', 'Private curations')

  await fixture.db.insert(searchConfig).values({
    schemaKey: 'article',
    fieldId: 'article_category',
    fieldKey: 'category',
    kind: 'string',
    searchMode: 'exact',
    filterable: true,
    sortable: false
  })

  await addContent({
    id: 'published-new',
    schemaKey: 'article',
    status: 'published',
    title: 'Published new',
    timestamp: '2026-07-13T00:00:50.000Z',
    category: 'news'
  })
  await fixture.db.insert(publicRoute).values({
    path: '/article/published-target',
    routeKind: 'canonical',
    documentKind: 'content',
    documentId: 'published-target',
    schemaKey: 'article',
    seoJson: JSON.stringify({ title: 'Published SEO' }),
    createdAt: new Date('2026-07-13T00:00:40.000Z'),
    updatedAt: new Date('2026-07-13T00:00:40.000Z')
  })
  await addContent({
    id: 'draft-near-new',
    schemaKey: 'article',
    status: 'draft',
    title: 'Draft near new',
    timestamp: '2026-07-13T00:00:45.000Z',
    category: 'news'
  })
  await addContent({
    id: 'published-target',
    schemaKey: 'article',
    status: 'published',
    title: 'Published target',
    timestamp: '2026-07-13T00:00:40.000Z',
    category: 'news'
  })
  await addContent({
    id: 'deleted-near-old',
    schemaKey: 'article',
    status: 'deleted',
    title: 'Deleted near old',
    timestamp: '2026-07-13T00:00:35.000Z',
    category: 'news'
  })
  await addContent({
    id: 'published-old',
    schemaKey: 'article',
    status: 'published',
    title: 'Published old',
    timestamp: '2026-07-13T00:00:30.000Z',
    category: 'news'
  })

  await addContent({
    id: 'owner-public',
    schemaKey: 'curation',
    status: 'published',
    title: 'Public owner',
    timestamp: '2026-07-13T00:01:00.000Z'
  })
  await addContent({
    id: 'owner-draft',
    schemaKey: 'curation',
    status: 'draft',
    title: 'Draft owner',
    timestamp: '2026-07-13T00:01:01.000Z'
  })
  await addContent({
    id: 'owner-deleted',
    schemaKey: 'curation',
    status: 'deleted',
    title: 'Deleted owner',
    timestamp: '2026-07-13T00:01:02.000Z'
  })
  await addContent({
    id: 'owner-private',
    schemaKey: 'private-curation',
    status: 'published',
    title: 'Private owner',
    timestamp: '2026-07-13T00:01:03.000Z'
  })

  for (const ownerContentId of ['owner-public', 'owner-draft', 'owner-deleted', 'owner-private']) {
    await fixture.db.insert(contentRefList).values([
      { ownerContentId, fieldKey: 'items', position: 0, itemKind: 'content', itemSchemaKey: 'article', itemId: 'draft-near-new' },
      { ownerContentId, fieldKey: 'items', position: 1, itemKind: 'content', itemSchemaKey: 'article', itemId: 'published-target' },
      { ownerContentId, fieldKey: 'items', position: 2, itemKind: 'content', itemSchemaKey: 'article', itemId: 'deleted-near-old' },
      { ownerContentId, fieldKey: 'items', position: 3, itemKind: 'content', itemSchemaKey: 'article', itemId: 'published-old' }
    ])
    if (ownerContentId === 'owner-public' || ownerContentId === 'owner-private') {
      await fixture.db.insert(contentRefList).values([
        { ownerContentId, projectionScope: 'published', fieldKey: 'items', position: 0, itemKind: 'content', itemSchemaKey: 'article', itemId: 'draft-near-new' },
        { ownerContentId, projectionScope: 'published', fieldKey: 'items', position: 1, itemKind: 'content', itemSchemaKey: 'article', itemId: 'published-target' },
        { ownerContentId, projectionScope: 'published', fieldKey: 'items', position: 2, itemKind: 'content', itemSchemaKey: 'article', itemId: 'deleted-near-old' },
        { ownerContentId, projectionScope: 'published', fieldKey: 'items', position: 3, itemKind: 'content', itemSchemaKey: 'article', itemId: 'published-old' }
      ])
    }
  }

  handlers.active = (await import('../server/api/schema/[schemaKey]/active.get')).default as EndpointHandler
  handlers.collection = (await import('../server/api/content/[schemaKey]/index.get')).default as EndpointHandler
  handlers.detail = (await import('../server/api/content/[schemaKey]/[id].get')).default as EndpointHandler
  handlers.search = (await import('../server/api/search.get')).default as EndpointHandler
  handlers.recent = (await import('../server/api/widget/recent.get')).default as EndpointHandler
  handlers.curation = (await import('../server/api/widget/curation.get')).default as EndpointHandler
})

beforeEach(() => {
  permissionState.roleKey = 'anonymous'
  permissionState.deniedSchemas.clear()
})

afterAll(() => {
  fixture.close()
  vi.unstubAllGlobals()
})

describe('public delivery endpoint visibility', () => {
  it('returns non-enumerating 404s across public delivery while a schema is inactive', async () => {
    await fixture.db.update(schemaActiveTable).set({ status: 'inactive' }).where(eq(schemaActiveTable.schemaKey, 'article'))
    try {
      await expect(handlers.active(responseEvent('/api/schema/article/active', { schemaKey: 'article' }).event))
        .rejects.toMatchObject({ statusCode: 404 })
      await expect(handlers.collection(responseEvent('/api/content/article', { schemaKey: 'article' }).event))
        .rejects.toMatchObject({ statusCode: 404 })
      await expect(handlers.detail(responseEvent('/api/content/article/published-target', { schemaKey: 'article', id: 'published-target' }).event))
        .rejects.toMatchObject({ statusCode: 404 })
      await expect(handlers.search(responseEvent('/api/search?schemaKey=article').event))
        .rejects.toMatchObject({ statusCode: 404 })
      await expect(handlers.recent(responseEvent('/api/widget/recent?schema=article').event))
        .rejects.toMatchObject({ statusCode: 404 })
      await expect(handlers.curation(responseEvent('/api/widget/curation?schema=article&field=category&values=news').event))
        .rejects.toMatchObject({ statusCode: 404 })
    } finally {
      await fixture.db.update(schemaActiveTable).set({ status: 'active' }).where(eq(schemaActiveTable.schemaKey, 'article'))
    }
  })

  it('returns active schema metadata only while the schema is readable', async () => {
    const allowed = responseEvent('/api/schema/article/active', { schemaKey: 'article' })
    await expect(handlers.active(allowed.event)).resolves.toMatchObject({ schemaKey: 'article', title: 'Articles' })
    expect(allowed.header('cache-control')).toBe('public, max-age=0, must-revalidate')

    permissionState.deniedSchemas.add('article')
    const denied = responseEvent('/api/schema/article/active', { schemaKey: 'article' })
    await expect(handlers.active(denied.event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([undefined, 'draft', 'deleted', 'all'])('keeps anonymous %s requests published-only across handlers', async (status) => {
    const collection = responseEvent(withStatus('/api/content/article', status), { schemaKey: 'article' })
    const collectionResult = await handlers.collection(collection.event)
    expectPublishedOnly(collectionResult.items)

    const detail = responseEvent(
      withStatus('/api/content/article/published-target?surroundings=1', status),
      { schemaKey: 'article', id: 'published-target' }
    )
    const detailResult = await handlers.detail(detail.event)
    expect(detailResult.status).toBe('published')
    expect(detailResult.surroundings).toMatchObject({
      prev: { id: 'published-new', status: 'published' },
      next: { id: 'published-old', status: 'published' }
    })

    const search = responseEvent(withStatus('/api/search?schemaKey=article', status))
    const searchResult = await handlers.search(search.event)
    expectPublishedOnly(searchResult.items)

    const recent = responseEvent(withStatus('/api/widget/recent?schema=article', status))
    const recentResult = await handlers.recent(recent.event)
    expectPublishedOnly(recentResult.items)
    expect(recent.header('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(recent.header('vary')).toBe('Cookie')

    const valueCuration = responseEvent(withStatus(
      '/api/widget/curation?schema=article&field=category&values=news',
      status
    ))
    const valueResult = await handlers.curation(valueCuration.event)
    expectPublishedOnly(valueResult.items)
    expect(valueCuration.header('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(valueCuration.header('vary')).toBe('Cookie')

    const ownerCuration = responseEvent(withStatus(
      '/api/widget/curation?schema=article&field=items&ownerId=owner-public',
      status
    ))
    const ownerResult = await handlers.curation(ownerCuration.event)
    expectPublishedOnly(ownerResult.items)
  })

  it('hides unpublished details from anonymous callers', async () => {
    for (const id of ['draft-near-new', 'deleted-near-old']) {
      const request = responseEvent(`/api/content/article/${id}`, { schemaKey: 'article', id })
      await expect(handlers.detail(request.event)).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'Content not found'
      })
    }
  })

  it('excludes standalone page route claims only from the legacy public p collection', async () => {
    const now = new Date('2026-07-13T00:02:00.000Z')
    await addActiveSchema('p', 'Legacy Pages')
    await addContent({
      id: 'legacy-z-claimed',
      schemaKey: 'p',
      status: 'published',
      title: 'Claimed legacy page',
      timestamp: '2026-07-13T00:02:01.000Z'
    })
    await addContent({
      id: 'legacy-y-free',
      schemaKey: 'p',
      status: 'published',
      title: 'First available legacy page',
      timestamp: '2026-07-13T00:02:02.000Z'
    })
    await addContent({
      id: 'legacy-x-free',
      schemaKey: 'p',
      status: 'published',
      title: 'Second available legacy page',
      timestamp: '2026-07-13T00:02:03.000Z'
    })
    await fixture.db.insert(pageTable).values({
      id: 'legacy-z-claimed',
      title: 'Draft standalone page',
      status: 'draft',
      contentJson: JSON.stringify({ type: 'doc', content: [] }),
      createdAt: now,
      updatedAt: now
    })

    const publicRoute = responseEvent(
      '/api/content/p?status=published&routeScope=public-page&pageSize=1',
      { schemaKey: 'p' }
    )
    const publicRouteResult = await handlers.collection(publicRoute.event)
    expect(publicRouteResult.items.map((item: any) => item.id)).toEqual(['legacy-y-free'])
    expect(publicRouteResult.nextCursor).toBe('legacy-y-free')
    expect(publicRoute.header('cache-control')).toMatch(/^public,/)

    const nextPage = responseEvent(
      '/api/content/p?status=published&routeScope=public-page&pageSize=1&cursor=legacy-y-free',
      { schemaKey: 'p' }
    )
    const nextPageResult = await handlers.collection(nextPage.event)
    expect(nextPageResult.items.map((item: any) => item.id)).toEqual(['legacy-x-free'])
    expect(nextPageResult.nextCursor).toBeNull()

    const genericApi = responseEvent('/api/content/p?status=published', { schemaKey: 'p' })
    const genericResult = await handlers.collection(genericApi.event)
    expect(genericResult.items.map((item: any) => item.id).sort()).toEqual([
      'legacy-x-free',
      'legacy-y-free',
      'legacy-z-claimed'
    ])

    permissionState.roleKey = 'user'
    const authenticated = responseEvent(
      '/api/content/p?status=published&routeScope=public-page',
      { schemaKey: 'p' }
    )
    const authenticatedResult = await handlers.collection(authenticated.event)
    expect(authenticatedResult.items.map((item: any) => item.id).sort()).toEqual([
      'legacy-x-free',
      'legacy-y-free'
    ])
    expect(authenticated.header('cache-control')).toBe('private, no-store')
  })

  it('excludes standalone page route claims from legacy p surroundings', async () => {
    const rows = [
      { id: 'surround-newer-free', title: 'Newer free', timestamp: '2026-07-13T00:03:05.000Z' },
      { id: 'surround-newer-claimed', title: 'Newer claimed', timestamp: '2026-07-13T00:03:04.000Z' },
      { id: 'surround-target', title: 'Target', timestamp: '2026-07-13T00:03:03.000Z' },
      { id: 'surround-older-claimed', title: 'Older claimed', timestamp: '2026-07-13T00:03:02.000Z' },
      { id: 'surround-older-free', title: 'Older free', timestamp: '2026-07-13T00:03:01.000Z' }
    ]
    for (const row of rows) {
      await addContent({ ...row, schemaKey: 'p', status: 'published' })
    }
    for (const [id, status] of [
      ['surround-newer-claimed', 'draft'],
      ['surround-older-claimed', 'deleted']
    ] as const) {
      const timestamp = rows.find(row => row.id === id)!.timestamp
      await fixture.db.insert(pageTable).values({
        id,
        title: id,
        status,
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        createdAt: new Date(timestamp),
        updatedAt: new Date(timestamp)
      })
    }

    const routeScoped = responseEvent(
      '/api/content/p/surround-target?status=published&routeScope=public-page&surroundings=1',
      { schemaKey: 'p', id: 'surround-target' }
    )
    await expect(handlers.detail(routeScoped.event)).resolves.toMatchObject({
      surroundings: {
        prev: { id: 'surround-newer-free' },
        next: { id: 'surround-older-free' }
      }
    })
    expect(routeScoped.header('cache-control')).toMatch(/^public,/)

    const ascending = responseEvent(
      '/api/content/p/surround-target?status=published&routeScope=public-page&surroundings=1&order=asc',
      { schemaKey: 'p', id: 'surround-target' }
    )
    await expect(handlers.detail(ascending.event)).resolves.toMatchObject({
      surroundings: {
        prev: { id: 'surround-older-free' },
        next: { id: 'surround-newer-free' }
      }
    })

    const generic = responseEvent(
      '/api/content/p/surround-target?status=published&surroundings=1',
      { schemaKey: 'p', id: 'surround-target' }
    )
    await expect(handlers.detail(generic.event)).resolves.toMatchObject({
      surroundings: {
        prev: { id: 'surround-newer-claimed' },
        next: { id: 'surround-older-claimed' }
      }
    })

    permissionState.roleKey = 'user'
    const authenticated = responseEvent(
      '/api/content/p/surround-target?status=published&routeScope=public-page&surroundings=1',
      { schemaKey: 'p', id: 'surround-target' }
    )
    await expect(handlers.detail(authenticated.event)).resolves.toMatchObject({
      surroundings: {
        prev: { id: 'surround-newer-free' },
        next: { id: 'surround-older-free' }
      }
    })
    expect(authenticated.header('cache-control')).toBe('private, no-store')
  })

  it('keeps the last published revision public while its working copy is edited', async () => {
    await fixture.db.update(contentTable).set({
      status: 'draft',
      contentJson: JSON.stringify({ title: 'Unreleased edit', category: 'draft-news' }),
      seoJson: JSON.stringify({ title: 'Unreleased SEO' })
    }).where(eq(contentTable.id, 'published-target'))
    await fixture.db.update(contentListingTable).set({
      title: 'Unreleased edit',
      status: 'draft'
    }).where(and(
      eq(contentListingTable.contentId, 'published-target'),
      eq(contentListingTable.projectionScope, 'working')
    ))

    const publicRequest = responseEvent('/api/content/article/published-target', {
      schemaKey: 'article',
      id: 'published-target'
    })
    await expect(handlers.detail(publicRequest.event)).resolves.toMatchObject({
      title: 'Published target',
      status: 'published',
      content: { title: 'Published target', category: 'news' },
      seo: { title: 'Published SEO' },
      publicationState: 'published',
      hasDraftChanges: false
    })
    expect(publicRequest.header('cache-control')).toMatch(/^public,/)

    permissionState.roleKey = 'user'
    const workingRequest = responseEvent('/api/content/article/published-target', {
      schemaKey: 'article',
      id: 'published-target'
    })
    await expect(handlers.detail(workingRequest.event)).resolves.toMatchObject({
      title: 'Unreleased edit',
      status: 'draft',
      content: { title: 'Unreleased edit', category: 'draft-news' },
      seo: { title: 'Unreleased SEO' },
      publicationState: 'published-with-draft',
      hasDraftChanges: true
    })
    expect(workingRequest.header('cache-control')).toBe('private, no-store')

    for (const path of [
      '/api/widget/recent?schema=article',
      '/api/widget/curation?schema=article&field=category&values=news',
      '/api/widget/curation?schema=article&field=items&ownerId=owner-public'
    ]) {
      const request = responseEvent(path)
      const result = path.includes('/recent')
        ? await handlers.recent(request.event)
        : await handlers.curation(request.event)
      expect(result.items.find((item: any) => item.id === 'published-target')).toMatchObject({
        title: 'Published target',
        status: 'published'
      })
      expect(request.header('cache-control')).toBe('private, no-store')
      expect(request.header('x-widget-cache')).toBe('bypass')
    }

    await fixture.db.update(contentTable).set({
      status: 'published',
      contentJson: JSON.stringify({ title: 'Published target', category: 'news' })
    }).where(eq(contentTable.id, 'published-target'))
    await fixture.db.update(contentListingTable).set({
      title: 'Published target',
      status: 'published'
    }).where(and(
      eq(contentListingTable.contentId, 'published-target'),
      eq(contentListingTable.projectionScope, 'working')
    ))
  })

  it('preserves all and non-published data for an authenticated read-only role', async () => {
    permissionState.roleKey = 'user'

    const active = responseEvent('/api/schema/article/active', { schemaKey: 'article' })
    await expect(handlers.active(active.event)).resolves.toMatchObject({ schemaKey: 'article' })

    const collection = responseEvent('/api/content/article?status=all', { schemaKey: 'article' })
    const collectionResult = await handlers.collection(collection.event)
    expect(new Set(collectionResult.items.map((item: any) => item.status))).toEqual(
      new Set(['published', 'draft', 'deleted'])
    )

    const search = responseEvent('/api/search?schemaKey=article&status=all')
    const searchResult = await handlers.search(search.event)
    expect(new Set(searchResult.items.map((item: any) => item.status))).toEqual(
      new Set(['published', 'draft', 'deleted'])
    )

    const draftDetail = responseEvent('/api/content/article/draft-near-new', {
      schemaKey: 'article',
      id: 'draft-near-new'
    })
    await expect(handlers.detail(draftDetail.event)).resolves.toMatchObject({
      id: 'draft-near-new',
      status: 'draft'
    })

    const surrounded = responseEvent('/api/content/article/published-target?surroundings=1&status=all', {
      schemaKey: 'article',
      id: 'published-target'
    })
    await expect(handlers.detail(surrounded.event)).resolves.toMatchObject({
      surroundings: {
        prev: { id: 'draft-near-new', status: 'draft' },
        next: { id: 'deleted-near-old', status: 'deleted' }
      }
    })

    const recent = responseEvent('/api/widget/recent?schema=article&status=all')
    const recentResult = await handlers.recent(recent.event)
    expect(new Set(recentResult.items.map((item: any) => item.status))).toEqual(
      new Set(['published', 'draft', 'deleted'])
    )
    expect(recent.header('cache-control')).toBe('private, no-store')
    expect(recent.header('vary')).toBe('Cookie')
    expect(recent.header('x-widget-cache')).toBe('bypass')
    expect(recent.header('x-widget-cache-backend')).toBe('none')

    for (const path of [
      '/api/widget/curation?schema=article&field=category&values=news&status=all',
      '/api/widget/curation?schema=article&field=items&ownerId=owner-draft&status=all'
    ]) {
      const curation = responseEvent(path)
      const result = await handlers.curation(curation.event)
      expect(new Set(result.items.map((item: any) => item.status))).toEqual(
        new Set(['published', 'draft', 'deleted'])
      )
      expect(curation.header('cache-control')).toBe('private, no-store')
      expect(curation.header('vary')).toBe('Cookie')
      expect(curation.header('x-widget-cache')).toBe('bypass')
      expect(curation.header('x-widget-cache-backend')).toBe('none')
    }
  })

  it.each([
    { ownerId: 'owner-missing', deniedSchema: null, message: 'missing' },
    { ownerId: 'owner-draft', deniedSchema: null, message: 'draft' },
    { ownerId: 'owner-deleted', deniedSchema: null, message: 'deleted' },
    { ownerId: 'owner-private', deniedSchema: 'private-curation', message: 'private' }
  ])('returns 404 for a $message public curation owner', async ({ ownerId, deniedSchema }) => {
    if (deniedSchema) permissionState.deniedSchemas.add(deniedSchema)
    const request = responseEvent(
      `/api/widget/curation?schema=article&field=items&ownerId=${ownerId}&status=all`
    )

    await expect(handlers.curation(request.event)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  })

  it('denies authenticated owner-based curation when the owner schema is unreadable', async () => {
    permissionState.roleKey = 'user'
    permissionState.deniedSchemas.add('private-curation')
    const request = responseEvent(
      '/api/widget/curation?schema=article&field=items&ownerId=owner-private&status=all'
    )

    await expect(handlers.curation(request.event)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  })

  it('checks revoked permission before returning cached widget data', async () => {
    const recentPath = '/api/widget/recent?schema=article&status=all'
    const curationPath = '/api/widget/curation?schema=article&field=category&values=news&status=all'

    const cachedRecent = responseEvent(recentPath)
    expectPublishedOnly((await handlers.recent(cachedRecent.event)).items)
    const cachedCuration = responseEvent(curationPath)
    expectPublishedOnly((await handlers.curation(cachedCuration.event)).items)

    permissionState.deniedSchemas.add('article')

    const deniedRecent = responseEvent(recentPath)
    await expect(handlers.recent(deniedRecent.event)).rejects.toMatchObject({ statusCode: 404 })
    expect(deniedRecent.header('x-widget-cache')).toBeUndefined()

    const deniedCuration = responseEvent(curationPath)
    await expect(handlers.curation(deniedCuration.event)).rejects.toMatchObject({ statusCode: 404 })
    expect(deniedCuration.header('x-widget-cache')).toBeUndefined()
  })
})
