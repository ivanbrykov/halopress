import { and, eq, notExists, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

import type { Db } from '../db/db'
import {
  schema as schemaTable,
  schemaActive as schemaActiveTable,
  schemaDraft as schemaDraftTable,
  schemaRole as schemaRoleTable
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import {
  schemaLayoutAssignmentOwner,
  syncLayoutAssignmentReference
} from '../utils/layout-assignments'
import { notFound } from '../utils/http'
import { revisionConflict } from './document-revisions'
import { publishSchemaCollectionRoute } from './public-routes'
import type { SchemaRegistry } from './types'
import { syncSearchConfig } from './search-config'
import { bumpFullTextQueryEpoch, enqueueSchemaFullTextSync } from './full-text-jobs'

function errorMessages(error: unknown) {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error ? current.message : String(current))
    current = typeof current === 'object' && current && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return messages
}

function isSchemaDraftRevisionGuardError(error: unknown) {
  return errorMessages(error).some(message => message.includes('schema_draft')
    && (message.includes('constraint failed') || message.includes('SQLITE_CONSTRAINT')))
}

async function guardSchemaDraftRevision(
  tx: Db,
  statements: any[] | undefined,
  schemaKey: string,
  expectedRevision: number
) {
  // D1 batches cannot inspect an UPDATE row count before later statements run.
  // When no exact row exists, this SELECT emits one deliberately invalid draft
  // from a constant source. Its NOT NULL (missing) or PK (newer) failure makes
  // the first write atomically abort every publication write in SQLite and D1.
  const exactDraft = tx.select({ one: sql`1` }).from(schemaDraftTable).where(and(
    eq(schemaDraftTable.schemaKey, schemaKey),
    eq(schemaDraftTable.currentRevision, expectedRevision)
  ))
  const failedDraftGuard = tx.select({
    schemaKey: sql<string>`${schemaKey}`,
    title: sql<string | null>`null`,
    astJson: sql<string>`null`,
    currentRevision: sql<number>`${expectedRevision}`,
    updatedBy: sql<string | null>`null`,
    updatedAt: sql<Date>`${sql.param(new Date(0), schemaDraftTable.updatedAt)}`,
    lockedBy: sql<string | null>`null`,
    lockExpiresAt: sql<Date | null>`null`
  }).from(sql`(select 1) as schema_draft_guard`).where(notExists(exactDraft)).limit(1)
  await executeDbStatement(tx.insert(schemaDraftTable).select(failedDraftGuard), statements)
}

export async function commitSchemaPublication(args: {
  event: H3Event
  db: Db
  schemaKey: string
  expectedDraftRevision: number
  version: number
  previousVersion: number | null
  title: string
  ast: unknown
  jsonSchema: unknown
  uiSchema: unknown
  registry: SchemaRegistry
  note: string | null
  actorId: string | null
  layoutId: string | null
  now: Date
}) {
  // The immutable version, active pointer, delivery role, route, and normalized
  // Layout reference are one publication decision. D1 executes this callback as
  // a batch; SQLite executes it in a transaction.
  try {
    await withDbTransaction(args.event, args.db, async (tx, statements) => {
      await guardSchemaDraftRevision(tx, statements, args.schemaKey, args.expectedDraftRevision)
      await executeDbStatement(tx.insert(schemaTable).values({
        schemaKey: args.schemaKey,
        version: args.version,
        title: args.title,
        astJson: JSON.stringify(args.ast),
        jsonSchema: JSON.stringify(args.jsonSchema),
        uiSchema: JSON.stringify(args.uiSchema),
        registryJson: JSON.stringify(args.registry),
        diffJson: JSON.stringify({ from: args.previousVersion, to: args.version }),
        createdBy: args.actorId,
        createdAt: args.now,
        note: args.note
      }), statements)

      await executeDbStatement(tx.insert(schemaActiveTable).values({
        schemaKey: args.schemaKey,
        activeVersion: args.version,
        updatedAt: args.now
      }).onConflictDoUpdate({
        target: schemaActiveTable.schemaKey,
        set: {
          activeVersion: args.version,
          updatedAt: args.now
        }
      }), statements)

      await executeDbStatement(tx.insert(schemaRoleTable).values({
        schemaKey: args.schemaKey,
        roleKey: 'anonymous',
        canRead: true,
        canWrite: false,
        canAdmin: false
      }).onConflictDoNothing(), statements)

      await syncSearchConfig({
        db: tx,
        schemaKey: args.schemaKey,
        registry: args.registry,
        statements
      })
      await enqueueSchemaFullTextSync({
        db: tx,
        statements,
        schemaKey: args.schemaKey,
        schemaVersion: args.version,
        now: args.now
      })
      await bumpFullTextQueryEpoch({ db: tx, statements, now: args.now })

      await publishSchemaCollectionRoute({
        db: tx,
        statements,
        schemaKey: args.schemaKey,
        now: args.now
      })
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: schemaLayoutAssignmentOwner(args.schemaKey, `published:${args.version}`),
        layoutId: args.layoutId,
        now: args.now
      })
    })
  } catch (error) {
    if (isSchemaDraftRevisionGuardError(error)) {
      const current = await args.db.select({
        currentRevision: schemaDraftTable.currentRevision,
        updatedAt: schemaDraftTable.updatedAt,
        updatedBy: schemaDraftTable.updatedBy
      }).from(schemaDraftTable).where(eq(schemaDraftTable.schemaKey, args.schemaKey)).get()
      if (current && current.currentRevision !== args.expectedDraftRevision) {
        throw revisionConflict(current)
      }
      if (!current) throw notFound('Draft not found')
    }
    throw error
  }
}
