import { KOREAN_SEARCH_TOKENIZER_GENERATION } from '@halopress/korean-search-tokenizer'
import { eq, sql } from 'drizzle-orm'

import type { Db } from '../db/db'
import { fullTextControl, fullTextJob } from '../db/schema'
import { executeDbStatement, type DbStatement } from '../db/transaction'
import { newId } from '../utils/ids'
import { normalizeSearchConfig } from './search-helpers'
import type { SchemaRegistry } from './types'

type FullTextOperation = 'index' | 'remove' | 'schema-sync' | 'reindex' | 'reindex-sync'

function jobValues(args: {
  operation: FullTextOperation
  documentId: string
  schemaKey?: string | null
  schemaVersion?: number | null
  fieldId?: string
  targetRevisionId?: string | null
  identityKey: string
  now: Date
}) {
  const indexGeneration = newId()
  return {
    id: newId(),
    identityKey: args.identityKey,
    operation: args.operation,
    documentKind: 'content',
    documentId: args.documentId,
    schemaKey: args.schemaKey ?? null,
    schemaVersion: args.schemaVersion ?? null,
    fieldId: args.fieldId ?? '*',
    targetRevisionId: args.targetRevisionId ?? null,
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    indexGeneration,
    status: 'pending',
    checkpoint: 0,
    totalChunks: null,
    attemptCount: 0,
    availableAt: args.now,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: args.now,
    updatedAt: args.now,
    completedAt: null
  }
}

async function insertJob(db: Db, statements: DbStatement[] | undefined, values: ReturnType<typeof jobValues>) {
  await executeDbStatement(db.insert(fullTextJob).values(values).onConflictDoNothing({
    target: fullTextJob.identityKey
  }), statements)
}

export function fullTextFields(registry: SchemaRegistry) {
  return registry.fields.filter(field => normalizeSearchConfig(field).fullText)
}

export async function bumpFullTextQueryEpoch(args: {
  db: Db
  statements?: DbStatement[]
  now: Date
}) {
  await executeDbStatement(args.db.insert(fullTextControl).values({
    key: 'singleton',
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    queryEpoch: 1,
    status: 'available',
    updatedAt: args.now
  }).onConflictDoUpdate({
    target: fullTextControl.key,
    set: {
      tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
      queryEpoch: sql`${fullTextControl.queryEpoch} + 1`,
      updatedAt: args.now
    }
  }), args.statements)
}

export async function enqueuePublishedContentFullText(args: {
  db: Db
  statements?: DbStatement[]
  documentId: string
  schemaKey: string
  schemaVersion: number
  revisionId: string
  registry: SchemaRegistry
  now: Date
}) {
  for (const field of fullTextFields(args.registry)) {
    await insertJob(args.db, args.statements, jobValues({
      operation: 'index',
      documentId: args.documentId,
      schemaKey: args.schemaKey,
      schemaVersion: args.schemaVersion,
      fieldId: field.fieldId,
      targetRevisionId: args.revisionId,
      identityKey: [
        'index',
        args.documentId,
        field.fieldId,
        args.revisionId,
        KOREAN_SEARCH_TOKENIZER_GENERATION
      ].join(':'),
      now: args.now
    }))
  }
}

export async function enqueueContentFullTextRemoval(args: {
  db: Db
  statements?: DbStatement[]
  documentId: string
  schemaKey: string
  sourceRevision: number
  targetRevisionId?: string | null
  now: Date
}) {
  await insertJob(args.db, args.statements, jobValues({
    operation: 'remove',
    documentId: args.documentId,
    schemaKey: args.schemaKey,
    targetRevisionId: args.targetRevisionId ?? null,
    identityKey: [
      'remove',
      args.documentId,
      args.sourceRevision,
      KOREAN_SEARCH_TOKENIZER_GENERATION
    ].join(':'),
    now: args.now
  }))
}

export async function enqueueSchemaFullTextSync(args: {
  db: Db
  statements?: DbStatement[]
  schemaKey: string
  schemaVersion: number
  now: Date
}) {
  await insertJob(args.db, args.statements, jobValues({
    operation: 'schema-sync',
    documentId: args.schemaKey,
    schemaKey: args.schemaKey,
    schemaVersion: args.schemaVersion,
    identityKey: [
      'schema-sync',
      args.schemaKey,
      args.schemaVersion,
      KOREAN_SEARCH_TOKENIZER_GENERATION
    ].join(':'),
    now: args.now
  }))
}

export async function enqueueSchemaFullTextReindex(args: {
  db: Db
  schemaKey: string
  requestId: string
  now: Date
}) {
  await insertJob(args.db, undefined, jobValues({
    operation: 'reindex-sync',
    documentId: args.schemaKey,
    schemaKey: args.schemaKey,
    identityKey: [
      'reindex-sync',
      args.schemaKey,
      args.requestId,
      KOREAN_SEARCH_TOKENIZER_GENERATION
    ].join(':'),
    now: args.now
  }))
}

export async function pendingFullTextJobIds(db: Db, limit = 50) {
  const rows = await db.select({ id: fullTextJob.id })
    .from(fullTextJob)
    .where(eq(fullTextJob.status, 'pending'))
    .limit(limit)
  return rows.map((row: { id: string }) => row.id)
}
