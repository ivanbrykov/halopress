import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  diffDocumentSnapshots,
  listDocumentRevisions,
  mutateWithDocumentRevision
} from '../server/cms/document-revisions'
import { assertDraftWriteStatus, assertEditorialTransition } from '../server/cms/publication-transitions'
import { content, documentAssetRef, documentRevision } from '../server/db/schema'
import { executeDbStatement } from '../server/db/transaction'
import { runMigrations } from '../server/utils/install'
import { hasSchemaPermission } from '../server/utils/schema-permission'
import { createTestSqliteDb } from './fixtures/sqlite'

vi.mock('#auth', () => ({ getToken: vi.fn() }))

const event = { context: {} } as any

describe('editorial revision safety', () => {
  it('produces stable nested diffs', () => {
    expect(diffDocumentSnapshots(
      { title: 'Before', tags: ['one'], nested: { keep: true } },
      { title: 'After', tags: ['one', 'two'], nested: { keep: true } }
    )).toEqual([
      { path: '$.tags[1]', before: undefined, after: 'two' },
      { path: '$.title', before: 'Before', after: 'After' }
    ])
  })

  it('treats array and object shape changes as a direct replacement', () => {
    expect(diffDocumentSnapshots(['one'], { 0: 'one' })).toEqual([{
      path: '$',
      before: ['one'],
      after: { 0: 'one' }
    }])
  })

  it('rejects arbitrary status writes and invalid recovery transitions', () => {
    expect(() => assertDraftWriteStatus('published')).toThrowError('Use an explicit publication transition endpoint')
    expect(() => assertEditorialTransition('draft', 'recover')).toThrowError('Cannot recover a draft document')
    expect(assertEditorialTransition('deleted', 'recover')).toBe('deleted')
  })

  it('keeps edit, publication, archival, and destructive capabilities independent', () => {
    const base = {
      roleKey: 'writer',
      canRead: false,
      canWrite: true,
      canPublish: false,
      canArchive: false,
      canDelete: false,
      canAdmin: false
    }
    expect(hasSchemaPermission(base, 'read')).toBe(true)
    expect(hasSchemaPermission(base, 'write')).toBe(true)
    expect(hasSchemaPermission(base, 'publish')).toBe(false)
    expect(hasSchemaPermission({ ...base, canPublish: true }, 'publish')).toBe(true)
    expect(hasSchemaPermission({ ...base, canArchive: true }, 'archive')).toBe(true)
    expect(hasSchemaPermission({ ...base, canDelete: true }, 'delete')).toBe(true)
  })

  it('turns a racing stale save into 409 and rolls back projection writes', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      const createdAt = new Date('2026-07-14T00:00:00.000Z')
      await db.insert(content).values({
        id: 'article-1',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify({ title: 'Initial' }),
        currentRevision: 1,
        createdAt,
        updatedAt: createdAt
      })
      await db.insert(documentRevision).values({
        id: 'revision-1',
        documentKind: 'content',
        documentId: 'article-1',
        schemaKey: 'article',
        revision: 1,
        action: 'create',
        status: 'draft',
        schemaVersion: 1,
        snapshotJson: JSON.stringify({ title: 'Initial' }),
        createdAt
      })

      const staleIdentity = { currentRevision: 1, updatedAt: createdAt, updatedBy: null }
      await mutateWithDocumentRevision({
        event,
        db,
        identity: staleIdentity,
        expectedRevision: 1,
        documentKind: 'content',
        documentId: 'article-1',
        schemaKey: 'article',
        action: 'save',
        state: { snapshot: { title: 'Winner' }, status: 'draft', schemaVersion: 1 },
        actorId: 'writer-1',
        work: async (tx, statements, nextRevision, now) => {
          await executeDbStatement(tx.update(content).set({
            contentJson: JSON.stringify({ title: 'Winner' }),
            currentRevision: nextRevision,
            updatedBy: 'writer-1',
            updatedAt: now
          }).where(and(eq(content.id, 'article-1'), eq(content.currentRevision, 1))), statements)
        }
      })

      await expect(mutateWithDocumentRevision({
        event,
        db,
        identity: staleIdentity,
        expectedRevision: 1,
        documentKind: 'content',
        documentId: 'article-1',
        schemaKey: 'article',
        action: 'save',
        state: { snapshot: { title: 'Loser' }, status: 'draft', schemaVersion: 1 },
        actorId: 'writer-2',
        work: async (tx, statements, nextRevision, now) => {
          await executeDbStatement(tx.update(content).set({
            contentJson: JSON.stringify({ title: 'Loser' }),
            currentRevision: nextRevision,
            updatedBy: 'writer-2',
            updatedAt: now
          }).where(and(eq(content.id, 'article-1'), eq(content.currentRevision, 1))), statements)
          await executeDbStatement(tx.insert(documentAssetRef).values({
            documentKind: 'content',
            documentId: 'article-1',
            projectionScope: 'working',
            assetId: 'loser-asset'
          }), statements)
        }
      })).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 2 })
      })

      expect(await db.select().from(documentAssetRef).where(eq(documentAssetRef.documentId, 'article-1'))).toEqual([])
      const stored = await db.select().from(content).where(eq(content.id, 'article-1')).get()
      expect(JSON.parse(stored!.contentJson)).toEqual({ title: 'Winner' })
      expect(stored!.currentRevision).toBe(2)
      const history = await listDocumentRevisions(db, 'content', 'article-1')
      expect(history.items.map(item => [item.revision, item.action])).toEqual([[2, 'save'], [1, 'create']])
    } finally {
      fixture.close()
    }
  })

  it('retains the latest 100 ordinary saves by count on the D1 batch path', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      const createdAt = new Date('2026-07-14T00:00:00.000Z')
      await db.insert(content).values({
        id: 'article-retention',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify({ title: 'Revision 111' }),
        currentRevision: 111,
        createdAt,
        updatedAt: createdAt
      })
      await db.insert(documentRevision).values([
        {
          id: 'retention-1',
          documentKind: 'content',
          documentId: 'article-retention',
          schemaKey: 'article',
          revision: 1,
          action: 'create',
          status: 'draft',
          schemaVersion: 1,
          snapshotJson: JSON.stringify({ title: 'Revision 1' }),
          createdAt
        },
        ...Array.from({ length: 110 }, (_, index) => {
          const revision = index + 2
          const action = revision >= 12 && revision <= 20 ? 'publish' : 'save'
          return {
            id: `retention-${revision}`,
            documentKind: 'content' as const,
            documentId: 'article-retention',
            schemaKey: 'article',
            revision,
            action: action as 'publish' | 'save',
            status: action === 'publish' ? 'published' : 'draft',
            schemaVersion: 1,
            snapshotJson: JSON.stringify({ title: `Revision ${revision}` }),
            createdAt
          }
        })
      ])

      const batch = vi.fn(async (statements: any[]) => {
        for (const statement of statements) await statement
      })
      const d1Db = new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') return vi.fn(() => {
            throw new Error('D1 transaction must not be called')
          })
          return Reflect.get(target, property, receiver)
        }
      })
      const d1Event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await mutateWithDocumentRevision({
        event: d1Event,
        db: d1Db,
        identity: { currentRevision: 111, updatedAt: createdAt },
        expectedRevision: 111,
        documentKind: 'content',
        documentId: 'article-retention',
        schemaKey: 'article',
        action: 'save',
        state: { snapshot: { title: 'Revision 112' }, status: 'draft', schemaVersion: 1 },
        actorId: 'writer-1',
        work: async (tx, statements, nextRevision, now) => {
          await executeDbStatement(tx.update(content).set({
            contentJson: JSON.stringify({ title: 'Revision 112' }),
            currentRevision: nextRevision,
            updatedBy: 'writer-1',
            updatedAt: now
          }).where(and(
            eq(content.id, 'article-retention'),
            eq(content.currentRevision, 111)
          )), statements)
        }
      })

      const revisions = await db.select().from(documentRevision)
        .where(eq(documentRevision.documentId, 'article-retention'))
      const saves = revisions.filter(row => row.action === 'save')
      expect(batch).toHaveBeenCalledOnce()
      expect(saves).toHaveLength(100)
      expect(saves.map(row => row.revision).sort((a, b) => a - b)).toEqual([
        ...Array.from({ length: 8 }, (_, index) => index + 4),
        ...Array.from({ length: 92 }, (_, index) => index + 21)
      ])
      expect(revisions.filter(row => row.action === 'publish')).toHaveLength(9)
      expect(revisions.some(row => row.action === 'create' && row.revision === 1)).toBe(true)
    } finally {
      fixture.close()
    }
  })

  it('rolls back a stale D1 batch when the expected save revision was pruned', async () => {
    const fixture = await createTestSqliteDb()
    const { db } = fixture
    try {
      await runMigrations(db)
      const createdAt = new Date('2026-07-14T00:00:00.000Z')
      await db.insert(content).values({
        id: 'article-pruned-race',
        schemaKey: 'article',
        schemaVersion: 1,
        status: 'draft',
        contentJson: JSON.stringify({ title: 'Current' }),
        currentRevision: 202,
        createdAt,
        updatedAt: createdAt
      })
      await db.insert(documentRevision).values([
        {
          id: 'pruned-race-create',
          documentKind: 'content',
          documentId: 'article-pruned-race',
          schemaKey: 'article',
          revision: 1,
          action: 'create',
          status: 'draft',
          schemaVersion: 1,
          snapshotJson: JSON.stringify({ title: 'Initial' }),
          createdAt
        },
        {
          id: 'pruned-race-current',
          documentKind: 'content',
          documentId: 'article-pruned-race',
          schemaKey: 'article',
          revision: 202,
          action: 'save',
          status: 'draft',
          schemaVersion: 1,
          snapshotJson: JSON.stringify({ title: 'Current' }),
          createdAt
        }
      ])

      const batch = vi.fn(async (statements: any[]) => {
        await db.run(sql.raw('BEGIN'))
        try {
          const results = []
          for (const statement of statements) results.push(await statement)
          await db.run(sql.raw('COMMIT'))
          return results
        } catch (error) {
          await db.run(sql.raw('ROLLBACK'))
          throw error
        }
      })
      const d1Db = new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') return vi.fn(() => {
            throw new Error('D1 transaction must not be called')
          })
          return Reflect.get(target, property, receiver)
        }
      })
      const d1Event = { context: { cloudflare: { env: { DB: {} } } } } as any

      await expect(mutateWithDocumentRevision({
        event: d1Event,
        db: d1Db,
        identity: { currentRevision: 2, updatedAt: createdAt },
        expectedRevision: 2,
        documentKind: 'content',
        documentId: 'article-pruned-race',
        schemaKey: 'article',
        action: 'save',
        state: { snapshot: { title: 'Stale' }, status: 'draft', schemaVersion: 1 },
        actorId: 'stale-writer',
        work: async (tx, statements, nextRevision, now) => {
          await executeDbStatement(tx.update(content).set({
            contentJson: JSON.stringify({ title: 'Stale' }),
            currentRevision: nextRevision,
            updatedBy: 'stale-writer',
            updatedAt: now
          }).where(and(
            eq(content.id, 'article-pruned-race'),
            eq(content.currentRevision, 2)
          )), statements)
          await executeDbStatement(tx.insert(documentAssetRef).values({
            documentKind: 'content',
            documentId: 'article-pruned-race',
            projectionScope: 'working',
            assetId: 'stale-asset'
          }), statements)
        }
      })).rejects.toMatchObject({
        statusCode: 409,
        data: expect.objectContaining({ currentRevision: 202 })
      })

      expect(batch).toHaveBeenCalledOnce()
      expect(await db.select().from(documentAssetRef)
        .where(eq(documentAssetRef.documentId, 'article-pruned-race'))).toEqual([])
      expect(await db.select().from(documentRevision).where(and(
        eq(documentRevision.documentId, 'article-pruned-race'),
        eq(documentRevision.revision, 3)
      ))).toEqual([])
      const stored = await db.select().from(content)
        .where(eq(content.id, 'article-pruned-race')).get()
      expect(JSON.parse(stored!.contentJson)).toEqual({ title: 'Current' })
      expect(stored!.currentRevision).toBe(202)
    } finally {
      fixture.close()
    }
  })
})
