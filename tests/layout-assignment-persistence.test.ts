import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  createLayoutDocumentFromPreset,
  layoutNameKey
} from '../shared/site-layout'
import {
  content,
  layoutReference,
  layoutResource,
  page,
  publicationRevision,
  schema,
  schemaActive,
  settings
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => {
  vi.restoreAllMocks()
})

const localEvent = { context: {} } as any
const d1Event = { context: { cloudflare: { env: { DB: {} } } } } as any

async function enableSiteMode(db: any, enabled = true) {
  const now = new Date('2026-07-18T00:00:00.000Z')
  await db.insert(settings).values({
    scope: 'global',
    key: 'site.mode',
    value: JSON.stringify({ version: 1, enabled }),
    valueType: 'json',
    isEncrypted: false,
    groupKey: 'site.mode',
    updatedAt: now
  }).onConflictDoUpdate({
    target: [settings.scope, settings.key],
    set: { value: JSON.stringify({ version: 1, enabled }), updatedAt: now }
  })
}

async function seedLayout(db: any, layoutId: string, name: string, revision = 1) {
  const now = new Date('2026-07-18T00:01:00.000Z')
  const document = createLayoutDocumentFromPreset('blank', layoutId, name)
  await db.insert(layoutResource).values({
    id: layoutId,
    name,
    nameKey: layoutNameKey(name),
    documentJson: JSON.stringify(document),
    currentRevision: revision,
    createdAt: now,
    updatedAt: now
  })
  return document
}

