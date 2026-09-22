import { and, eq, or, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  deactivateSchema,
  deleteEmptySchema,
  deleteSchemaResidue,
  getSchemaDependencyImpact,
  purgeSchema,
  reactivateSchema
} from '../server/cms/schema-lifecycle'
import { syncContentListing } from '../server/cms/content-listing'
import { getActiveSchema, getPublishedSchema, listActiveSchemas } from '../server/cms/repo'
import { syncContentRefs } from '../server/cms/ref-sync'
import {
  asset,
  content,
  contentListing,
  contentRef,
  contentRefList,
  contentSearchData,
  documentAssetRef,
  documentRevision,
  layoutReference,
  layoutResource,
  publicationRevision,
  schema,
  schemaActive,
  schemaDraft,
  schemaRole,
  searchConfig
} from '../server/db/schema'
import { runMigrations, seedRoles } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

async function seedSchemaLifecycle(db: any) {
  const now = new Date('2026-07-14T00:00:00.000Z')
  const schemaAst = (schemaKey: string) => JSON.stringify({ schemaKey, title: schemaKey, fields: [] })
  const registry = JSON.stringify({ fields: [], relations: [] })

  await seedRoles(db)
  await db.insert(schema).values([
    {
      schemaKey: 'article',
      version: 1,
      title: 'Article',
      astJson: schemaAst('article'),
      jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
      registryJson: registry,
      createdAt: now
    },
    {
      schemaKey: 'external',
      version: 1,
      title: 'External',
      astJson: schemaAst('external'),
      jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
      registryJson: registry,
      createdAt: now
    }
  ])
  await db.insert(schemaActive).values([
    { schemaKey: 'article', activeVersion: 1, updatedAt: now },
    { schemaKey: 'external', activeVersion: 1, updatedAt: now }
  ])
  await db.insert(schemaDraft).values({
    schemaKey: 'article',
    title: 'Article',
    astJson: schemaAst('article'),
    currentRevision: 2,
    updatedAt: now
  })
  await db.insert(schemaRole).values({
    schemaKey: 'article',
    roleKey: 'anonymous',
    canRead: true,
    canWrite: false,
    canAdmin: false
  })
  await db.insert(content).values([
    {
      id: 'article-published',
      schemaKey: 'article',
      schemaVersion: 1,
      status: 'published',
      contentJson: JSON.stringify({ title: 'Published', related: 'external-owner' }),
      publishedRevisionId: 'publication-article',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'article-draft',
      schemaKey: 'article',
      schemaVersion: 1,
      status: 'draft',
      contentJson: JSON.stringify({ title: 'Draft' }),
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'external-owner',
      schemaKey: 'external',
      schemaVersion: 1,
      status: 'draft',
      contentJson: JSON.stringify({ article: 'article-published' }),
      createdAt: now,
      updatedAt: now
    }
  ])
  await db.insert(contentListing).values([
    { contentId: 'article-published', schemaKey: 'article', schemaVersion: 1, title: 'Published', status: 'published', createdAt: now, updatedAt: now },
    { contentId: 'article-published', projectionScope: 'published', schemaKey: 'article', schemaVersion: 1, title: 'Published', status: 'published', createdAt: now, updatedAt: now },
    { contentId: 'article-draft', schemaKey: 'article', schemaVersion: 1, title: 'Draft', status: 'draft', createdAt: now, updatedAt: now },
    { contentId: 'external-owner', schemaKey: 'external', schemaVersion: 1, title: 'External', status: 'draft', createdAt: now, updatedAt: now }
  ])
  await db.insert(searchConfig).values({
    schemaKey: 'article',
    fieldId: 'article-title',
    fieldKey: 'title',
    kind: 'string',
    searchMode: 'exact'
  })
  await db.insert(contentSearchData).values([
    { contentId: 'article-published', fieldId: 'article-title', dataType: 'text', text: 'Published' },
    { contentId: 'article-published', projectionScope: 'published', fieldId: 'article-title', dataType: 'text', text: 'Published' }
  ])
  await db.insert(contentRef).values([
    { contentId: 'article-published', fieldPath: 'related', targetKind: 'content', targetSchemaKey: 'external', targetId: 'external-owner' },
    { contentId: 'external-owner', fieldPath: 'article', targetKind: 'content', targetSchemaKey: 'article', targetId: 'article-published' }
  ])
  await db.insert(contentRefList).values([
    { ownerContentId: 'article-published', fieldKey: 'related', position: 0, itemKind: 'content', itemSchemaKey: 'external', itemId: 'external-owner' },
    { ownerContentId: 'external-owner', fieldKey: 'articles', position: 0, itemKind: 'content', itemSchemaKey: 'article', itemId: 'article-published' }
  ])
  await db.insert(publicationRevision).values({
    id: 'publication-article',
    documentKind: 'content',
    documentId: 'article-published',
    schemaKey: 'article',
    schemaVersion: 1,
    contentJson: JSON.stringify({ title: 'Published' }),
    createdAt: now
  })
  await db.insert(publicationRevision).values({
    id: 'publication-page-collision',
    documentKind: 'page',
    documentId: 'article-published',
    title: 'Unrelated page',
    contentJson: JSON.stringify({ title: 'Unrelated page' }),
    createdAt: now
  })
  await db.insert(documentRevision).values([
    {
      id: 'document-article',
      documentKind: 'content',
      documentId: 'article-published',
      schemaKey: 'article',
      revision: 1,
      action: 'publish',
      snapshotJson: JSON.stringify({ title: 'Published' }),
      createdAt: now
    },
    {
      id: 'document-schema-draft',
      documentKind: 'schema-draft',
      documentId: 'article',
      schemaKey: 'article',
      revision: 2,
      action: 'save',
      snapshotJson: schemaAst('article'),
      createdAt: now
    },
    {
      id: 'document-page-collision',
      documentKind: 'page',
      documentId: 'article-published',
      revision: 1,
      action: 'publish',
      snapshotJson: JSON.stringify({ title: 'Unrelated page' }),
      createdAt: now
    }
  ])
  await db.insert(asset).values({
    id: 'article-asset',
    kind: 'image',
    status: 'ready',
    objectKey: 'article-asset',
    mimeType: 'image/png',
    sizeBytes: 1,
    createdAt: now
  })
  await db.insert(documentAssetRef).values({
    documentKind: 'content',
    documentId: 'article-published',
    projectionScope: 'working',
    assetId: 'article-asset'
  })
}

