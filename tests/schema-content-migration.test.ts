import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { syncContentProjections } from '../server/cms/content-projections'
import { getKindChanges, migrateSchemaContent } from '../server/cms/migrate'
import { publicationMetadata, publicationRevisionValues } from '../server/cms/publication'
import type { SchemaAst, SchemaRegistry } from '../server/cms/types'
import {
  content,
  contentListing,
  contentSearchData,
  documentRevision,
  publicationRevision,
  schema
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const v1Ast: SchemaAst = {
  schemaKey: 'article',
  title: 'Article',
  fields: [
    { id: 'article-title', key: 'title', kind: 'string', title: 'Title' },
    { id: 'article-score', key: 'score', kind: 'string', title: 'Score' }
  ]
}

const v2Ast: SchemaAst = {
  ...v1Ast,
  fields: v1Ast.fields.map(field => field.id === 'article-score'
    ? { ...field, kind: 'integer' as const }
    : field)
}

function registry(version: number, scoreKind: 'string' | 'integer'): SchemaRegistry {
  return {
    schemaKey: 'article',
    version,
    title: 'Article',
    listing: { titleFieldKey: 'title' },
    fields: [
      { fieldId: 'article-title', key: 'title', kind: 'string', title: 'Title' },
      {
        fieldId: 'article-score',
        key: 'score',
        kind: scoreKind,
        title: 'Score',
        search: { mode: 'exact', filterable: true }
      }
    ],
    relations: []
  }
}

async function seedSchemaVersion(db: any, version: number, registryValue: SchemaRegistry, now: Date) {
  await db.insert(schema).values({
    schemaKey: 'article',
    version,
    title: 'Article',
    astJson: JSON.stringify(version === 1 ? v1Ast : v2Ast),
    jsonSchema: JSON.stringify({ type: 'object' }),
    registryJson: JSON.stringify(registryValue),
    createdAt: now
  })
}

describe('schema content migration publication state', () => {
  it('surfaces migrated published working copies as drafts without changing public delivery data', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      const now = new Date('2026-07-13T00:00:00.000Z')
      const v1Registry = registry(1, 'string')
      const v2Registry = registry(2, 'integer')
      await seedSchemaVersion(db, 1, v1Registry, now)
      await seedSchemaVersion(db, 2, v2Registry, now)

      const publicContent = { title: 'Published title', score: '42' }
      await db.insert(content).values([
        {
          id: 'published-content',
          schemaKey: 'article',
          schemaVersion: 1,
          status: 'published',
          contentJson: JSON.stringify(publicContent),
          publishedRevisionId: 'published-revision',
          firstPublishedAt: now,
          publishedAt: now,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'published-with-draft',
          schemaKey: 'article',
          schemaVersion: 1,
          status: 'draft',
          contentJson: JSON.stringify({ title: 'Existing draft', score: '7' }),
          publishedRevisionId: 'existing-revision',
          firstPublishedAt: now,
          publishedAt: now,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'never-published',
          schemaKey: 'article',
          schemaVersion: 1,
          status: 'draft',
          contentJson: JSON.stringify({ title: 'Draft only', score: '3' }),
          createdAt: now,
          updatedAt: now
        }
      ])
      await db.insert(publicationRevision).values(publicationRevisionValues({
        id: 'published-revision',
        documentKind: 'content',
        documentId: 'published-content',
        schemaKey: 'article',
        schemaVersion: 1,
        content: publicContent,
        createdAt: now
      }))
      for (const projectionScope of ['working', 'published'] as const) {
        await syncContentProjections({
          db,
          registry: v1Registry,
          content: publicContent,
          contentId: 'published-content',
          schemaKey: 'article',
          schemaVersion: 1,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          projectionScope
        })
      }

      const revisionBefore = await db.select().from(publicationRevision)
        .where(eq(publicationRevision.id, 'published-revision')).get()
      const publishedListingBefore = await db.select().from(contentListing).where(and(
        eq(contentListing.contentId, 'published-content'),
        eq(contentListing.projectionScope, 'published')
      )).get()
      const publishedSearchBefore = await db.select().from(contentSearchData).where(and(
        eq(contentSearchData.contentId, 'published-content'),
        eq(contentSearchData.projectionScope, 'published')
      ))

      expect(await migrateSchemaContent({
        event: { context: {} } as any,
        db,
        schemaKey: 'article',
        nextVersion: 2,
        registry: v2Registry,
        changes: getKindChanges(v1Ast, v2Ast),
        actorId: 'admin-1'
      })).toEqual({ updated: 3 })

      const migrated = await db.select().from(content)
        .where(eq(content.id, 'published-content')).get()
      expect(migrated).toMatchObject({
        schemaVersion: 2,
        status: 'draft',
        currentRevision: 2,
        updatedBy: 'admin-1',
        publishedRevisionId: 'published-revision'
      })
      expect(JSON.parse(migrated!.contentJson)).toEqual({ title: 'Published title', score: 42 })
      expect(publicationMetadata(migrated!)).toMatchObject({
        publicationState: 'published-with-draft',
        hasDraftChanges: true
      })
      expect(await db.select().from(contentListing).where(and(
        eq(contentListing.contentId, 'published-content'),
        eq(contentListing.projectionScope, 'working')
      )).get()).toMatchObject({ schemaVersion: 2, status: 'draft' })

      expect(await db.select().from(publicationRevision)
        .where(eq(publicationRevision.id, 'published-revision')).get()).toEqual(revisionBefore)
      expect(await db.select().from(contentListing).where(and(
        eq(contentListing.contentId, 'published-content'),
        eq(contentListing.projectionScope, 'published')
      )).get()).toEqual(publishedListingBefore)
      expect(await db.select().from(contentSearchData).where(and(
        eq(contentSearchData.contentId, 'published-content'),
        eq(contentSearchData.projectionScope, 'published')
      ))).toEqual(publishedSearchBefore)

      expect(await db.select({ id: content.id, status: content.status }).from(content)
        .where(eq(content.id, 'published-with-draft')).get()).toEqual({
        id: 'published-with-draft',
        status: 'draft'
      })
      expect(await db.select({
        documentId: documentRevision.documentId,
        revision: documentRevision.revision,
        action: documentRevision.action,
        schemaVersion: documentRevision.schemaVersion,
        createdBy: documentRevision.createdBy
      }).from(documentRevision).orderBy(documentRevision.documentId)).toEqual([
        {
          documentId: 'never-published',
          revision: 2,
          action: 'migrate',
          schemaVersion: 2,
          createdBy: 'admin-1'
        },
        {
          documentId: 'published-content',
          revision: 2,
          action: 'migrate',
          schemaVersion: 2,
          createdBy: 'admin-1'
        },
        {
          documentId: 'published-with-draft',
          revision: 2,
          action: 'migrate',
          schemaVersion: 2,
          createdBy: 'admin-1'
        }
      ])
      expect(await db.select({ id: content.id, status: content.status }).from(content)
        .where(eq(content.id, 'never-published')).get()).toEqual({
        id: 'never-published',
        status: 'draft'
      })
    } finally {
      fixture.close()
    }
  })

  it('converts singular assets to ordered asset lists and back through schema versions', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      const assetAst: SchemaAst = {
        schemaKey: 'gallery', title: 'Gallery', fields: [{ id: 'media-id', key: 'media', kind: 'asset' }]
      }
      const listAst: SchemaAst = {
        schemaKey: 'gallery', title: 'Gallery', fields: [{ id: 'media-id', key: 'media', kind: 'asset_list' }]
      }
      const assetRegistry: SchemaRegistry = {
        schemaKey: 'gallery', version: 1, title: 'Gallery',
        fields: [{ fieldId: 'media-id', key: 'media', kind: 'asset' }],
        relations: [{ fieldId: 'media-id', fieldKey: 'media', targetKind: 'asset', kind: 'asset_ref' }]
      }
      const listRegistry: SchemaRegistry = {
        schemaKey: 'gallery', version: 2, title: 'Gallery',
        fields: [{ fieldId: 'media-id', key: 'media', kind: 'asset_list' }],
        relations: [{ fieldId: 'media-id', fieldKey: 'media', targetKind: 'asset', kind: 'asset_ref' }]
      }
      for (const [version, ast, registryValue] of [[1, assetAst, assetRegistry], [2, listAst, listRegistry]] as const) {
        await fixture.db.insert(schema).values({
          schemaKey: 'gallery', version, title: 'Gallery', astJson: JSON.stringify(ast), jsonSchema: '{}',
          registryJson: JSON.stringify(registryValue), createdAt: now
        })
      }
      await fixture.db.insert(content).values({
        id: 'gallery-1', schemaKey: 'gallery', schemaVersion: 1, status: 'draft',
        contentJson: JSON.stringify({ media: 'asset-1' }), createdAt: now, updatedAt: now
      })

      await expect(migrateSchemaContent({
        event: { context: {} } as any,
        db: fixture.db as any, schemaKey: 'gallery', nextVersion: 2, registry: listRegistry,
        changes: getKindChanges(assetAst, listAst)
      })).resolves.toEqual({ updated: 1 })
      expect(JSON.parse((await fixture.db.select().from(content).where(eq(content.id, 'gallery-1')).get())!.contentJson))
        .toEqual({ media: [{ assetId: 'asset-1' }] })

      const assetRegistryV3 = { ...assetRegistry, version: 3 }
      await fixture.db.insert(schema).values({
        schemaKey: 'gallery', version: 3, title: 'Gallery', astJson: JSON.stringify(assetAst), jsonSchema: '{}',
        registryJson: JSON.stringify(assetRegistryV3), createdAt: now
      })
      await migrateSchemaContent({
        event: { context: {} } as any,
        db: fixture.db as any, schemaKey: 'gallery', nextVersion: 3, registry: assetRegistryV3,
        changes: getKindChanges(listAst, assetAst)
      })
      expect(JSON.parse((await fixture.db.select().from(content).where(eq(content.id, 'gallery-1')).get())!.contentJson))
        .toEqual({ media: 'asset-1' })
    } finally {
      fixture.close()
    }
  })
})