describe('Site Layout assignment persistence', () => {
  it('preserves unchanged Page or Schema input while disabled and gates explicit clear or change', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db, false)
      await seedLayout(fixture.db, 'layout-current', 'Current Layout')
      await seedLayout(fixture.db, 'layout-next', 'Next Layout')
      const {
        LayoutAssignmentModeDisabledError,
        prepareLayoutAssignmentChange
      } = await import('../server/utils/layout-assignments')

      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: {},
        currentLayoutId: 'layout-current'
      })).resolves.toBe('layout-current')
      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: { layoutId: 'layout-current' },
        currentLayoutId: 'layout-current'
      })).resolves.toBe('layout-current')
      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: { layoutId: null },
        currentLayoutId: 'layout-current'
      })).rejects.toMatchObject({ name: LayoutAssignmentModeDisabledError.name })
      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: { layoutId: 'layout-next' },
        currentLayoutId: 'layout-current'
      })).rejects.toMatchObject({ name: LayoutAssignmentModeDisabledError.name })

      await enableSiteMode(fixture.db, true)
      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: { layoutId: 'layout-next' },
        currentLayoutId: 'layout-current'
      })).resolves.toBe('layout-next')
      await expect(prepareLayoutAssignmentChange({
        event: localEvent,
        db: fixture.db,
        body: { layoutId: null },
        currentLayoutId: 'layout-current'
      })).resolves.toBeNull()
    } finally {
      fixture.close()
    }
  })

  it('treats clearing a malformed Site setting as a gated change while Site mode is disabled', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db, false)
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.layout.default',
        value: JSON.stringify({ version: 1, layoutId: 42 }),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.layout',
        updatedAt: new Date('2026-07-18T00:00:30.000Z')
      })
      const {
        LayoutAssignmentModeDisabledError,
        updateSiteLayoutAssignment
      } = await import('../server/utils/layout-assignments')

      await expect(updateSiteLayoutAssignment(localEvent, { layoutId: null }, 'admin-1'))
        .rejects.toMatchObject({ name: LayoutAssignmentModeDisabledError.name })
      expect((await fixture.db.select().from(settings).where(eq(settings.key, 'site.layout.default')).get())?.value)
        .toBe(JSON.stringify({ version: 1, layoutId: 42 }))
    } finally {
      fixture.close()
    }
  })

  it('atomically writes the typed Site setting and normalized restrictive reference in SQLite', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db)
      await seedLayout(fixture.db, 'layout-site', 'Site Layout')
      const { updateSiteLayoutAssignment } = await import('../server/utils/layout-assignments')

      await updateSiteLayoutAssignment(localEvent, { layoutId: 'layout-site' }, 'admin-1')

      expect(await fixture.db.select().from(settings).where(and(
        eq(settings.scope, 'global'),
        eq(settings.key, 'site.layout.default')
      )).get()).toMatchObject({
        value: JSON.stringify({ version: 1, layoutId: 'layout-site' }),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.layout',
        updatedBy: 'admin-1'
      })
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerType, 'site'),
        eq(layoutReference.ownerId, 'default'),
        eq(layoutReference.slot, 'default')
      )).get()).toMatchObject({
        layoutId: 'layout-site',
        behavior: 'use-current',
        label: 'Site default Layout'
      })
    } finally {
      fixture.close()
    }
  })

  it('rolls back the Site setting when the normalized reference write fails in SQLite', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db)
      await seedLayout(fixture.db, 'layout-site', 'Site Layout')
      await fixture.db.run(sql.raw(`
        CREATE TRIGGER reject_site_layout_reference
        BEFORE INSERT ON site_layout_reference
        WHEN NEW.owner_type = 'site'
        BEGIN
          SELECT RAISE(ABORT, 'forced reference failure');
        END
      `))
      const { updateSiteLayoutAssignment } = await import('../server/utils/layout-assignments')

      await expect(updateSiteLayoutAssignment(localEvent, { layoutId: 'layout-site' }, 'admin-1'))
        .rejects.toThrow('Failed query')
      expect(await fixture.db.select().from(settings).where(eq(settings.key, 'site.layout.default'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(eq(layoutReference.ownerType, 'site'))).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('lets an assignment win a SQLite delete race through the restrictive normalized reference', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db)
      await seedLayout(fixture.db, 'layout-site', 'Site Layout')
      const { updateSiteLayoutAssignment } = await import('../server/utils/layout-assignments')
      const { LayoutInUseError, deleteLayout } = await import('../server/utils/site-layouts')

      await updateSiteLayoutAssignment(localEvent, { layoutId: 'layout-site' }, 'admin-1')
      await expect(deleteLayout(localEvent, 'layout-site', { revision: 1 }, 'admin-2'))
        .rejects.toMatchObject({
          name: LayoutInUseError.name,
          usage: [expect.objectContaining({ resourceType: 'site', resourceId: 'default' })]
        })
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, 'layout-site')).get()).toBeTruthy()
      expect(await fixture.db.select().from(layoutReference).where(eq(layoutReference.layoutId, 'layout-site'))).toHaveLength(1)
    } finally {
      fixture.close()
    }
  })

  it('uses one D1 batch and rolls the typed setting back when deletion wins before reference insertion', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db)
      await seedLayout(fixture.db, 'layout-racy', 'Racy Layout')

      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.delete(layoutResource).where(eq(layoutResource.id, 'layout-racy'))
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) await statement
          await fixture.db.run(sql.raw('COMMIT'))
        } catch (error) {
          await fixture.db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(fixture.db as any, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') return vi.fn(() => {
            throw new Error('D1 assignment writes must use batch')
          })
          return Reflect.get(target, property, receiver)
        }
      })
      dbState.current = d1Db
      const {
        LayoutAssignmentValidationError,
        updateSiteLayoutAssignment
      } = await import('../server/utils/layout-assignments')

      await expect(updateSiteLayoutAssignment(d1Event, { layoutId: 'layout-racy' }, 'admin-1'))
        .rejects.toMatchObject({ name: LayoutAssignmentValidationError.name })
      expect(batch).toHaveBeenCalledTimes(1)
      expect(batch.mock.calls[0]?.[0]).toHaveLength(2)
      expect(await fixture.db.select().from(layoutResource).where(eq(layoutResource.id, 'layout-racy'))).toEqual([])
      expect(await fixture.db.select().from(settings).where(eq(settings.key, 'site.layout.default'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(eq(layoutReference.ownerType, 'site'))).toEqual([])
    } finally {
      fixture.close()
    }
  })
})

