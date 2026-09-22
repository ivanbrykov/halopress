import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createLayoutDocumentFromPreset, layoutNameKey } from '../shared/site-layout'
import { commitSchemaPublication } from '../server/cms/schema-publication'
import {
  layoutReference,
  layoutResource,
  publicRoute,
  schema,
  schemaActive,
  schemaDraft,
  schemaRole
} from '../server/db/schema'
import { runMigrations, seedRoles } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const localEvent = { context: {} } as any
const d1Event = { context: { cloudflare: { env: { DB: {} } } } } as any

async function seedLayout(db: any, layoutId: string) {
  const now = new Date('2026-07-18T02:00:00.000Z')
  const name = `Schema publication ${layoutId}`
  await db.insert(layoutResource).values({
    id: layoutId,
    name,
    nameKey: layoutNameKey(name),
    documentJson: JSON.stringify(createLayoutDocumentFromPreset('blank', layoutId, name)),
    createdAt: now,
    updatedAt: now
  })
}

function publicationArgs(db: any, event: any, layoutId: string) {
  return {
    event,
    db,
    schemaKey: 'article',
    expectedDraftRevision: 1,
    version: 1,
    previousVersion: null,
    title: 'Article',
    ast: { schemaKey: 'article', title: 'Article', fields: [], presentation: { layoutId } },
    jsonSchema: { type: 'object' },
    uiSchema: { 'x-ui': { schemaKey: 'article' } },
    registry: { schemaKey: 'article', version: 1, title: 'Article', fields: [], relations: [] },
    note: 'test publication',
    actorId: 'admin-1',
    layoutId,
    now: new Date('2026-07-18T02:01:00.000Z')
  }
}

async function seedDraft(db: any, layoutId: string, revision = 1) {
  await db.insert(schemaDraft).values({
    schemaKey: 'article',
    title: 'Article',
    astJson: JSON.stringify({ schemaKey: 'article', title: 'Article', fields: [], presentation: { layoutId } }),
    currentRevision: revision,
    updatedBy: revision === 1 ? 'admin-1' : 'admin-2',
    updatedAt: new Date(`2026-07-18T02:00:0${revision}.000Z`)
  })
}

