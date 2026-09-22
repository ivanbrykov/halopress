import { and, asc, desc, eq, max, ne, notInArray } from 'drizzle-orm'
import type { H3Event } from 'h3'

import type { Db } from '../db/db'
import { documentRevision } from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { badRequest, conflict, notFound } from '../utils/http'
import { newId } from '../utils/ids'

export const DOCUMENT_REVISION_RETENTION_LIMIT = 100

export type DocumentKind = 'content' | 'page' | 'schema-draft' | 'layout'
export type DocumentRevisionAction =
  | 'backfill'
  | 'create'
  | 'save'
  | 'rename'
  | 'publish'
  | 'discard'
  | 'archive'
  | 'delete'
  | 'recover'
  | 'restore'
  | 'migrate'

export type RevisionIdentity = {
  currentRevision: number
  updatedAt?: Date | string | number | null
  updatedBy?: string | null
}

type RevisionSnapshot = {
  snapshot: unknown
  status?: string | null
  title?: string | null
  schemaVersion?: number | null
}

export function requireExpectedRevision(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw badRequest('A valid revision is required')
  }
  return Number(value)
}

export function assertExpectedRevision(identity: RevisionIdentity, expectedRevision: number) {
  if (identity.currentRevision !== expectedRevision) {
    throw revisionConflict(identity)
  }
}

export function revisionConflict(identity: RevisionIdentity) {
  return conflict('Document has changed since it was loaded', {
    currentRevision: identity.currentRevision,
    updatedAt: identity.updatedAt ?? null,
    updatedBy: identity.updatedBy ?? null
  })
}

function revisionValues(args: {
  documentKind: DocumentKind
  documentId: string
  schemaKey?: string | null
  revision: number
  action: DocumentRevisionAction
  state: RevisionSnapshot
  actorId?: string | null
  createdAt: Date
}) {
  return {
    id: newId(),
    documentKind: args.documentKind,
    documentId: args.documentId,
    schemaKey: args.schemaKey ?? null,
    revision: args.revision,
    action: args.action,
    status: args.state.status ?? null,
    title: args.state.title ?? null,
    schemaVersion: args.state.schemaVersion ?? null,
    snapshotJson: JSON.stringify(args.state.snapshot),
    createdBy: args.actorId ?? null,
    createdAt: args.createdAt
  }
}

function isRevisionRace(error: unknown) {
  const messages: string[] = []
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error ? current.message : String(current))
    current = typeof current === 'object' && current && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  const message = messages.join('\n')
  return message.includes('document_revision') && (
    message.includes('UNIQUE constraint failed') ||
    message.includes('idx_document_revision_unique')
  )
}

export async function createInitialDocumentRevision(args: {
  tx: Db
  statements?: any[]
  documentKind: DocumentKind
  documentId: string
  schemaKey?: string | null
  action?: 'create' | 'backfill'
  state: RevisionSnapshot
  actorId?: string | null
  createdAt: Date
}) {
  await executeDbStatement(args.tx.insert(documentRevision).values(revisionValues({
    ...args,
    action: args.action ?? 'create',
    revision: 1
  })), args.statements)
}

