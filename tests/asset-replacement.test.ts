import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { syncDocumentAssetRefs } from '../server/cms/asset-refs'
import { syncContentProjections } from '../server/cms/content-projections'
import type { SchemaRegistry } from '../server/cms/types'
import {
  asset,
  content,
  contentRef,
  contentRefList,
  documentAssetRef,
  page,
  publicationRevision,
  schema,
  schemaActive
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
const bodyState = vi.hoisted(() => ({ current: {} as { replacementId?: string } }))
const multipartState = vi.hoisted(() => ({ current: [] as any[] }))
const storageState = vi.hoisted(() => ({ deleteObject: vi.fn(), putObject: vi.fn() }))

vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.mock('../server/utils/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } })) }))
vi.mock('../server/storage/assets', () => ({
  assetObjectKey: (_event: unknown, assetId: string) => `assets/${assetId}/original`,
  deleteObject: storageState.deleteObject,
  putObject: storageState.putObject
}))
vi.mock('../server/utils/widget-cache', () => ({ queueWidgetCacheInvalidation: vi.fn() }))
vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: vi.fn(async () => bodyState.current),
  readMultipartFormData: vi.fn(async () => multipartState.current)
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)

afterAll(() => {
  vi.unstubAllGlobals()
})

const registry: SchemaRegistry = {
  schemaKey: 'article',
  version: 1,
  title: 'Article',
  listing: { titleFieldKey: 'title', imageFieldKey: 'cover' },
  fields: [
    { fieldId: 'article-title', key: 'title', kind: 'string', title: 'Title' },
    { fieldId: 'article-cover', key: 'cover', kind: 'asset', title: 'Cover' },
    { fieldId: 'article-gallery', key: 'gallery', kind: 'asset_list', title: 'Gallery' },
    { fieldId: 'article-body', key: 'body', kind: 'richtext', title: 'Body' }
  ],
  relations: [{
    fieldId: 'article-cover',
    fieldKey: 'cover',
    targetKind: 'asset',
    kind: 'asset_ref'
  }, {
    fieldId: 'article-gallery',
    fieldKey: 'gallery',
    targetKind: 'asset',
    kind: 'asset_ref'
  }]
}

const now = new Date('2026-07-13T00:00:00.000Z')

async function seedSchema(db: any) {
  await db.insert(schema).values({
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object' }),
    registryJson: JSON.stringify(registry),
    createdAt: now
  })
  await db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 1, updatedAt: now })
}

async function seedAsset(db: any, id: string) {
  await db.insert(asset).values({
    id,
    kind: 'image',
    status: 'ready',
    objectKey: `assets/${id}/original`,
    mimeType: 'image/png',
    sizeBytes: 100,
    createdAt: now
  })
}

beforeEach(() => {
  bodyState.current = {}
  multipartState.current = [{
    name: 'file',
    type: 'image/webp',
    filename: 'replacement.webp',
    data: new Uint8Array([1, 2, 3, 4])
  }]
  storageState.deleteObject.mockReset()
  storageState.putObject.mockReset()
})

