import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { content, documentAssetRef, page, schema as schemaTable, schemaActive } from '../server/db/schema'
import { assertAssetIsNotRetained, requireAssetDelivery } from '../server/utils/asset-delivery'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
const authState = vi.hoisted(() => ({ accountType: null as null | 'staff' | 'member' }))

vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.mock('../server/utils/auth', () => ({
  getAuthSession: vi.fn(async () => authState.accountType
    ? { user: { id: 'user-1', accountType: authState.accountType } }
    : null),
  requireAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } }))
}))
vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: vi.fn(async () => ({ revision: 1 }))
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)

afterAll(() => {
  vi.unstubAllGlobals()
})

function responseEvent() {
  const headers = new Map<string, unknown>()
  return {
    event: { node: { res: { setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value) } } },
    header: (name: string) => headers.get(name.toLowerCase())
  }
}

beforeEach(() => {
  authState.accountType = null
})

async function seedActiveArticle(db: any) {
  const now = new Date('2026-07-14T00:00:00.000Z')
  await db.insert(schemaTable).values({
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
    createdAt: now
  })
  await db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 1, updatedAt: now })
  await db.insert(content).values({
    id: 'article-1',
    schemaKey: 'article',
    schemaVersion: 1,
    status: 'published',
    contentJson: '{}',
    createdAt: now,
    updatedAt: now
  })
}

describe('asset delivery retention', () => {
  it('keeps working-only assets private while published assets remain public', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedActiveArticle(fixture.db)
      await fixture.db.insert(documentAssetRef).values([
        { documentKind: 'content', documentId: 'article-1', projectionScope: 'working', assetId: 'draft-only' },
        { documentKind: 'content', documentId: 'article-1', projectionScope: 'published', assetId: 'live' }
      ])

      await expect(requireAssetDelivery(responseEvent().event as any, 'draft-only'))
        .rejects.toMatchObject({ statusCode: 404, statusMessage: 'Asset not found' })

      const publicRequest = responseEvent()
      await expect(requireAssetDelivery(publicRequest.event as any, 'live')).resolves.toEqual({ isPublic: true })
      expect(publicRequest.header('cache-control')).toMatch(/^public,/)

      authState.accountType = 'staff'
      const privateRequest = responseEvent()
      await expect(requireAssetDelivery(privateRequest.event as any, 'draft-only')).resolves.toEqual({ isPublic: false })
      expect(privateRequest.header('cache-control')).toBe('private, no-store')

      authState.accountType = 'member'
      await expect(requireAssetDelivery(responseEvent().event as any, 'draft-only'))
        .rejects.toMatchObject({ statusCode: 404, statusMessage: 'Asset not found' })
      const memberPublicRequest = responseEvent()
      await expect(requireAssetDelivery(memberPublicRequest.event as any, 'live')).resolves.toEqual({ isPublic: true })
      expect(memberPublicRequest.header('cache-control')).toMatch(/^public,/)
    } finally {
      fixture.close()
    }
  })

  it('publishes and retains branding assets referenced by site settings', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(documentAssetRef).values({
        documentKind: 'settings',
        documentId: 'site.presentation',
        projectionScope: 'published',
        assetId: 'brand-logo'
      })

      const publicRequest = responseEvent()
      await expect(requireAssetDelivery(publicRequest.event as any, 'brand-logo')).resolves.toEqual({ isPublic: true })
      expect(publicRequest.header('cache-control')).toMatch(/^public,/)
      await expect(assertAssetIsNotRetained(fixture.db as any, 'brand-logo'))
        .rejects.toMatchObject({ statusCode: 409 })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('blocks assets owned only by inactive content while retaining shared page delivery', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedActiveArticle(fixture.db)
      await fixture.db.insert(documentAssetRef).values([
        { documentKind: 'content', documentId: 'article-1', projectionScope: 'published', assetId: 'inactive-only' },
        { documentKind: 'content', documentId: 'article-1', projectionScope: 'published', assetId: 'shared' },
        { documentKind: 'page', documentId: 'page-1', projectionScope: 'published', assetId: 'shared' }
      ])

      await expect(requireAssetDelivery(responseEvent().event as any, 'inactive-only'))
        .resolves.toEqual({ isPublic: true })
      await fixture.db.update(schemaActive).set({ status: 'inactive' }).where(eq(schemaActive.schemaKey, 'article'))
      await expect(requireAssetDelivery(responseEvent().event as any, 'inactive-only'))
        .rejects.toMatchObject({ statusCode: 404, statusMessage: 'Asset not found' })
      await expect(requireAssetDelivery(responseEvent().event as any, 'shared'))
        .resolves.toEqual({ isPublic: true })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects deletion while either working or published scope retains an asset', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(documentAssetRef).values({
        documentKind: 'page',
        documentId: 'page-1',
        projectionScope: 'working',
        assetId: 'retained'
      })
      await expect(assertAssetIsNotRetained(fixture.db as any, 'retained'))
        .rejects.toMatchObject({ statusCode: 409 })
      await expect(assertAssetIsNotRetained(fixture.db as any, 'unused')).resolves.toBeUndefined()
    } finally {
      fixture.close()
    }
  })

  it('keeps working references for recoverable soft-deleted pages while removing public references', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-13T00:00:00.000Z')
      await fixture.db.insert(page).values({
        id: 'recoverable-page',
        title: 'Recoverable page',
        status: 'published',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        publishedRevisionId: null,
        createdAt: now,
        updatedAt: now
      })
      await fixture.db.insert(documentAssetRef).values([
        { documentKind: 'page', documentId: 'recoverable-page', projectionScope: 'working', assetId: 'draft-dependency' },
        { documentKind: 'page', documentId: 'recoverable-page', projectionScope: 'published', assetId: 'public-dependency' }
      ])

      const handler = (await import('../server/api/page/[id].delete')).default as (event: any) => Promise<any>
      await expect(handler({ context: { params: { id: 'recoverable-page' } } })).resolves.toMatchObject({
        ok: true,
        publicationState: 'deleted',
        revision: 2
      })

      const storedPage = await fixture.db.select().from(page).where(eq(page.id, 'recoverable-page')).get()
      expect(storedPage).toMatchObject({ status: 'deleted', publishedRevisionId: null })
      const refs = await fixture.db.select().from(documentAssetRef).where(and(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentId, 'recoverable-page')
      ))
      expect(refs.map((ref: any) => `${ref.projectionScope}:${ref.assetId}`)).toEqual([
        'working:draft-dependency'
      ])
      await expect(assertAssetIsNotRetained(fixture.db as any, 'draft-dependency'))
        .rejects.toMatchObject({ statusCode: 409 })
      await expect(assertAssetIsNotRetained(fixture.db as any, 'public-dependency')).resolves.toBeUndefined()
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})