export async function mutateWithDocumentRevision<T>(args: {
  event: H3Event
  db: Db
  identity: RevisionIdentity
  expectedRevision: number
  documentKind: DocumentKind
  documentId: string
  schemaKey?: string | null
  action: DocumentRevisionAction
  state: RevisionSnapshot
  actorId?: string | null
  preserveOrdinarySaves?: boolean
  work: (tx: Db, statements: any[] | undefined, nextRevision: number, now: Date) => Promise<T>
}) {
  assertExpectedRevision(args.identity, args.expectedRevision)
  const nextRevision = args.expectedRevision + 1
  const now = new Date(Math.floor(Date.now() / 1000) * 1000)

  try {
    return await withDbTransaction(args.event, args.db, async (tx: Db, statements) => {
      // D1 batches cannot inspect an update's affected-row count before the
      // remaining statements run. Re-inserting the latest immutable history
      // row only when it is newer than expected turns staleness into a unique
      // constraint failure, which atomically rolls back the whole batch.
      const latestRevision = tx.select({ revision: max(documentRevision.revision) })
        .from(documentRevision)
        .where(and(
          eq(documentRevision.documentKind, args.documentKind),
          eq(documentRevision.documentId, args.documentId)
        ))
      const staleRevisionGuard = tx.select()
        .from(documentRevision)
        .where(and(
          eq(documentRevision.documentKind, args.documentKind),
          eq(documentRevision.documentId, args.documentId),
          eq(documentRevision.revision, latestRevision),
          ne(documentRevision.revision, args.expectedRevision)
        ))
        .limit(1)
      await executeDbStatement(tx.insert(documentRevision).select(staleRevisionGuard), statements)

      const result = await args.work(tx, statements, nextRevision, now)
      await executeDbStatement(tx.insert(documentRevision).values(revisionValues({
        documentKind: args.documentKind,
        documentId: args.documentId,
        schemaKey: args.schemaKey,
        revision: nextRevision,
        action: args.action,
        state: args.state,
        actorId: args.actorId,
        createdAt: now
      })), statements)

      if (!args.preserveOrdinarySaves) {
        const ordinarySavesToKeep = tx.select({ id: documentRevision.id })
          .from(documentRevision)
          .where(and(
            eq(documentRevision.documentKind, args.documentKind),
            eq(documentRevision.documentId, args.documentId),
            eq(documentRevision.action, 'save')
          ))
          .orderBy(desc(documentRevision.revision))
          .limit(DOCUMENT_REVISION_RETENTION_LIMIT)
        await executeDbStatement(tx.delete(documentRevision).where(and(
          eq(documentRevision.documentKind, args.documentKind),
          eq(documentRevision.documentId, args.documentId),
          eq(documentRevision.action, 'save'),
          notInArray(documentRevision.id, ordinarySavesToKeep)
        )), statements)
      }
      return result
    })
  } catch (error) {
    if (isRevisionRace(error)) {
      const latest = await getLatestDocumentRevision(args.db, args.documentKind, args.documentId)
      throw revisionConflict({
        currentRevision: latest?.revision ?? nextRevision,
        updatedAt: latest?.createdAt ?? now,
        updatedBy: latest?.createdBy ?? null
      })
    }
    throw error
  }
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, normalizeJson(item)]))
}

export type DocumentChange = { path: string, before: unknown, after: unknown }

export function diffDocumentSnapshots(before: unknown, after: unknown, path = '$'): DocumentChange[] {
  const left = normalizeJson(before)
  const right = normalizeJson(after)
  if (JSON.stringify(left) === JSON.stringify(right)) return []

  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: DocumentChange[] = []
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index++) {
      changes.push(...diffDocumentSnapshots(left[index], right[index], `${path}[${index}]`))
    }
    return changes
  }

  if (
    left && right &&
    typeof left === 'object' && typeof right === 'object' &&
    !Array.isArray(left) && !Array.isArray(right)
  ) {
    const changes: DocumentChange[] = []
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of [...keys].sort()) {
      changes.push(...diffDocumentSnapshots(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`
      ))
    }
    return changes
  }

  return [{ path, before: left, after: right }]
}

function parseRevision(row: any) {
  return { ...row, snapshot: JSON.parse(row.snapshotJson) }
}

export async function getLatestDocumentRevision(db: Db, documentKind: DocumentKind, documentId: string) {
  const row = await db.select().from(documentRevision).where(and(
    eq(documentRevision.documentKind, documentKind),
    eq(documentRevision.documentId, documentId)
  )).orderBy(desc(documentRevision.revision)).limit(1).get()
  return row ? parseRevision(row) : null
}

export async function getDocumentRevision(db: Db, documentKind: DocumentKind, documentId: string, revision: number) {
  const row = await db.select().from(documentRevision).where(and(
    eq(documentRevision.documentKind, documentKind),
    eq(documentRevision.documentId, documentId),
    eq(documentRevision.revision, revision)
  )).get()
  if (!row) throw notFound('Revision not found')
  return parseRevision(row)
}

export async function listDocumentRevisions(db: Db, documentKind: DocumentKind, documentId: string) {
  const rows = await db.select().from(documentRevision).where(and(
    eq(documentRevision.documentKind, documentKind),
    eq(documentRevision.documentId, documentId)
  )).orderBy(asc(documentRevision.revision))

  const parsed = rows.map(parseRevision)
  return {
    items: parsed.map((item: any, index: number) => ({
      revision: item.revision,
      action: item.action,
      status: item.status,
      title: item.title,
      schemaVersion: item.schemaVersion,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      snapshot: item.snapshot,
      changes: diffDocumentSnapshots(parsed[index - 1]?.snapshot, item.snapshot)
    })).reverse(),
    retentionLimit: DOCUMENT_REVISION_RETENTION_LIMIT
  }
}
