import { and, eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  insertLayoutElement,
  type LayoutDocument,
  type LayoutElement
} from '../shared/site-layout'
import { defaultSitePresentation } from '../shared/site-presentation'
import {
  documentRevision,
  layoutReference,
  layoutResource,
  settings,
  siteMenuReference,
  siteMenuSet
} from '../server/db/schema'
import { DOCUMENT_REVISION_RETENTION_LIMIT } from '../server/cms/document-revisions'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => {
  vi.restoreAllMocks()
})

function withGap(document: LayoutDocument, gap: LayoutDocument['grid']['gap']) {
  return { ...structuredClone(document), grid: { ...structuredClone(document.grid), gap } }
}

describe('Layout persistence', () => {
  it('supports audited CRUD, dedicated rename history, independent duplication, usage, and delete attribution', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { ensureGlobalSiteMenu } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      const {
        LayoutInUseError,
        LayoutValidationError,
        createLayout,
        deleteLayout,
        duplicateLayout,
        getLayout,
        getLayoutUsage,
        listLayouts,
        renameLayout,
        resolveLayoutProjection,
        updateLayout
      } = await import('../server/utils/site-layouts')

      const empty = await listLayouts({} as any)
      expect(empty.items).toEqual([])
      expect(empty.presets.map(preset => preset.key)).toContain('blank')
      expect(JSON.stringify(empty.elementDescriptors)).not.toContain('runtimeComponentKey')

      const created = await createLayout({} as any, { name: 'Marketing shell', presetKey: 'header-footer' }, 'creator-1')
      expect(created).toMatchObject({
        name: 'Marketing shell',
        revision: 1,
        status: 'ready',
        createdBy: 'creator-1',
        updatedBy: 'creator-1',
        canDelete: true
      })
      expect(created.document!.elements.filter(element => element.type === 'page-content')).toHaveLength(1)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toMatchObject([{ revision: 1, action: 'create', createdBy: 'creator-1' }])
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toEqual([expect.objectContaining({
        slot: created.document!.elements.find(element => element.type === 'menu')!.id,
        menuSetId: 'global-navigation'
      })])

      const saved = await updateLayout({} as any, created.id, {
        revision: 1,
        document: withGap(created.document!, 'spacious')
      }, 'editor-2')
      expect(saved).toMatchObject({ revision: 2, updatedBy: 'editor-2', document: { grid: { gap: 'spacious' } } })
      await expect(updateLayout({} as any, created.id, {
        revision: 2,
        document: { ...structuredClone(saved.document!), name: 'Rename through PUT' }
      }, 'editor-2')).rejects.toMatchObject({
        name: LayoutValidationError.name,
        issues: [expect.objectContaining({ path: 'document.name', message: expect.stringContaining('rename endpoint') })]
      })

      const rowBeforeUnsafeRename = await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get()
      const refsBeforeUnsafeRename = await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id))
      const historyBeforeUnsafeRename = await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))
      await expect(renameLayout({} as any, created.id, { revision: 2, name: 'app/layouts/desk.vue' }, 'attacker'))
        .rejects.toMatchObject({ name: LayoutValidationError.name, issues: [expect.objectContaining({ path: 'document.name', kind: 'forbidden' })] })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get()).toEqual(rowBeforeUnsafeRename)
      expect(await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id))).toEqual(refsBeforeUnsafeRename)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toEqual(historyBeforeUnsafeRename)

      const renamed = await renameLayout({} as any, created.id, { revision: 2, name: 'Marketing Layout' }, 'renamer-3')
      expect(renamed).toMatchObject({ revision: 3, name: 'Marketing Layout', updatedBy: 'renamer-3' })
      expect(await fixture.db.select({ action: documentRevision.action, title: documentRevision.title, createdBy: documentRevision.createdBy })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, created.id),
          eq(documentRevision.revision, 3)
        )).get()).toEqual({ action: 'rename', title: 'Marketing Layout', createdBy: 'renamer-3' })

      const rowAfterRename = await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get()
      const refsAfterRename = await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id))
      const historyAfterRename = await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))
      await expect(updateLayout({} as any, created.id, {
        revision: 1,
        document: created.document
      }, 'stale-before-rename')).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 3, updatedBy: 'renamer-3' })
      })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get()).toEqual(rowAfterRename)
      expect(await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id))).toEqual(refsAfterRename)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toEqual(historyAfterRename)

      const duplicated = await duplicateLayout({} as any, created.id, { name: 'Marketing copy' }, 'duplicator-4')
      expect(duplicated).toMatchObject({ revision: 1, name: 'Marketing copy', createdBy: 'duplicator-4' })
      expect(duplicated.id).not.toBe(created.id)
      expect(duplicated.document!.layoutId).toBe(duplicated.id)
      expect(duplicated.document!.elements.map(element => element.id))
        .not.toEqual(renamed.document!.elements.map(element => element.id))
      const duplicateChanged = withGap(duplicated.document!, 'none')
      await updateLayout({} as any, duplicated.id, { revision: 1, document: duplicateChanged }, 'editor-copy')
      expect((await getLayout({} as any, created.id)).document!.grid.gap).toBe('spacious')

      const referenceTime = new Date('2026-07-18T00:00:00.000Z')
      await fixture.db.insert(layoutReference).values({
        ownerType: 'page',
        ownerId: 'home-page',
        slot: 'working',
        layoutId: created.id,
        label: 'Home Page working Layout',
        behavior: 'use-current',
        createdAt: referenceTime,
        updatedAt: referenceTime
      })
      expect(await getLayoutUsage({} as any, created.id)).toEqual({
        id: created.id,
        revision: 3,
        usage: [{
          resourceType: 'page',
          resourceId: 'home-page',
          label: 'Home Page working Layout',
          behavior: 'use-current'
        }],
        canDelete: false
      })
      await expect(deleteLayout({} as any, created.id, { revision: 3 }, 'deleter-5'))
        .rejects.toMatchObject({ name: LayoutInUseError.name, usage: [expect.objectContaining({ resourceType: 'page' })] })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id))).toHaveLength(1)
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toHaveLength(1)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toHaveLength(3)

      await fixture.db.delete(layoutReference).where(eq(layoutReference.layoutId, created.id))
      await expect(deleteLayout({} as any, created.id, { revision: 3 }, 'deleter-5'))
        .resolves.toEqual({ deleted: true, id: created.id, revision: 4 })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id))).toEqual([])
      expect(await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id))).toEqual([])
      expect(await fixture.db.select({ action: documentRevision.action, createdBy: documentRevision.createdBy })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, created.id),
          eq(documentRevision.revision, 4)
        )).get()).toEqual({ action: 'delete', createdBy: 'deleter-5' })
      await expect(resolveLayoutProjection({} as any, created.id)).resolves.toEqual({
        status: 'missing',
        layoutId: created.id,
        reason: 'Layout resource is missing'
      })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects stale writers without changing the active document, references, or immutable history', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { ensureGlobalSiteMenu } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Concurrency', presetKey: 'header-footer' }, 'writer-1')
      const first = await updateLayout({} as any, created.id, {
        revision: 1,
        document: withGap(created.document!, 'spacious')
      }, 'writer-1')
      const referencesAfterWinner = await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.ownerId, created.id))
      const historyAfterWinner = await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))

      await expect(updateLayout({} as any, created.id, {
        revision: 1,
        document: withGap(created.document!, 'none')
      }, 'stale-writer')).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 2, updatedBy: 'writer-1' })
      })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({ currentRevision: 2, documentJson: JSON.stringify(first.document) })
      expect(await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerId, created.id)))
        .toEqual(referencesAfterWinner)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toEqual(historyAfterWinner)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rolls back queued Menu-reference cleanup when a D1 assignment FK blocks deletion', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { LayoutInUseError, createLayout, deleteLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'D1 guarded delete', presetKey: 'header-footer' }, 'creator')
      const now = new Date()
      await fixture.db.insert(layoutReference).values({
        ownerType: 'page',
        ownerId: 'assigned-page',
        slot: 'working',
        layoutId: created.id,
        label: 'Assigned Page',
        behavior: 'use-current',
        createdAt: now,
        updatedAt: now
      })

      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout delete must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(deleteLayout(event, created.id, { revision: 1 }, 'deleter'))
        .rejects.toBeInstanceOf(LayoutInUseError)
      expect(batch).toHaveBeenCalledOnce()
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id))).toHaveLength(1)
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toHaveLength(1)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rolls back D1 delete cleanup when a concurrent revision wins after prevalidation', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, deleteLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'D1 stale delete', presetKey: 'header-footer' }, 'creator')
      const winnerAt = new Date('2026-07-18T12:00:00.000Z')
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.update(layoutResource).set({
          currentRevision: 2,
          updatedBy: 'winner',
          updatedAt: winnerAt
        }).where(eq(layoutResource.id, created.id))
        await fixture.db.insert(documentRevision).values({
          id: 'd1-delete-winner-revision',
          documentKind: 'layout',
          documentId: created.id,
          revision: 2,
          action: 'save',
          status: 'active',
          title: created.name,
          snapshotJson: JSON.stringify(created.document),
          createdBy: 'winner',
          createdAt: winnerAt
        })
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout delete must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(deleteLayout(event, created.id, { revision: 1 }, 'stale-deleter'))
        .rejects.toMatchObject({ statusCode: 409, data: expect.objectContaining({ currentRevision: 2, updatedBy: 'winner' }) })
      expect(batch).toHaveBeenCalledOnce()
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({ currentRevision: 2, updatedBy: 'winner' })
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toHaveLength(1)
      expect(await fixture.db.select({ revision: documentRevision.revision, action: documentRevision.action })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, created.id)
        )).orderBy(documentRevision.revision)).toEqual([
        { revision: 1, action: 'create' },
        { revision: 2, action: 'save' }
      ])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rolls back a D1 save when the resource revision advances without history', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'D1 save resource guard', presetKey: 'header-footer' }, 'creator')
      const resourceBefore = await fixture.db.select().from(layoutResource)
        .where(eq(layoutResource.id, created.id)).get()
      const referencesBefore = await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.ownerId, created.id))
      const historyBefore = await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))
      const winnerAt = new Date('2026-07-18T12:00:00.000Z')
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.update(layoutResource).set({
          currentRevision: 2,
          updatedBy: 'out-of-band-winner',
          updatedAt: winnerAt
        }).where(eq(layoutResource.id, created.id))
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout save must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(updateLayout(event, created.id, {
        revision: 1,
        document: withGap(created.document!, 'none')
      }, 'stale-writer')).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 2, updatedBy: 'out-of-band-winner' })
      })
      expect(batch).toHaveBeenCalledOnce()
      const resourceAfter = await fixture.db.select().from(layoutResource)
        .where(eq(layoutResource.id, created.id)).get()
      expect(resourceAfter).toMatchObject({
        currentRevision: 2,
        updatedBy: 'out-of-band-winner',
        documentJson: resourceBefore?.documentJson,
        name: resourceBefore?.name
      })
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.ownerId, created.id))).toEqual(referencesBefore)
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toEqual(historyBefore)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('returns a conflict when a later writer commits before the save post-read', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'D1 post-read guard', presetKey: 'header-footer' }, 'creator')
      const submitted = withGap(created.document!, 'none')
      const laterDocument = withGap(created.document!, 'compact')
      const laterAt = new Date('2026-07-18T12:01:00.000Z')
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
        // Model another complete writer between this batch and its post-read.
        await fixture.db.update(layoutResource).set({
          documentJson: JSON.stringify(laterDocument),
          currentRevision: 3,
          updatedBy: 'later-writer',
          updatedAt: laterAt
        }).where(eq(layoutResource.id, created.id))
        await fixture.db.insert(documentRevision).values({
          id: 'd1-post-read-winner-revision',
          documentKind: 'layout',
          documentId: created.id,
          revision: 3,
          action: 'save',
          status: 'active',
          title: created.name,
          snapshotJson: JSON.stringify(laterDocument),
          createdBy: 'later-writer',
          createdAt: laterAt
        })
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout save must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(updateLayout(event, created.id, {
        revision: 1,
        document: submitted
      }, 'first-writer')).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 3, updatedBy: 'later-writer' })
      })
      expect(batch).toHaveBeenCalledOnce()
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({
          currentRevision: 3,
          updatedBy: 'later-writer',
          documentJson: JSON.stringify(laterDocument)
        })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('keeps D1 Menu references when the guarded resource delete matches no row', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, deleteLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'D1 resource guard', presetKey: 'header-footer' }, 'creator')
      const winnerAt = new Date('2026-07-18T12:00:00.000Z')
      const batch = vi.fn(async (statements: any[]) => {
        // Model a resource revision that advanced after prevalidation without
        // corresponding history. The resource guard must still protect refs.
        await fixture.db.update(layoutResource).set({
          currentRevision: 2,
          updatedBy: 'out-of-band-winner',
          updatedAt: winnerAt
        }).where(eq(layoutResource.id, created.id))
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout delete must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(deleteLayout(event, created.id, { revision: 1 }, 'stale-deleter'))
        .rejects.toMatchObject({
          statusCode: 409,
          data: expect.objectContaining({ currentRevision: 2, updatedBy: 'out-of-band-winner' })
        })
      expect(batch).toHaveBeenCalledOnce()
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({ currentRevision: 2, updatedBy: 'out-of-band-winner' })
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toHaveLength(1)
      expect(await fixture.db.select({ revision: documentRevision.revision, action: documentRevision.action })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, created.id)
        ))).toEqual([{ revision: 1, action: 'create' }])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('persists identical canonical bytes and revision snapshots for shuffled sparse-order input', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Canonical persistence', presetKey: 'grid' }, 'creator')
      const shuffled = structuredClone(created.document!)
      shuffled.grid.regions.reverse()
      for (const region of ['header', 'left-sidebar', 'content', 'right-sidebar', 'footer'] as const) {
        shuffled.elements.filter(element => element.region === region)
          .sort((left, right) => left.order - right.order)
          .forEach((element, index) => { element.order = (index + 1) * 10 })
      }
      shuffled.elements.reverse()

      const saved = await updateLayout({} as any, created.id, { revision: 1, document: shuffled }, 'editor')
      expect(saved.document).toEqual(created.document)
      const row = await fixture.db.select({ documentJson: layoutResource.documentJson })
        .from(layoutResource).where(eq(layoutResource.id, created.id)).get()
      const history = await fixture.db.select({ snapshotJson: documentRevision.snapshotJson })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, created.id)
        )).orderBy(documentRevision.revision)
      expect(row?.documentJson).toBe(JSON.stringify(created.document))
      expect(history.map(revision => revision.snapshotJson)).toEqual([
        JSON.stringify(created.document),
        JSON.stringify(created.document)
      ])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('preserves every Layout save beyond the ordinary document retention limit', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      let current = await createLayout({} as any, { name: 'Full history', presetKey: 'blank' }, 'creator')
      const gaps: LayoutDocument['grid']['gap'][] = ['none', 'compact', 'comfortable', 'spacious']
      const saveCount = DOCUMENT_REVISION_RETENTION_LIMIT + 2
      for (let index = 0; index < saveCount; index += 1) {
        current = await updateLayout({} as any, current.id, {
          revision: current.revision,
          document: withGap(current.document!, gaps[index % gaps.length]!)
        }, `writer-${index}`)
      }

      const history = await fixture.db.select({ revision: documentRevision.revision, action: documentRevision.action })
        .from(documentRevision).where(and(
          eq(documentRevision.documentKind, 'layout'),
          eq(documentRevision.documentId, current.id)
        )).orderBy(documentRevision.revision)
      expect(history).toHaveLength(saveCount + 1)
      expect(history[0]).toEqual({ revision: 1, action: 'create' })
      expect(history.at(-1)).toEqual({ revision: saveCount + 1, action: 'save' })
      expect(history.map(item => item.revision)).toEqual(Array.from({ length: saveCount + 1 }, (_, index) => index + 1))
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('fails closed with repair state for malformed storage and never projects unsafe identifiers', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, getLayout, listLayouts, resolveLayoutProjection } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Repair target', presetKey: 'blank' }, 'admin')
      await fixture.db.update(layoutResource).set({
        name: 'app/layouts/desk.vue',
        nameKey: 'app/layouts/desk.vue',
        documentJson: JSON.stringify({ ...created.document, runtimeComponentKey: 'UHeader', name: 'app/layouts/desk.vue' })
      }).where(eq(layoutResource.id, created.id))

      const admin = await getLayout({} as any, created.id)
      expect(admin).toMatchObject({
        name: 'Layout requiring repair',
        status: 'repair-required',
        document: null,
        repair: { revision: 1, issues: expect.any(Array) }
      })
      const resolved = await resolveLayoutProjection({} as any, created.id)
      expect(resolved).toEqual({
        status: 'repair-required',
        layoutId: created.id,
        reason: 'Stored Layout document failed strict validation'
      })
      const listed = await listLayouts({} as any)
      const serialized = JSON.stringify({ admin, listed, resolved })
      expect(serialized).not.toContain('app/layouts/desk.vue')
      expect(serialized).not.toContain('UHeader')
      expect(serialized).not.toContain('runtimeComponentKey')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('sanitizes forbidden stored property names from admin repair projections', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, getLayout, listLayouts } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Forbidden property repair', presetKey: 'blank' }, 'admin')
      await fixture.db.update(layoutResource).set({
        documentJson: JSON.stringify({ ...created.document, 'app/layouts/desk.vue': true })
      }).where(eq(layoutResource.id, created.id))

      const admin = await getLayout({} as any, created.id)
      expect(admin).toMatchObject({
        name: 'Forbidden property repair',
        status: 'repair-required',
        document: null,
        repair: {
          revision: 1,
          issues: [{
            path: '',
            message: 'Stored Layout contains forbidden framework or runtime data',
            kind: 'forbidden'
          }]
        }
      })
      const listed = await listLayouts({} as any)
      expect(JSON.stringify({ admin, listed })).not.toContain('app/layouts/desk.vue')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('maps creation before migration to storage unavailable instead of leaking raw SQLite errors', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      const { LayoutStorageUnavailableError, createLayout } = await import('../server/utils/site-layouts')
      await expect(createLayout({} as any, { name: 'Before migration', presetKey: 'blank' }, 'admin'))
        .rejects.toBeInstanceOf(LayoutStorageUnavailableError)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('reports forward or corrupted assignment metadata as unknown while retaining the deletion guard', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { LayoutInUseError, createLayout, deleteLayout, getLayoutUsage } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Future assignment', presetKey: 'blank' }, 'admin')
      const now = new Date()
      await fixture.db.insert(layoutReference).values({
        ownerType: 'future-owner',
        ownerId: 'future-resource',
        slot: 'future-slot',
        layoutId: created.id,
        label: 'Forward-version assignment',
        behavior: 'future-policy',
        createdAt: now,
        updatedAt: now
      })
      expect(await getLayoutUsage({} as any, created.id)).toMatchObject({
        usage: [{ resourceType: 'unknown', behavior: 'unknown', label: 'Forward-version assignment' }],
        canDelete: false
      })
      await expect(deleteLayout({} as any, created.id, { revision: 1 }, 'admin'))
        .rejects.toBeInstanceOf(LayoutInUseError)
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects forbidden POST names before creating any resource, revision, or reference', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { LayoutValidationError, createLayout } = await import('../server/utils/site-layouts')
      for (const name of ['UHeader', 'DeskLayout', 'SiteWorkspaceShell', 'app/layouts/desk.vue']) {
        await expect(createLayout({} as any, { name, presetKey: 'blank' }, 'attacker'))
          .rejects.toBeInstanceOf(LayoutValidationError)
      }
      expect(await fixture.db.select().from(layoutResource)).toEqual([])
      expect(await fixture.db.select().from(documentRevision).where(eq(documentRevision.documentKind, 'layout'))).toEqual([])
      expect(await fixture.db.select().from(siteMenuReference).where(eq(siteMenuReference.ownerType, 'site-layout'))).toEqual([])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('bootstraps the Global menu when an upgraded installation creates a non-Blank preset first', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      expect(await fixture.db.select().from(siteMenuSet)).toEqual([])
      const legacy = defaultSitePresentation()
      legacy.navigation.items = [{
        id: 'legacy-home',
        label: 'Legacy home',
        destination: { type: 'home' },
        children: []
      }]
      const legacyTime = new Date('2026-07-17T00:00:00.000Z')
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.presentation',
        value: JSON.stringify(legacy),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.presentation',
        updatedBy: 'legacy-admin',
        updatedAt: legacyTime,
        note: 'Legacy presentation'
      })

      const { createLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Upgrade header', presetKey: 'header-footer' }, 'layout-admin')
      expect(created.status).toBe('ready')
      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, 'global-navigation')).get())
        .toMatchObject({ bootstrapOwned: true, updatedBy: 'legacy-admin' })
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toEqual([expect.objectContaining({ menuSetId: 'global-navigation' })])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('bootstraps the Global menu when a Blank Layout first adds the registry-default Menu on save', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Blank upgrade', presetKey: 'blank' }, 'admin')
      expect(await fixture.db.select().from(siteMenuSet)).toEqual([])

      const document = structuredClone(created.document!)
      document.grid.regions.push({
        id: 'header',
        flow: 'space-between',
        placement: {
          mobile: { row: 2, column: 1, span: 4, visibility: 'visible' },
          tablet: { row: 2, column: 1, span: 8, visibility: 'visible' },
          desktop: { row: 2, column: 1, span: 12, visibility: 'visible' }
        }
      })
      const withMenu = insertLayoutElement(document, {
        id: 'global-menu-element',
        type: 'menu',
        region: 'header',
        order: 0,
        props: { menuSetId: 'global-navigation', orientation: 'horizontal' }
      })
      const saved = await updateLayout({} as any, created.id, { revision: 1, document: withMenu }, 'admin')
      expect(saved.revision).toBe(2)
      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, 'global-navigation'))).toHaveLength(1)
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toEqual([expect.objectContaining({ slot: 'global-menu-element', menuSetId: 'global-navigation' })])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('makes a committed Layout reference win against Menu deletion with actionable usage', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { ensureGlobalSiteMenu, createSiteMenu, deleteSiteMenu } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      const secondary = await createSiteMenu({} as any, { name: 'Secondary navigation' }, 'admin')
      const { createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Menu winner', presetKey: 'header-footer' }, 'admin')
      const document = structuredClone(created.document!)
      const menu = document.elements.find(element => element.type === 'menu')!
      menu.props.menuSetId = secondary.id
      await updateLayout({} as any, created.id, { revision: 1, document }, 'layout-writer')

      await expect(deleteSiteMenu({} as any, secondary.id)).rejects.toMatchObject({
        name: 'SiteMenuInUseError',
        usage: [{ resourceType: 'site-layout', resourceId: created.id, label: expect.stringContaining('Menu winner') }]
      })
      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, secondary.id))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rolls back a D1 Layout batch when Menu deletion wins after prevalidation', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      dbState.current = fixture.db
      const { ensureGlobalSiteMenu, createSiteMenu } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      const secondary = await createSiteMenu({} as any, { name: 'Racing menu' }, 'admin')
      const { LayoutValidationError, createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Menu loser', presetKey: 'header-footer' }, 'admin')
      const document = structuredClone(created.document!)
      document.elements.find(element => element.type === 'menu')!.props.menuSetId = secondary.id

      let batchCount = 0
      const batch = vi.fn(async (statements: any[]) => {
        batchCount += 1
        if (batchCount === 1) {
          await fixture.db.delete(siteMenuSet).where(eq(siteMenuSet.id, secondary.id))
        }
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') {
            return vi.fn(() => {
              throw new Error('D1 Layout save must use batch')
            })
          }
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(updateLayout(event, created.id, { revision: 1, document }, 'layout-writer'))
        .rejects.toMatchObject({
          name: LayoutValidationError.name,
          issues: [expect.objectContaining({ path: expect.stringContaining('menuSetId'), message: expect.stringContaining(secondary.id) })]
        })
      expect(batch).toHaveBeenCalledOnce()
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({ currentRevision: 1, documentJson: JSON.stringify(created.document) })
      expect(await fixture.db.select().from(documentRevision).where(and(
        eq(documentRevision.documentKind, 'layout'),
        eq(documentRevision.documentId, created.id)
      ))).toHaveLength(1)
      expect(await fixture.db.select().from(siteMenuReference).where(and(
        eq(siteMenuReference.ownerType, 'site-layout'),
        eq(siteMenuReference.ownerId, created.id)
      ))).toEqual([expect.objectContaining({ menuSetId: 'global-navigation' })])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects dangling Menu IDs before save without mutating current state', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { ensureGlobalSiteMenu } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      const { LayoutValidationError, createLayout, updateLayout } = await import('../server/utils/site-layouts')
      const created = await createLayout({} as any, { name: 'Dangling', presetKey: 'blank' }, 'admin')
      const headerDocument = structuredClone(created.document!)
      headerDocument.grid.regions.push({
        id: 'header',
        flow: 'start',
        placement: {
          mobile: { row: 2, column: 1, span: 4, visibility: 'visible' },
          tablet: { row: 2, column: 1, span: 8, visibility: 'visible' },
          desktop: { row: 2, column: 1, span: 12, visibility: 'visible' }
        }
      })
      const menu: LayoutElement = {
        id: 'missing-menu-element',
        type: 'menu',
        region: 'header',
        order: 0,
        props: { menuSetId: 'missing-menu', orientation: 'horizontal' }
      }
      const document = insertLayoutElement(headerDocument, menu)
      await expect(updateLayout({} as any, created.id, { revision: 1, document }, 'admin'))
        .rejects.toMatchObject({ name: LayoutValidationError.name, issues: [expect.objectContaining({ message: 'Menu set does not exist: missing-menu' })] })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, created.id)).get())
        .toMatchObject({ currentRevision: 1 })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})