async function seedSchemaLayoutReferences(db: any) {
  const layoutAt = new Date('2026-07-14T00:00:30.000Z')
  await db.insert(layoutResource).values({
    id: 'layout-schema-history',
    name: 'Schema history Layout',
    nameKey: 'schema history layout',
    documentJson: '{}',
    createdAt: layoutAt,
    updatedAt: layoutAt
  })
  await db.insert(layoutReference).values([
    {
      ownerType: 'schema',
      ownerId: 'article',
      slot: 'working',
      layoutId: 'layout-schema-history',
      label: 'article draft Layout',
      createdAt: layoutAt,
      updatedAt: layoutAt
    },
    {
      ownerType: 'schema',
      ownerId: 'article',
      slot: 'published:1',
      layoutId: 'layout-schema-history',
      label: 'article v1 Layout',
      createdAt: layoutAt,
      updatedAt: layoutAt
    },
    {
      ownerType: 'schema',
      ownerId: 'external',
      slot: 'published:1',
      layoutId: 'layout-schema-history',
      label: 'external v1 Layout',
      createdAt: layoutAt,
      updatedAt: layoutAt
    }
  ])
}

describe('schema lifecycle', () => {
  it('deactivates and reactivates without losing schema dependencies', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await seedSchemaLayoutReferences(fixture.db)

      const before = await getSchemaDependencyImpact(fixture.db, 'article')
      expect(before).toMatchObject({
        status: 'active',
        counts: {
          contentTotal: 2,
          contentByStatus: { draft: 1, published: 1 },
          versions: 1,
          drafts: 1,
          inboundReferences: 2,
          outboundReferences: 2,
          searchProjections: 2,
          permissions: 1,
          publicationRevisions: 1,
          documentRevisions: 2,
          assetReferences: 1
        }
      })

      const inactive = await deactivateSchema(fixture.db, 'article', 'admin-1')
      expect(inactive).toMatchObject({ status: 'inactive', deactivatedBy: 'admin-1' })
      expect((await listActiveSchemas(fixture.db)).map(item => item.schemaKey)).toEqual(['external'])
      await expect(getActiveSchema(fixture.db, 'article')).resolves.toBeNull()
      await expect(getPublishedSchema(fixture.db, 'article', { includeInactive: true }))
        .resolves.toMatchObject({ schemaKey: 'article', status: 'inactive' })

      const active = await reactivateSchema(fixture.db, 'article', 'admin-2')
      expect(active).toMatchObject({ status: 'active', reactivatedBy: 'admin-2' })
      expect(active.counts).toEqual(before.counts)
      expect((await listActiveSchemas(fixture.db)).map(item => item.schemaKey)).toEqual(['article', 'external'])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerType, 'schema'),
        eq(layoutReference.ownerId, 'article')
      ))).toHaveLength(2)
    } finally {
      fixture.close()
    }
  })

  it('rejects guarded deletion with actionable dependency counts', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await deactivateSchema(fixture.db, 'article', 'admin-1')

      await expect(deleteEmptySchema({ context: {} } as any, fixture.db, 'article')).rejects.toMatchObject({
        statusCode: 409,
        data: {
          impact: expect.objectContaining({
            status: 'inactive',
            counts: expect.objectContaining({ contentTotal: 2, inboundReferences: 2 })
          })
        }
      })
      await expect(purgeSchema({ context: {} } as any, fixture.db, 'article', 'wrong'))
        .rejects.toMatchObject({ statusCode: 400 })
    } finally {
      fixture.close()
    }
  })

  it('deletes an inactive empty schema with its configuration metadata', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(schema).values({
        schemaKey: 'empty',
        version: 1,
        title: 'Empty',
        astJson: JSON.stringify({ schemaKey: 'empty', title: 'Empty', fields: [] }),
        jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
        registryJson: JSON.stringify({ fields: [], relations: [] }),
        createdAt: now
      })
      await fixture.db.insert(schemaActive).values({ schemaKey: 'empty', activeVersion: 1, updatedAt: now })
      await fixture.db.insert(schemaDraft).values({
        schemaKey: 'empty',
        title: 'Empty',
        astJson: JSON.stringify({ schemaKey: 'empty', title: 'Empty', fields: [] }),
        updatedAt: now
      })
      await fixture.db.insert(schemaRole).values({
        schemaKey: 'empty',
        roleKey: 'anonymous',
        canRead: true,
        canWrite: false,
        canAdmin: false
      })
      await deactivateSchema(fixture.db, 'empty', 'admin-1')

      await expect(deleteEmptySchema({ context: {} } as any, fixture.db, 'empty'))
        .resolves.toMatchObject({ canDelete: true, counts: { contentTotal: 0 } })
      await expect(getSchemaDependencyImpact(fixture.db, 'empty'))
        .rejects.toMatchObject({ statusCode: 404 })
    } finally {
      fixture.close()
    }
  })

  it('does not delete an empty schema reactivated after the dependency precheck', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(schema).values({
        schemaKey: 'empty-active',
        version: 1,
        title: 'Empty active',
        astJson: JSON.stringify({ schemaKey: 'empty-active', title: 'Empty active', fields: [] }),
        jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
        registryJson: JSON.stringify({ schemaKey: 'empty-active', version: 1, title: 'Empty active', fields: [], relations: [] }),
        createdAt: now
      })
      await fixture.db.insert(schemaActive).values({
        schemaKey: 'empty-active',
        activeVersion: 1,
        status: 'inactive',
        deactivatedAt: now,
        updatedAt: now
      })

      const staleImpact = await getSchemaDependencyImpact(fixture.db, 'empty-active')
      expect(staleImpact).toMatchObject({ status: 'inactive', canDelete: true })

      await fixture.db.update(schemaActive)
        .set({ status: 'active', reactivatedAt: new Date('2026-07-14T00:01:00.000Z') })
        .where(eq(schemaActive.schemaKey, 'empty-active'))

      // Simulate cleanup continuing from the now-stale dependency impact.
      await deleteSchemaResidue({ context: {} } as any, fixture.db, 'empty-active', { guard: 'empty' })
      await expect(getSchemaDependencyImpact(fixture.db, 'empty-active')).resolves.toMatchObject({ status: 'active' })
    } finally {
      fixture.close()
    }
  })

  it('rebuilds listings with the retained registry while a schema is inactive', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await fixture.db.update(schema).set({
        registryJson: JSON.stringify({
          schemaKey: 'article',
          version: 1,
          title: 'Article',
          fields: [],
          relations: [],
          listing: { titleFieldKey: 'title' }
        })
      }).where(eq(schema.schemaKey, 'article'))
      await fixture.db.update(contentListing).set({ title: null }).where(and(
        eq(contentListing.schemaKey, 'article'),
        eq(contentListing.projectionScope, 'working')
      ))
      await deactivateSchema(fixture.db, 'article', 'admin-1')

      await syncContentListing({ db: fixture.db, schemaKey: 'article', onlyMissing: false })
      expect((await fixture.db.select({ title: contentListing.title })
        .from(contentListing)
        .where(and(
          eq(contentListing.contentId, 'article-published'),
          eq(contentListing.projectionScope, 'working')
        )))
        .map(row => row.title)).toEqual(['Published'])
    } finally {
      fixture.close()
    }
  })

  it('purges all schema residue transactionally without deleting assets or unrelated content', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await seedSchemaLayoutReferences(fixture.db)
      await fixture.db.insert(contentRef).values([
        {
          contentId: 'external-owner',
          fieldPath: 'unscopedArticle',
          targetKind: 'content',
          targetId: 'article-draft'
        },
        {
          contentId: 'external-owner',
          fieldPath: 'unscopedExternal',
          targetKind: 'content',
          targetId: 'external-owner'
        }
      ])
      await fixture.db.insert(contentRefList).values([
        {
          ownerContentId: 'external-owner',
          fieldKey: 'unscopedArticles',
          position: 0,
          itemKind: 'content',
          itemId: 'article-draft'
        },
        {
          ownerContentId: 'external-owner',
          fieldKey: 'unscopedExternals',
          position: 0,
          itemKind: 'content',
          itemId: 'external-owner'
        }
      ])
      await expect(getSchemaDependencyImpact(fixture.db, 'article')).resolves.toMatchObject({
        counts: { inboundReferences: 4 }
      })
      await deactivateSchema(fixture.db, 'article', 'admin-1')
      await purgeSchema({ context: {} } as any, fixture.db, 'article', 'article')

      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaDraft).where(eq(schemaDraft.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerType, 'schema'),
        eq(layoutReference.ownerId, 'article')
      ))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerType, 'schema'),
        eq(layoutReference.ownerId, 'external')
      ))).toHaveLength(1)
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, 'layout-schema-history'))).toHaveLength(1)
      expect(await fixture.db.select().from(content).where(eq(content.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(contentListing).where(eq(contentListing.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(searchConfig).where(eq(searchConfig.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicationRevision).where(eq(publicationRevision.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(documentRevision).where(or(
        eq(documentRevision.schemaKey, 'article'),
        eq(documentRevision.documentId, 'article')
      ))).toEqual([])
      expect(await fixture.db.select().from(publicationRevision)
        .where(eq(publicationRevision.id, 'publication-page-collision'))).toHaveLength(1)
      expect(await fixture.db.select().from(documentRevision)
        .where(eq(documentRevision.id, 'document-page-collision'))).toHaveLength(1)
      expect(await fixture.db.select().from(contentRef).where(eq(contentRef.targetSchemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(contentRefList).where(eq(contentRefList.itemSchemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(contentRef).where(or(
        eq(contentRef.targetId, 'article-published'),
        eq(contentRef.targetId, 'article-draft')
      ))).toEqual([])
      expect(await fixture.db.select().from(contentRefList).where(or(
        eq(contentRefList.itemId, 'article-published'),
        eq(contentRefList.itemId, 'article-draft')
      ))).toEqual([])
      expect(await fixture.db.select().from(contentRef)
        .where(eq(contentRef.fieldPath, 'unscopedExternal'))).toHaveLength(1)
      expect(await fixture.db.select().from(contentRefList)
        .where(eq(contentRefList.fieldKey, 'unscopedExternals'))).toHaveLength(1)
      expect(await fixture.db.select().from(content).where(eq(content.id, 'external-owner'))).toHaveLength(1)
      expect(await fixture.db.select().from(asset).where(eq(asset.id, 'article-asset'))).toHaveLength(1)

      const recreatedAt = new Date('2026-07-14T01:00:00.000Z')
      await fixture.db.insert(schema).values({
        schemaKey: 'article',
        version: 1,
        title: 'Recreated article',
        astJson: JSON.stringify({ schemaKey: 'article', title: 'Recreated article', fields: [] }),
        jsonSchema: JSON.stringify({ type: 'object', properties: {} }),
        registryJson: JSON.stringify({ fields: [], relations: [] }),
        createdAt: recreatedAt
      })
      await fixture.db.insert(schemaActive).values({
        schemaKey: 'article',
        activeVersion: 1,
        status: 'inactive',
        deactivatedAt: recreatedAt,
        updatedAt: recreatedAt
      })

      await syncContentRefs({
        db: fixture.db,
        contentId: 'external-owner',
        registry: {
          schemaKey: 'external',
          version: 1,
          title: 'External',
          fields: [],
          relations: [
            {
              fieldId: 'external-article',
              fieldKey: 'article',
              targetKind: 'content',
              kind: 'ref'
            },
            {
              fieldId: 'external-articles',
              fieldKey: 'articles',
              targetKind: 'content',
              kind: 'ref_list'
            },
            {
              fieldId: 'external-scoped-article',
              fieldKey: 'scopedArticle',
              targetKind: 'content',
              targetSchemaKey: 'article',
              kind: 'ref'
            },
            {
              fieldId: 'external-scoped-articles',
              fieldKey: 'scopedArticles',
              targetKind: 'content',
              targetSchemaKey: 'article',
              kind: 'ref_list'
            },
            {
              fieldId: 'external-live-article',
              fieldKey: 'liveArticle',
              targetKind: 'content',
              kind: 'ref'
            },
            {
              fieldId: 'external-live-articles',
              fieldKey: 'liveArticles',
              targetKind: 'content',
              kind: 'ref_list'
            }
          ]
        },
        content: {
          article: 'article-published',
          articles: ['article-draft'],
          scopedArticle: 'article-published',
          scopedArticles: ['article-draft'],
          liveArticle: 'external-owner',
          liveArticles: ['external-owner']
        }
      })
      expect(await fixture.db.select().from(contentRef).where(or(
        eq(contentRef.targetId, 'article-published'),
        eq(contentRef.targetId, 'article-draft')
      ))).toEqual([])
      expect(await fixture.db.select().from(contentRefList)
        .where(eq(contentRefList.itemId, 'article-draft'))).toEqual([])
      expect(await fixture.db.select().from(contentRef).where(or(
        eq(contentRef.fieldPath, 'scopedArticle'),
        eq(contentRef.fieldPath, 'scopedArticles')
      ))).toEqual([])
      expect(await fixture.db.select().from(contentRefList)
        .where(eq(contentRefList.fieldKey, 'scopedArticles'))).toEqual([])
      expect(await fixture.db.select().from(contentRef)
        .where(eq(contentRef.targetId, 'external-owner'))).toHaveLength(2)
      expect(await fixture.db.select().from(contentRefList)
        .where(eq(contentRefList.itemId, 'external-owner'))).toHaveLength(1)
      await expect(getSchemaDependencyImpact(fixture.db, 'article')).resolves.toMatchObject({
        status: 'inactive',
        canDelete: true,
        counts: { contentTotal: 0, inboundReferences: 0 }
      })
    } finally {
      fixture.close()
    }
  })

  it('rolls back earlier cleanup when the final schema delete fails under foreign keys', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await deactivateSchema(fixture.db, 'article', 'admin-1')
      const before = await getSchemaDependencyImpact(fixture.db, 'article')
      await fixture.db.run(sql.raw(`
        CREATE TRIGGER prevent_article_schema_delete
        BEFORE DELETE ON schema
        WHEN OLD.schema_key = 'article'
        BEGIN
          SELECT RAISE(ABORT, 'forced schema purge failure');
        END
      `))

      await expect(purgeSchema({ context: {} } as any, fixture.db, 'article', 'article'))
        .rejects.toThrow('Failed query')
      await expect(getSchemaDependencyImpact(fixture.db, 'article')).resolves.toMatchObject({
        status: 'inactive',
        counts: before.counts
      })
      expect(await fixture.db.select().from(content).where(eq(content.schemaKey, 'article'))).toHaveLength(2)
      expect(await fixture.db.select().from(contentRef).where(or(
        eq(contentRef.targetSchemaKey, 'article'),
        sql`${contentRef.contentId} in ('article-published', 'article-draft')`
      ))).toHaveLength(2)
    } finally {
      fixture.close()
    }
  })

  it('keeps cleanup atomic when emptiness or inactive lifecycle guards no longer hold', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedSchemaLifecycle(fixture.db)
      await deactivateSchema(fixture.db, 'article', 'admin-1')

      await deleteSchemaResidue({ context: {} } as any, fixture.db, 'article', { guard: 'empty' })
      await expect(getSchemaDependencyImpact(fixture.db, 'article')).resolves.toMatchObject({
        status: 'inactive',
        counts: { contentTotal: 2, inboundReferences: 2 }
      })

      await reactivateSchema(fixture.db, 'article', 'admin-2')
      await deleteSchemaResidue({ context: {} } as any, fixture.db, 'article', { guard: 'inactive' })
      await expect(getSchemaDependencyImpact(fixture.db, 'article')).resolves.toMatchObject({
        status: 'active',
        counts: { contentTotal: 2, inboundReferences: 2 }
      })
    } finally {
      fixture.close()
    }
  })

  it('collects the destructive cleanup as one D1 batch and propagates batch failure', async () => {
    const failure = new Error('D1 batch failed')
    const statements: unknown[] = []
    const db = {
      delete: vi.fn((table: unknown) => ({
        where: vi.fn((_condition: unknown) => {
          const statement = { table }
          statements.push(statement)
          return statement
        })
      })),
      batch: vi.fn(async () => { throw failure }),
      transaction: vi.fn()
    }
    const event = { context: { cloudflare: { env: { DB: {} } } } }

    await expect(deleteSchemaResidue(event as any, db as any, 'article')).rejects.toBe(failure)
    expect(db.transaction).not.toHaveBeenCalled()
    expect(db.batch).toHaveBeenCalledOnce()
    expect(db.batch).toHaveBeenCalledWith(statements)
    expect(statements).toHaveLength(19)
  })
})