describe('asset deletion with replacement', () => {
  it('replaces working content and page references without touching published projections', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedSchema(fixture.db)
      await seedAsset(fixture.db, 'old-asset')
      await seedAsset(fixture.db, 'new-asset')

      const workingContent = {
        title: 'Draft',
        cover: 'old-asset',
        body: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: '/assets/old-asset/raw?width=640' } }]
        }
      }
      await fixture.db.insert(content).values({
        id: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify(workingContent),
        createdAt: now,
        updatedAt: now
      })
      await syncContentProjections({
        db: fixture.db as any,
        registry,
        content: workingContent,
        contentId: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        projectionScope: 'working'
      })

      const richTextOnlyContent = {
        title: 'Rich text draft',
        cover: 'new-asset',
        body: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: '/assets/old-asset/raw?fit=cover' } }]
        }
      }
      await fixture.db.insert(content).values({
        id: 'article-richtext',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify(richTextOnlyContent),
        createdAt: now,
        updatedAt: now
      })
      await syncContentProjections({
        db: fixture.db as any,
        registry,
        content: richTextOnlyContent,
        contentId: 'article-richtext',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        projectionScope: 'working'
      })

      const workingPage = {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: '/assets/old-asset/raw#hero' } }]
      }
      await fixture.db.insert(page).values({
        id: 'page-1',
        title: 'Draft page',
        status: 'draft',
        contentJson: JSON.stringify(workingPage),
        createdAt: now,
        updatedAt: now
      })
      await syncDocumentAssetRefs({
        db: fixture.db as any,
        documentKind: 'page',
        documentId: 'page-1',
        projectionScope: 'working',
        content: workingPage
      })

      bodyState.current = { replacementId: 'new-asset' }
      const handler = (await import('../server/api/assets/[assetId]/delete.post')).default as (event: any) => Promise<any>
      const event = { context: { params: { assetId: 'old-asset' } } }
      await expect(handler(event)).resolves.toEqual({ ok: true, replacedCount: 3 })

      const storedContent = await fixture.db.select().from(content).where(eq(content.id, 'article-1')).get()
      expect(JSON.parse(storedContent!.contentJson)).toMatchObject({
        cover: 'new-asset',
        body: { content: [{ attrs: { src: '/assets/new-asset/raw?width=640' } }] }
      })
      const storedRichText = await fixture.db.select().from(content).where(eq(content.id, 'article-richtext')).get()
      expect(JSON.parse(storedRichText!.contentJson)).toMatchObject({
        cover: 'new-asset',
        body: { content: [{ attrs: { src: '/assets/new-asset/raw?fit=cover' } }] }
      })
      const storedPage = await fixture.db.select().from(page).where(eq(page.id, 'page-1')).get()
      expect(JSON.parse(storedPage!.contentJson)).toMatchObject({
        content: [{ attrs: { src: '/assets/new-asset/raw#hero' } }]
      })

      expect(await fixture.db.select().from(documentAssetRef).where(eq(documentAssetRef.assetId, 'old-asset'))).toHaveLength(0)
      expect((await fixture.db.select().from(documentAssetRef).where(eq(documentAssetRef.assetId, 'new-asset')))
        .map(ref => `${ref.documentKind}:${ref.documentId}:${ref.projectionScope}`).sort()).toEqual([
        'content:article-1:working',
        'content:article-richtext:working',
        'page:page-1:working'
      ])
      expect(await fixture.db.select().from(contentRef).where(and(
        eq(contentRef.contentId, 'article-1'),
        eq(contentRef.projectionScope, 'working')
      ))).toMatchObject([{ targetId: 'new-asset' }])
      expect(await fixture.db.select().from(asset).where(eq(asset.id, 'old-asset'))).toHaveLength(0)
      expect(storageState.deleteObject).toHaveBeenCalledWith(event, 'assets/old-asset/original')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('replaces an ordered asset-list item without changing its metadata or position', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedSchema(fixture.db)
      await seedAsset(fixture.db, 'old-asset')
      await seedAsset(fixture.db, 'new-asset')
      const workingContent = {
        title: 'Gallery',
        gallery: [
          { assetId: 'old-asset', alt: 'old-asset', caption: 'Hero' },
          { assetId: 'new-asset', alt: 'Detail' }
        ]
      }
      await fixture.db.insert(content).values({
        id: 'gallery-1', schemaKey: 'article', schemaVersion: 1, status: 'draft',
        contentJson: JSON.stringify(workingContent), createdAt: now, updatedAt: now
      })
      await syncContentProjections({
        db: fixture.db as any, registry, content: workingContent, contentId: 'gallery-1', schemaKey: 'article',
        schemaVersion: 1, status: 'draft', createdAt: now, updatedAt: now, projectionScope: 'working'
      })

      bodyState.current = { replacementId: 'new-asset' }
      const handler = (await import('../server/api/assets/[assetId]/delete.post')).default as (event: any) => Promise<any>
      await expect(handler({ context: { params: { assetId: 'old-asset' } } })).resolves.toEqual({ ok: true, replacedCount: 1 })

      const stored = await fixture.db.select().from(content).where(eq(content.id, 'gallery-1')).get()
      expect(JSON.parse(stored!.contentJson).gallery).toEqual([
        { assetId: 'new-asset', alt: 'old-asset', caption: 'Hero' },
        { assetId: 'new-asset', alt: 'Detail' }
      ])
      expect((await fixture.db.select().from(contentRefList).where(eq(contentRefList.ownerContentId, 'gallery-1')))
        .map(row => ({ position: row.position, assetId: row.assetId, meta: row.metaJson && JSON.parse(row.metaJson) }))).toEqual([
        { position: 0, assetId: 'new-asset', meta: { alt: 'old-asset', caption: 'Hero' } },
        { position: 1, assetId: 'new-asset', meta: { alt: 'Detail' } }
      ])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('removes a working-only asset-list item and compacts ordered refs', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedSchema(fixture.db)
      await seedAsset(fixture.db, 'old-asset')
      await seedAsset(fixture.db, 'kept-asset')
      const workingContent = {
        title: 'Gallery',
        gallery: [
          { assetId: 'old-asset', alt: 'Remove me' },
          { assetId: 'kept-asset', alt: 'Keep me', caption: 'Second' }
        ]
      }
      await fixture.db.insert(content).values({
        id: 'gallery-delete', schemaKey: 'article', schemaVersion: 1, status: 'draft',
        contentJson: JSON.stringify(workingContent), createdAt: now, updatedAt: now
      })
      await syncContentProjections({
        db: fixture.db as any, registry, content: workingContent, contentId: 'gallery-delete', schemaKey: 'article',
        schemaVersion: 1, status: 'draft', createdAt: now, updatedAt: now, projectionScope: 'working'
      })

      bodyState.current = {}
      const handler = (await import('../server/api/assets/[assetId]/delete.post')).default as (event: any) => Promise<any>
      await expect(handler({ context: { params: { assetId: 'old-asset' } } })).resolves.toEqual({ ok: true, replacedCount: 1 })

      const stored = await fixture.db.select().from(content).where(eq(content.id, 'gallery-delete')).get()
      expect(JSON.parse(stored!.contentJson).gallery).toEqual([{ assetId: 'kept-asset', alt: 'Keep me', caption: 'Second' }])
      expect(await fixture.db.select().from(contentRefList).where(eq(contentRefList.ownerContentId, 'gallery-delete')))
        .toMatchObject([{ position: 0, assetId: 'kept-asset' }])
      expect(await fixture.db.select().from(asset).where(eq(asset.id, 'old-asset'))).toHaveLength(0)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects replacement when a published revision retains the asset', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedSchema(fixture.db)
      await seedAsset(fixture.db, 'old-asset')
      await seedAsset(fixture.db, 'new-asset')
      const publishedContent = { title: 'Live', cover: 'old-asset' }
      await fixture.db.insert(publicationRevision).values({
        id: 'revision-1',
        documentKind: 'content',
        documentId: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        contentJson: JSON.stringify(publishedContent),
        createdAt: now
      })
      await fixture.db.insert(content).values({
        id: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'published',
        contentJson: JSON.stringify(publishedContent),
        publishedRevisionId: 'revision-1',
        createdAt: now,
        updatedAt: now
      })
      for (const projectionScope of ['working', 'published'] as const) {
        await syncContentProjections({
          db: fixture.db as any,
          registry,
          content: publishedContent,
          contentId: 'article-1',
          schemaKey: 'article',
          schemaVersion: 1,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          projectionScope
        })
      }

      bodyState.current = { replacementId: 'new-asset' }
      const handler = (await import('../server/api/assets/[assetId]/delete.post')).default as (event: any) => Promise<any>
      await expect(handler({ context: { params: { assetId: 'old-asset' } } }))
        .rejects.toMatchObject({ statusCode: 409, statusMessage: 'Asset is referenced by a published document' })

      const storedContent = await fixture.db.select().from(content).where(eq(content.id, 'article-1')).get()
      const storedRevision = await fixture.db.select().from(publicationRevision).where(eq(publicationRevision.id, 'revision-1')).get()
      expect(storedContent!.contentJson).toBe(JSON.stringify(publishedContent))
      expect(storedRevision!.contentJson).toBe(JSON.stringify(publishedContent))
      expect(await fixture.db.select().from(asset).where(eq(asset.id, 'old-asset'))).toHaveLength(1)
      expect(storageState.deleteObject).not.toHaveBeenCalled()
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})

