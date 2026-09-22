import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { discardContentWorking, publishContentWorking, saveContentWorking, unpublishContent } from '../server/cms/content-publication'
import {
  deletePage,
  discardPageWorking,
  publishPageWorking,
  recoverPage,
  restorePageRevision,
  savePageWorking,
  unpublishPage
} from '../server/cms/page-publication'
import type { SchemaRegistry } from '../server/cms/types'
import {
  content,
  contentListing,
  documentAssetRef,
  fullTextControl,
  fullTextJob,
  page,
  publicationRevision,
  schema,
  schemaActive
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const event = { context: {} } as any

const registry: SchemaRegistry = {
  schemaKey: 'article',
  version: 1,
  title: 'Article',
  listing: { titleFieldKey: 'title', imageFieldKey: 'cover' },
  fields: [
    {
      fieldId: 'article-title',
      key: 'title',
      kind: 'string',
      title: 'Title',
      search: { mode: 'off', fullText: true }
    },
    { fieldId: 'article-cover', key: 'cover', kind: 'asset', title: 'Cover' }
  ],
  relations: []
}

async function seedSchema(db: any) {
  const now = new Date('2026-07-13T00:00:00.000Z')
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

async function getContent(db: any, id: string) {
  return await db.select().from(content).where(eq(content.id, id)).get()
}

async function getPage(db: any, id: string) {
  return await db.select().from(page).where(eq(page.id, id)).get()
}

describe('publication transitions', () => {
  it('keeps content public projections immutable through draft, discard, republish, and unpublish', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      await seedSchema(db)
      const createdAt = new Date('2026-07-13T00:01:00.000Z')
      await db.insert(content).values({
        id: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify({ title: 'Initial', cover: 'asset-initial' }),
        createdAt,
        updatedAt: createdAt
      })

      let row = await getContent(db, 'article-1')
      const first = await publishContentWorking({
        event,
        db,
        existing: row,
        schemaKey: 'article',
        active: { version: 1, registry },
        content: { title: 'Live', cover: 'asset-live' },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      expect(first).toMatchObject({ publicationState: 'published', hasPublishedRevision: true })
      row = await getContent(db, 'article-1')
      const firstRevisionId = row.publishedRevisionId

      await saveContentWorking({
        event,
        db,
        existing: row,
        schemaKey: 'article',
        active: { version: 1, registry },
        content: { title: 'Draft edit', cover: 'asset-draft' },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getContent(db, 'article-1')
      expect(row).toMatchObject({ status: 'draft', publishedRevisionId: firstRevisionId })

      const listings = await db.select().from(contentListing)
        .where(eq(contentListing.contentId, 'article-1'))
        .orderBy(asc(contentListing.projectionScope))
      expect(listings.map((item: any) => [item.projectionScope, item.title, item.status])).toEqual([
        ['published', 'Live', 'published'],
        ['working', 'Draft edit', 'draft']
      ])
      const refs = await db.select().from(documentAssetRef)
        .where(and(eq(documentAssetRef.documentKind, 'content'), eq(documentAssetRef.documentId, 'article-1')))
        .orderBy(asc(documentAssetRef.projectionScope))
      expect(refs.map((item: any) => [item.projectionScope, item.assetId])).toEqual([
        ['published', 'asset-live'],
        ['working', 'asset-draft']
      ])

      await discardContentWorking({
        event,
        db,
        existing: row,
        schemaKey: 'article',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getContent(db, 'article-1')
      expect(row.status).toBe('published')
      expect(JSON.parse(row.contentJson)).toEqual({ title: 'Live', cover: 'asset-live' })

      await saveContentWorking({
        event,
        db,
        existing: row,
        schemaKey: 'article',
        active: { version: 1, registry },
        content: { title: 'Live v2', cover: 'asset-v2' },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getContent(db, 'article-1')
      await publishContentWorking({
        event,
        db,
        existing: row,
        schemaKey: 'article',
        active: { version: 1, registry },
        content: { title: 'Live v2', cover: 'asset-v2' },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getContent(db, 'article-1')
      expect(row.publishedRevisionId).not.toBe(firstRevisionId)
      const revisions = await db.select().from(publicationRevision)
        .where(and(eq(publicationRevision.documentKind, 'content'), eq(publicationRevision.documentId, 'article-1')))
      expect(revisions).toHaveLength(2)
      expect(revisions.some((revision: any) => revision.id === firstRevisionId && JSON.parse(revision.contentJson).title === 'Live')).toBe(true)

      const unpublished = await unpublishContent({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      expect(unpublished).toMatchObject({ publicationState: 'unpublished', hasPublishedRevision: false })
      row = await getContent(db, 'article-1')
      expect(row).toMatchObject({ status: 'archived', publishedRevisionId: null, publishedAt: null })
      expect(await db.select().from(contentListing).where(and(
        eq(contentListing.contentId, 'article-1'),
        eq(contentListing.projectionScope, 'published')
      ))).toHaveLength(0)
      expect(await db.select({
        projectionScope: contentListing.projectionScope,
        status: contentListing.status,
        title: contentListing.title
      }).from(contentListing).where(and(
        eq(contentListing.contentId, 'article-1'),
        eq(contentListing.projectionScope, 'working')
      ))).toEqual([{
        projectionScope: 'working',
        status: 'archived',
        title: 'Live v2'
      }])
      expect(await db.select().from(publicationRevision).where(and(
        eq(publicationRevision.documentKind, 'content'),
        eq(publicationRevision.documentId, 'article-1')
      ))).toHaveLength(2)
      expect(await db.select({
        operation: fullTextJob.operation,
        fieldId: fullTextJob.fieldId,
        targetRevisionId: fullTextJob.targetRevisionId,
        status: fullTextJob.status
      }).from(fullTextJob).where(eq(fullTextJob.documentId, 'article-1'))
        .orderBy(asc(fullTextJob.createdAt))).toEqual([
        {
          operation: 'index',
          fieldId: 'article-title',
          targetRevisionId: firstRevisionId,
          status: 'pending'
        },
        {
          operation: 'index',
          fieldId: 'article-title',
          targetRevisionId: revisions.find((revision: any) => revision.id !== firstRevisionId)!.id,
          status: 'pending'
        },
        {
          operation: 'remove',
          fieldId: '*',
          targetRevisionId: revisions.find((revision: any) => revision.id !== firstRevisionId)!.id,
          status: 'pending'
        }
      ])
      expect(await db.select({
        queryEpoch: fullTextControl.queryEpoch
      }).from(fullTextControl).where(eq(fullTextControl.key, 'singleton')).get())
        .toEqual({ queryEpoch: 4 })
    } finally {
      fixture.close()
    }
  })

  it('keeps standalone page revisions and asset scopes isolated', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      const createdAt = new Date('2026-07-13T00:02:00.000Z')
      await db.insert(page).values({
        id: 'page-1',
        title: 'Initial',
        status: 'draft',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        createdAt,
        updatedAt: createdAt
      })
      let row = await getPage(db, 'page-1')
      const published = await publishPageWorking({
        event,
        db,
        existing: row,
        title: 'Public page',
        content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/assets/page-live/raw' } }] },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(published.updatedAt).toEqual(row.updatedAt)
      expect(published.transitionAt).toEqual(row.transitionAt)
      const revisionId = row.publishedRevisionId

      const saved = await savePageWorking({
        event,
        db,
        existing: row,
        title: 'Draft page',
        content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/assets/page-draft/raw' } }] },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(saved.updatedAt).toEqual(row.updatedAt)
      expect(row).toMatchObject({ title: 'Draft page', status: 'draft', publishedRevisionId: revisionId })
      expect((await db.select().from(documentAssetRef).where(and(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentId, 'page-1')
      ))).map((item: any) => `${item.projectionScope}:${item.assetId}`).sort()).toEqual([
        'published:page-live',
        'working:page-draft'
      ])

      const discarded = await discardPageWorking({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(discarded.updatedAt).toEqual(row.updatedAt)
      expect(discarded.transitionAt).toEqual(row.transitionAt)
      expect(row).toMatchObject({ title: 'Public page', status: 'published', publishedRevisionId: revisionId })
      const unpublished = await unpublishPage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      expect(unpublished.publicationState).toBe('unpublished')
      row = await getPage(db, 'page-1')
      expect(unpublished.updatedAt).toEqual(row.updatedAt)
      expect(unpublished.transitionAt).toEqual(row.transitionAt)
      expect(await db.select().from(documentAssetRef).where(and(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentId, 'page-1'),
        eq(documentAssetRef.projectionScope, 'published')
      ))).toHaveLength(0)

      const deleted = await deletePage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(deleted.updatedAt).toEqual(row.updatedAt)
      expect(deleted.transitionAt).toEqual(row.transitionAt)
      expect(deleted.deletedAt).toEqual(row.deletedAt)

      const recovered = await recoverPage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(recovered.updatedAt).toEqual(row.updatedAt)
      expect(recovered.transitionAt).toEqual(row.transitionAt)
      expect(recovered.deletedAt).toBeNull()

      const restored = await restorePageRevision({
        event,
        db,
        existing: row,
        title: 'Restored page',
        content: { type: 'doc', content: [] },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db, 'page-1')
      expect(restored.updatedAt).toEqual(row.updatedAt)
      expect(restored.transitionAt).toEqual(row.transitionAt)
    } finally {
      fixture.close()
    }
  })
})
