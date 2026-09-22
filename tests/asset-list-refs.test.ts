import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { syncContentProjections } from '../server/cms/content-projections'
import type { SchemaRegistry } from '../server/cms/types'
import { content, contentRef, contentRefList, documentAssetRef, schema } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const registry: SchemaRegistry = {
  schemaKey: 'gallery',
  version: 1,
  title: 'Gallery',
  fields: [{ fieldId: 'gallery-id', key: 'gallery', kind: 'asset_list', title: 'Gallery' }],
  relations: [{ fieldId: 'gallery-id', fieldKey: 'gallery', targetKind: 'asset', kind: 'asset_ref' }]
}

describe('ordered asset list references', () => {
  it('keeps every position and metadata while deduplicating set-style refs', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-14T00:00:00.000Z')
      await fixture.db.insert(schema).values({
        schemaKey: 'gallery', version: 1, title: 'Gallery', astJson: '{}', jsonSchema: '{}', registryJson: JSON.stringify(registry), createdAt: now
      })
      await fixture.db.insert(content).values({
        id: 'content-1', schemaKey: 'gallery', schemaVersion: 1, status: 'draft', contentJson: '{}', createdAt: now, updatedAt: now
      })
      await syncContentProjections({
        db: fixture.db as any,
        registry,
        content: { gallery: [
          { assetId: 'asset-a', alt: 'Front', caption: 'First' },
          { assetId: 'asset-b', alt: '' },
          { assetId: 'asset-a', alt: 'Detail' }
        ] },
        contentId: 'content-1',
        schemaKey: 'gallery',
        schemaVersion: 1,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        projectionScope: 'working'
      })

      expect(await fixture.db.select().from(contentRef).where(and(
        eq(contentRef.contentId, 'content-1'), eq(contentRef.projectionScope, 'working')
      ))).toHaveLength(2)
      expect((await fixture.db.select().from(contentRefList).where(and(
        eq(contentRefList.ownerContentId, 'content-1'), eq(contentRefList.projectionScope, 'working')
      ))).map(row => ({ position: row.position, assetId: row.assetId, meta: row.metaJson && JSON.parse(row.metaJson) }))).toEqual([
        { position: 0, assetId: 'asset-a', meta: { alt: 'Front', caption: 'First' } },
        { position: 1, assetId: 'asset-b', meta: null },
        { position: 2, assetId: 'asset-a', meta: { alt: 'Detail' } }
      ])
      expect((await fixture.db.select().from(documentAssetRef).where(eq(documentAssetRef.documentId, 'content-1')))
        .map(row => row.assetId).sort()).toEqual(['asset-a', 'asset-b'])
    } finally { fixture.close() }
  })
})
