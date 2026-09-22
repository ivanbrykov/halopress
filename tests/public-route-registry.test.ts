import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  assertPublicRouteAvailable,
  contentCanonicalPath,
  listCanonicalPublicRoutes,
  listCanonicalPublicRoutesByIdentity,
  PUBLIC_ROUTE_D1_IN_CHUNK_SIZE,
  publishCanonicalRoute,
  resolvePublicRoute
} from '../server/cms/public-routes'
import {
  content,
  page,
  publicRoute,
  schemaActive,
  schemaRole,
  userRole
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

describe('public route registry', () => {
  it('keeps identity lookups below D1 bind limits across more than one batch', async () => {
    expect(PUBLIC_ROUTE_D1_IN_CHUNK_SIZE).toBeLessThanOrEqual(90)
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-18T00:00:00.000Z')
      const pages = Array.from({ length: 108 }, (_, index) => ({
        id: `batched-page-${index}`,
        title: `Batched Page ${index}`,
        status: 'published',
        contentJson: '{}',
        publishedRevisionId: `batched-revision-${index}`,
        createdAt: now,
        updatedAt: now
      }))
      await fixture.db.insert(page).values(pages)
      await fixture.db.insert(publicRoute).values(pages.map((item, index) => ({
        path: `/batched/${index}`,
        routeKind: 'canonical',
        documentKind: 'page',
        documentId: item.id,
        schemaKey: null,
        createdAt: now,
        updatedAt: now
      })))
      const routes = await listCanonicalPublicRoutesByIdentity(
        fixture.db as any,
        pages.map(item => ({ documentKind: 'page', documentId: item.id }))
      )
      expect(routes).toHaveLength(108)
      expect(new Set(routes.map(route => route.documentId))).toEqual(new Set(pages.map(item => item.id)))
    } finally {
      fixture.close()
    }
  })

  it('serializes route-claim reads for transaction-safe publication', async () => {
    let readPending = false
    const get = vi.fn(async () => {
      if (readPending) throw new Error('Concurrent transaction read')
      readPending = true
      await Promise.resolve()
      readPending = false
      return undefined
    })
    const queuedInsert = { kind: 'insert' }
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ get }) }) })),
      insert: vi.fn(() => ({ values: () => queuedInsert }))
    }
    const statements: any[] = []

    await expect(publishCanonicalRoute({
      db: db as any,
      statements,
      documentKind: 'schema',
      documentId: 'transaction-safe',
      schemaKey: 'transaction-safe',
      path: '/transaction-safe',
      legacyPath: '/transaction-safe',
      seo: null,
      now: new Date('2026-07-14T00:00:00.000Z')
    })).resolves.toBe('/transaction-safe')
    expect(get).toHaveBeenCalledTimes(2)
    expect(statements).toEqual([queuedInsert])
  })

  it('rejects content publication beneath reserved system roots', () => {
    expect(() => contentCanonicalPath({
      schemaKey: 'api',
      contentId: 'content-a',
      content: { title: 'Unsafe' },
      registry: {} as any
    })).toThrow('Reserved system paths cannot be published')
  })

  it('keeps immutable document identity while canonical path changes create permanent aliases', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(page).values({
        id: 'page-a',
        title: 'About',
        status: 'draft',
        contentJson: '{}',
        publishedRevisionId: 'published-a',
        createdAt: now,
        updatedAt: now
      })

      await publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-a',
        path: '/about',
        legacyPath: '/p/page-a',
        seo: { title: 'Published about' },
        now
      })

      await expect(resolvePublicRoute(fixture.db as any, '/p/page-a')).resolves.toMatchObject({
        routeKind: 'alias',
        canonicalPath: '/about',
        documentKind: 'page',
        documentId: 'page-a',
        seo: { title: 'Published about' }
      })

      const changedAt = new Date('2026-07-14T01:00:00.000Z')
      await publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-a',
        path: '/company/about',
        legacyPath: '/p/page-a',
        seo: { description: 'Current published description' },
        now: changedAt
      })

      await expect(resolvePublicRoute(fixture.db as any, '/about')).resolves.toMatchObject({
        routeKind: 'alias',
        canonicalPath: '/company/about',
        documentId: 'page-a',
        seo: { description: 'Current published description' }
      })
      await expect(resolvePublicRoute(fixture.db as any, '/p/page-a')).resolves.toMatchObject({
        routeKind: 'alias',
        canonicalPath: '/company/about'
      })

      await expect(publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-a',
        path: '/about',
        legacyPath: '/p/page-a',
        seo: null,
        now: changedAt
      })).rejects.toMatchObject({ statusCode: 409 })

      const claims = await fixture.db.select().from(publicRoute)
        .where(and(eq(publicRoute.documentKind, 'page'), eq(publicRoute.documentId, 'page-a')))
      expect(claims.filter(row => row.routeKind === 'canonical')).toHaveLength(1)
      expect(claims.filter(row => row.routeKind === 'alias').map(row => row.path).sort())
        .toEqual(['/about', '/p/page-a'])

      await fixture.db.update(publicRoute).set({ seoJson: '{malformed' }).where(eq(publicRoute.path, '/company/about'))
      await expect(resolvePublicRoute(fixture.db as any, '/company/about')).resolves.toMatchObject({ seo: null })
    } finally {
      fixture.close()
    }
  })

  it('rejects cross-document collisions and excludes unreadable or unpublished routes', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(page).values([
        {
          id: 'page-a',
          title: 'A',
          status: 'published',
          contentJson: '{}',
          publishedRevisionId: 'published-a',
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'page-b',
          title: 'B',
          status: 'published',
          contentJson: '{}',
          publishedRevisionId: 'published-b',
          createdAt: now,
          updatedAt: now
        }
      ])
      await publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-a',
        path: '/claimed',
        legacyPath: '/p/page-a',
        seo: null,
        now
      })
      await expect(publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-b',
        path: '/claimed',
        legacyPath: '/p/page-b',
        seo: null,
        now
      })).rejects.toMatchObject({ statusCode: 409 })
      await expect(assertPublicRouteAvailable({
        db: fixture.db as any,
        documentKind: 'schema',
        documentId: 'claimed',
        path: '/claimed'
      })).rejects.toMatchObject({ statusCode: 409 })

      await fixture.db.update(page).set({ publishedRevisionId: null }).where(eq(page.id, 'page-a'))
      await expect(resolvePublicRoute(fixture.db as any, '/claimed')).resolves.toBeNull()
      await expect(listCanonicalPublicRoutes(fixture.db as any)).resolves.toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('requires an active schema and anonymous read permission for content and collection discovery', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(userRole).values({ roleKey: 'anonymous', title: 'Anonymous', level: 0 })
      await fixture.db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 1, status: 'active', updatedAt: now })
      await fixture.db.insert(schemaRole).values({
        schemaKey: 'article',
        roleKey: 'anonymous',
        canRead: false,
        canWrite: false,
        canPublish: false,
        canArchive: false,
        canDelete: false,
        canAdmin: false
      })
      await fixture.db.insert(content).values({
        id: 'content-a',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: '{}',
        publishedRevisionId: 'published-content-a',
        createdAt: now,
        updatedAt: now
      })
      await publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'schema',
        documentId: 'article',
        schemaKey: 'article',
        path: '/article',
        legacyPath: '/article',
        seo: null,
        now
      })
      await publishCanonicalRoute({
        db: fixture.db as any,
        documentKind: 'content',
        documentId: 'content-a',
        schemaKey: 'article',
        path: '/article/hello',
        legacyPath: '/article/content-a',
        seo: null,
        now
      })

      await expect(listCanonicalPublicRoutes(fixture.db as any)).resolves.toEqual([])
      await fixture.db.update(schemaRole).set({ canRead: true }).where(and(
        eq(schemaRole.schemaKey, 'article'),
        eq(schemaRole.roleKey, 'anonymous')
      ))
      await expect(listCanonicalPublicRoutes(fixture.db as any)).resolves.toMatchObject([
        { path: '/article', documentKind: 'schema' },
        { path: '/article/hello', documentKind: 'content' }
      ])
      await fixture.db.update(schemaActive).set({ status: 'inactive' }).where(eq(schemaActive.schemaKey, 'article'))
      await expect(resolvePublicRoute(fixture.db as any, '/article/hello')).resolves.toBeNull()
      await expect(listCanonicalPublicRoutes(fixture.db as any)).resolves.toEqual([])
    } finally {
      fixture.close()
    }
  })
})