describe('in-place asset replacement', () => {
  it('rejects replacement before storage mutation when a published document retains the asset', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedAsset(fixture.db, 'published-asset')
      await fixture.db.insert(documentAssetRef).values({
        documentKind: 'content',
        documentId: 'article-public',
        projectionScope: 'published',
        assetId: 'published-asset'
      })

      const handler = (await import('../server/api/assets/[assetId]/replace.post')).default as (event: any) => Promise<any>
      await expect(handler({ context: { params: { assetId: 'published-asset' } } }))
        .rejects.toMatchObject({ statusCode: 409, statusMessage: 'Asset is referenced by a published document' })

      expect(storageState.putObject).not.toHaveBeenCalled()
      await expect(fixture.db.select().from(asset).where(eq(asset.id, 'published-asset')).get())
        .resolves.toMatchObject({ mimeType: 'image/png', sizeBytes: 100 })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('keeps same-ID replacement available for working-only assets', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedAsset(fixture.db, 'working-asset')
      await fixture.db.insert(documentAssetRef).values({
        documentKind: 'page',
        documentId: 'page-draft',
        projectionScope: 'working',
        assetId: 'working-asset'
      })

      const event = { context: { params: { assetId: 'working-asset' } } }
      const handler = (await import('../server/api/assets/[assetId]/replace.post')).default as (event: any) => Promise<any>
      await expect(handler(event)).resolves.toEqual({
        ok: true,
        assetId: 'working-asset',
        mimeType: 'image/webp',
        sizeBytes: 4
      })

      expect(storageState.putObject).toHaveBeenCalledWith(
        event,
        'assets/working-asset/original',
        expect.any(Uint8Array),
        'image/webp'
      )
      await expect(fixture.db.select().from(asset).where(eq(asset.id, 'working-asset')).get())
        .resolves.toMatchObject({ mimeType: 'image/webp', sizeBytes: 4, objectKey: 'assets/working-asset/original' })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})
