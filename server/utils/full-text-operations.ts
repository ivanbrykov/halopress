import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { KOREAN_SEARCH_TOKENIZER_GENERATION } from '@halopress/korean-search-tokenizer'

import { enqueueSchemaFullTextReindex } from '../cms/full-text-jobs'
import type { Db } from '../db/db'
import {
  fullTextControl,
  fullTextIndexState,
  fullTextJob,
  searchConfig
} from '../db/schema'
import { newId } from './ids'

const JOB_STATUSES = ['pending', 'processing', 'failed', 'ready', 'stale'] as const
const INDEX_STATUSES = ['pending', 'building', 'failed', 'ready', 'stale'] as const

function emptyCounts<T extends readonly string[]>(statuses: T) {
  return Object.fromEntries(statuses.map(status => [status, 0])) as Record<T[number], number>
}

export async function getFullTextOperationsStatus(db: Db) {
  const [control, jobRows, stateRows, latestError] = await Promise.all([
    db.select().from(fullTextControl).where(eq(fullTextControl.key, 'singleton')).get(),
    db.select({
      status: fullTextJob.status,
      count: sql<number>`count(1)`
    }).from(fullTextJob).groupBy(fullTextJob.status),
    db.select({
      status: fullTextIndexState.status,
      count: sql<number>`count(1)`,
      indexedChunks: sql<number>`coalesce(sum(${fullTextIndexState.indexedChunks}), 0)`,
      totalChunks: sql<number>`coalesce(sum(${fullTextIndexState.totalChunks}), 0)`
    }).from(fullTextIndexState).groupBy(fullTextIndexState.status),
    db.select({
      jobId: fullTextJob.id,
      error: fullTextJob.lastError,
      updatedAt: fullTextJob.updatedAt
    }).from(fullTextJob)
      .where(sql`${fullTextJob.lastError} is not null`)
      .orderBy(desc(fullTextJob.updatedAt))
      .limit(1)
      .get()
  ])

  const jobs = emptyCounts(JOB_STATUSES)
  for (const row of jobRows) {
    if (row.status in jobs) jobs[row.status as keyof typeof jobs] = Number(row.count)
  }
  const indexes = emptyCounts(INDEX_STATUSES)
  let indexedChunks = 0
  let totalChunks = 0
  for (const row of stateRows) {
    if (row.status in indexes) indexes[row.status as keyof typeof indexes] = Number(row.count)
    indexedChunks += Number(row.indexedChunks)
    totalChunks += Number(row.totalChunks)
  }

  return {
    available: control?.status === 'available',
    tokenizerGeneration: control?.tokenizerGeneration ?? KOREAN_SEARCH_TOKENIZER_GENERATION,
    queryEpoch: control?.queryEpoch ?? null,
    jobs,
    indexes,
    progress: { indexedChunks, totalChunks },
    latestError: latestError?.error
      ? {
          jobId: latestError.jobId,
          message: latestError.error,
          updatedAt: latestError.updatedAt
        }
      : null
  }
}

export async function retryFailedFullTextJobs(db: Db, now = new Date()) {
  const failed = await db.select({ id: fullTextJob.id })
    .from(fullTextJob)
    .where(eq(fullTextJob.status, 'failed'))
  if (!failed.length) return { retried: 0 }
  const ids = failed.map((row: { id: string }) => row.id)
  await db.update(fullTextJob).set({
    status: 'pending',
    availableAt: now,
    leaseExpiresAt: null,
    completedAt: null,
    updatedAt: now
  }).where(inArray(fullTextJob.id, ids))
  await db.update(fullTextIndexState).set({
    status: 'pending',
    updatedAt: now
  }).where(and(
    eq(fullTextIndexState.status, 'failed'),
    sql`${fullTextIndexState.buildingIndexGeneration} is not null`
  ))
  return { retried: ids.length }
}

export async function enqueueFullTextReindex(db: Db, now = new Date()) {
  const schemas = await db.selectDistinct({ schemaKey: searchConfig.schemaKey })
    .from(searchConfig)
    .where(eq(searchConfig.fullText, true))
  const requestId = newId()
  for (const row of schemas) {
    await enqueueSchemaFullTextReindex({
      db,
      schemaKey: row.schemaKey,
      requestId,
      now
    })
  }
  return { enqueuedSchemas: schemas.length, requestId }
}