describe('Schema Layout publication atomicity', () => {
  it('commits version, pointer, route, role, and exact-version reference together in SQLite', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema')
      await seedDraft(fixture.db, 'layout-schema')

      await commitSchemaPublication(publicationArgs(fixture.db, localEvent, 'layout-schema'))

      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toHaveLength(1)
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article')).get())
        .toMatchObject({ activeVersion: 1 })
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article')).get())
        .toMatchObject({ roleKey: 'anonymous', canRead: true })
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article')).get())
        .toMatchObject({ path: '/article', routeKind: 'canonical' })
      expect(await fixture.db.select().from(layoutReference).where(eq(layoutReference.ownerId, 'article')).get())
        .toMatchObject({ ownerType: 'schema', slot: 'published:1', layoutId: 'layout-schema' })
    } finally {
      fixture.close()
    }
  })

  it('rejects a stale draft inside the SQLite transaction before any public write', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema-stale-sqlite')
      await seedDraft(fixture.db, 'layout-schema-stale-sqlite', 2)
      const updatedAt = new Date('2026-07-18T02:00:02.000Z')

      await expect(commitSchemaPublication(publicationArgs(
        fixture.db,
        localEvent,
        'layout-schema-stale-sqlite'
      ))).rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Document has changed since it was loaded',
        data: { currentRevision: 2, updatedAt, updatedBy: 'admin-2' }
      })
      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerId, 'article'),
        eq(layoutReference.slot, 'published:1')
      ))).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('rejects a missing draft inside the SQLite transaction before any public write', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema-purged-sqlite')

      await expect(commitSchemaPublication(publicationArgs(
        fixture.db,
        localEvent,
        'layout-schema-purged-sqlite'
      ))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Draft not found' })
      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerId, 'article'),
        eq(layoutReference.slot, 'published:1')
      ))).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('uses one D1 batch and leaves no half-published state when Layout deletion wins', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema-racy')
      await seedDraft(fixture.db, 'layout-schema-racy')
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.delete(layoutResource).where(eq(layoutResource.id, 'layout-schema-racy'))
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
            throw new Error('D1 Schema publication must use batch')
          })
          return Reflect.get(target, property, receiver)
        }
      })

      await expect(commitSchemaPublication(publicationArgs(d1Db, d1Event, 'layout-schema-racy')))
        .rejects.toThrow(/site_layout_reference/)
      expect(batch).toHaveBeenCalledOnce()
      expect(batch.mock.calls[0]?.[0]).toHaveLength(8)
      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(eq(layoutReference.ownerId, 'article'))).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('fences a D1 publish when the draft advances after the precheck and rolls every public write back', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema-stale')
      await seedLayout(fixture.db, 'layout-schema-new')
      await seedDraft(fixture.db, 'layout-schema-stale')
      const updatedAt = new Date('2026-07-18T02:02:00.000Z')
      let executedStatements = 0
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.update(schemaDraft).set({
          astJson: JSON.stringify({
            schemaKey: 'article',
            title: 'Article',
            fields: [],
            presentation: { layoutId: 'layout-schema-new' }
          }),
          currentRevision: 2,
          updatedBy: 'admin-2',
          updatedAt
        }).where(eq(schemaDraft.schemaKey, 'article'))
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) {
            executedStatements += 1
            await statement
          }
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
            throw new Error('D1 Schema publication must use batch')
          })
          return Reflect.get(target, property, receiver)
        }
      })

      await expect(commitSchemaPublication(publicationArgs(d1Db, d1Event, 'layout-schema-stale')))
        .rejects.toMatchObject({
          statusCode: 409,
          statusMessage: 'Document has changed since it was loaded',
          data: { currentRevision: 2, updatedAt, updatedBy: 'admin-2' }
        })
      expect(batch).toHaveBeenCalledOnce()
      expect(batch.mock.calls[0]?.[0]).toHaveLength(8)
      expect(executedStatements).toBe(1)
      expect(await fixture.db.select().from(schemaDraft).where(eq(schemaDraft.schemaKey, 'article')).get())
        .toMatchObject({ currentRevision: 2, updatedBy: 'admin-2' })
      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerId, 'article'),
        eq(layoutReference.slot, 'published:1')
      ))).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('fences a D1 publish when purge removes the prechecked draft and rolls every public write back', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await seedRoles(fixture.db)
      await seedLayout(fixture.db, 'layout-schema-purged')
      await seedDraft(fixture.db, 'layout-schema-purged')
      let executedStatements = 0
      const batch = vi.fn(async (statements: any[]) => {
        await fixture.db.delete(schemaDraft).where(eq(schemaDraft.schemaKey, 'article'))
        await fixture.db.run(sql.raw('BEGIN IMMEDIATE'))
        try {
          for (const statement of statements) {
            executedStatements += 1
            await statement
          }
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
            throw new Error('D1 Schema publication must use batch')
          })
          return Reflect.get(target, property, receiver)
        }
      })

      await expect(commitSchemaPublication(publicationArgs(d1Db, d1Event, 'layout-schema-purged')))
        .rejects.toMatchObject({ statusCode: 404, statusMessage: 'Draft not found' })
      expect(batch).toHaveBeenCalledOnce()
      expect(batch.mock.calls[0]?.[0]).toHaveLength(8)
      expect(executedStatements).toBe(1)
      expect(await fixture.db.select().from(schemaDraft).where(eq(schemaDraft.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schema).where(eq(schema.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaActive).where(eq(schemaActive.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(schemaRole).where(eq(schemaRole.schemaKey, 'article'))).toEqual([])
      expect(await fixture.db.select().from(publicRoute).where(eq(publicRoute.documentId, 'article'))).toEqual([])
      expect(await fixture.db.select().from(layoutReference).where(and(
        eq(layoutReference.ownerId, 'article'),
        eq(layoutReference.slot, 'published:1')
      ))).toEqual([])
    } finally {
      fixture.close()
    }
  })
})
