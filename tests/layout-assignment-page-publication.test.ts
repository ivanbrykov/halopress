import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  deletePage,
  discardPageWorking,
  publishPageWorking,
  recoverPage,
  restorePageRevision,
  savePageWorking,
  unpublishPage
} from '../server/cms/page-publication'
import {
  layoutReference,
  layoutResource,
  page,
  publicationRevision
} from '../server/db/schema'
import {
  createLayoutDocumentFromPreset,
  layoutNameKey
} from '../shared/site-layout'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const event = { context: {} } as any

async function seedLayout(db: any, layoutId: string, name: string) {
  const now = new Date('2026-07-18T01:00:00.000Z')
  const document = createLayoutDocumentFromPreset('blank', layoutId, name)
  await db.insert(layoutResource).values({
    id: layoutId,
    name,
    nameKey: layoutNameKey(name),
    documentJson: JSON.stringify(document),
    createdAt: now,
    updatedAt: now
  })
}

async function getPage(db: any) {
  return await db.select().from(page).where(eq(page.id, 'page-layout')).get()
}

async function assignmentRefs(db: any) {
  const rows = await db.select().from(layoutReference).where(and(
    eq(layoutReference.ownerType, 'page'),
    eq(layoutReference.ownerId, 'page-layout')
  )).orderBy(asc(layoutReference.slot))
  return rows.map((row: any) => ({ slot: row.slot, layoutId: row.layoutId }))
}

describe('Page Layout assignment publication transitions', () => {
  it('keeps working and published snapshots/references isolated across save, publish, discard, unpublish, delete, recover, and restore', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      await seedLayout(db, 'layout-a', 'Layout A')
      await seedLayout(db, 'layout-b', 'Layout B')
      const now = new Date('2026-07-18T01:01:00.000Z')
      await db.insert(page).values({
        id: 'page-layout',
        title: 'Layout Page',
        status: 'draft',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        layoutId: 'layout-a',
        createdAt: now,
        updatedAt: now
      })

      let row = await getPage(db)
      await savePageWorking({
        event,
        db,
        existing: row,
        title: 'Layout Page',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        layoutId: 'layout-a',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(await assignmentRefs(db)).toEqual([{ slot: 'working', layoutId: 'layout-a' }])

      await publishPageWorking({
        event,
        db,
        existing: row,
        title: 'Layout Page',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        layoutId: 'layout-a',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      const firstPublishedRevisionId = row.publishedRevisionId
      expect(await db.select().from(publicationRevision).where(eq(publicationRevision.id, firstPublishedRevisionId)).get())
        .toMatchObject({ layoutId: 'layout-a' })
      expect(await assignmentRefs(db)).toEqual([
        { slot: 'published', layoutId: 'layout-a' },
        { slot: 'working', layoutId: 'layout-a' }
      ])

      await savePageWorking({
        event,
        db,
        existing: row,
        title: 'Layout Page draft',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { version: 2 } }] },
        layoutId: 'layout-b',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(row.layoutId).toBe('layout-b')
      expect(await db.select().from(publicationRevision).where(eq(publicationRevision.id, firstPublishedRevisionId)).get())
        .toMatchObject({ layoutId: 'layout-a' })
      expect(await assignmentRefs(db)).toEqual([
        { slot: 'published', layoutId: 'layout-a' },
        { slot: 'working', layoutId: 'layout-b' }
      ])

      await discardPageWorking({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(row.layoutId).toBe('layout-a')
      expect(await assignmentRefs(db)).toEqual([
        { slot: 'published', layoutId: 'layout-a' },
        { slot: 'working', layoutId: 'layout-a' }
      ])

      await savePageWorking({
        event,
        db,
        existing: row,
        title: 'Layout Page draft',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { version: 3 } }] },
        layoutId: 'layout-b',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      await unpublishPage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(row).toMatchObject({ status: 'archived', layoutId: 'layout-b', publishedRevisionId: null })
      expect(await assignmentRefs(db)).toEqual([{ slot: 'working', layoutId: 'layout-b' }])

      // Historical Page publication rows deliberately have no direct Layout FK;
      // once the current published reference is gone they must not block deletion.
      await db.delete(layoutResource).where(eq(layoutResource.id, 'layout-a'))
      expect(await db.select().from(publicationRevision).where(eq(publicationRevision.id, firstPublishedRevisionId)).get())
        .toMatchObject({ layoutId: 'layout-a' })

      await publishPageWorking({
        event,
        db,
        existing: row,
        title: 'Layout Page republished',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { version: 3 } }] },
        layoutId: 'layout-b',
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(await assignmentRefs(db)).toEqual([
        { slot: 'published', layoutId: 'layout-b' },
        { slot: 'working', layoutId: 'layout-b' }
      ])

      await deletePage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(row).toMatchObject({ status: 'deleted', layoutId: 'layout-b', publishedRevisionId: null })
      expect(await assignmentRefs(db)).toEqual([{ slot: 'working', layoutId: 'layout-b' }])

      await recoverPage({
        event,
        db,
        existing: row,
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      await restorePageRevision({
        event,
        db,
        existing: row,
        title: 'Restored content only',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { restored: true } }] },
        actorId: 'admin-1',
        expectedRevision: row.currentRevision
      })
      row = await getPage(db)
      expect(row).toMatchObject({ status: 'draft', layoutId: 'layout-b', publishedRevisionId: null })
      expect(await assignmentRefs(db)).toEqual([{ slot: 'working', layoutId: 'layout-b' }])
    } finally {
      fixture.close()
    }
  })
})