describe('published Layout resolution', () => {
  it('resolves a publication exact historical Schema version and follows the assigned Layout current revision', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSiteMode(fixture.db)
      const historicalDocument = await seedLayout(fixture.db, 'layout-schema-v1', 'Schema v1 Layout')
      await seedLayout(fixture.db, 'layout-schema-v2', 'Schema v2 Layout')
      const now = new Date('2026-07-18T00:02:00.000Z')
      await fixture.db.insert(schema).values([
        {
          schemaKey: 'article',
          version: 1,
          title: 'Article v1',
          astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [], presentation: { layoutId: 'layout-schema-v1' } }),
          jsonSchema: JSON.stringify({ type: 'object' }),
          createdAt: now
        },
        {
          schemaKey: 'article',
          version: 2,
          title: 'Article v2',
          astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [], presentation: { layoutId: 'layout-schema-v2' } }),
          jsonSchema: JSON.stringify({ type: 'object' }),
          createdAt: now
        }
      ])
      await fixture.db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 2, updatedAt: now })
      await fixture.db.insert(publicationRevision).values({
        id: 'publication-content-v1',
        documentKind: 'content',
        documentId: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        contentJson: JSON.stringify({ title: 'Published under v1' }),
        createdAt: now
      })
      await fixture.db.insert(content).values({
        id: 'article-1',
        schemaKey: 'article',
        schemaVersion: 2,
        status: 'published',
        contentJson: JSON.stringify({ title: 'Working under v2' }),
        publishedRevisionId: 'publication-content-v1',
        createdAt: now,
        updatedAt: now
      })
      const { resolvePublishedContentLayout } = await import('../server/utils/layout-assignments')

      expect(await resolvePublishedContentLayout(localEvent, 'article-1')).toMatchObject({
        status: 'ready',
        source: 'schema',
        layoutId: 'layout-schema-v1',
        revision: 1
      })

      const revisedDocument = {
        ...structuredClone(historicalDocument),
        grid: { ...structuredClone(historicalDocument.grid), gap: 'spacious' as const }
      }
      await fixture.db.update(layoutResource).set({
        documentJson: JSON.stringify(revisedDocument),
        currentRevision: 2,
        updatedAt: new Date('2026-07-18T00:03:00.000Z')
      }).where(eq(layoutResource.id, 'layout-schema-v1'))

      expect(await resolvePublishedContentLayout(localEvent, 'article-1')).toMatchObject({
        status: 'ready',
        source: 'schema',
        layoutId: 'layout-schema-v1',
        revision: 2,
        document: { grid: { gap: 'spacious' } }
      })
    } finally {
      fixture.close()
    }
  })

  it('keeps private Site assignment administration fields out of public Page delivery', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-18T00:04:00.000Z')
      await fixture.db.insert(publicationRevision).values({
        id: 'publication-page',
        documentKind: 'page',
        documentId: 'page-public',
        title: 'Public Page',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        layoutId: 'historical-layout-id',
        createdAt: now
      })
      await fixture.db.insert(page).values({
        id: 'page-public',
        title: 'Working Page',
        status: 'published',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        layoutId: 'working-layout-id',
        publishedRevisionId: 'publication-page',
        publishedAt: now,
        createdAt: now,
        updatedAt: now
      })
      const { getPublishedPage } = await import('../server/cms/page-delivery')

      const publicPage = await getPublishedPage(fixture.db, 'page-public')
      expect(publicPage).toEqual({
        id: 'page-public',
        title: 'Public Page',
        status: 'published',
        content: { type: 'doc', content: [] },
        publishedAt: now
      })
      expect(JSON.stringify(publicPage)).not.toMatch(/configured|malformedStoredValue|storedLayoutId|updatedBy/)

      const deliverySource = await readFile(resolve(import.meta.dirname, '../server/api/delivery/page/[id].get.ts'), 'utf8')
      expect(deliverySource).not.toContain('getSiteLayoutAssignmentAdmin')
      expect(deliverySource).not.toContain('/api/settings/site-layout')
    } finally {
      fixture.close()
    }
  })
})
