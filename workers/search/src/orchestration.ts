import {
  processFullTextJob,
  type DocumentAnalyzer
} from './indexer'
import { pendingJobIds } from './repository'
import type {
  ExecutionContext,
  MessageBatch,
  SearchQueueMessage,
  SearchWorkerEnv
} from './types'

function eventLog(event: string, detail: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...detail }))
}

export async function dispatchPendingSearchJobs(env: SearchWorkerEnv) {
  const ids = await pendingJobIds(env.DB)
  if (!ids.length) return 0
  await env.SEARCH_INDEX_QUEUE.sendBatch(ids.map(jobId => ({
    body: { kind: 'job' as const, jobId }
  })))
  eventLog('halopress.search.reconcile', {
    outcome: 'dispatched',
    dispatchedJobs: ids.length
  })
  return ids.length
}

export async function handleSearchQueue(
  batch: MessageBatch<SearchQueueMessage>,
  env: SearchWorkerEnv,
  analyzer: () => Promise<DocumentAnalyzer>
) {
  for (const message of batch.messages) {
    if (message.body.kind === 'reconcile') {
      await dispatchPendingSearchJobs(env)
      message.ack()
      continue
    }
    const startedAt = performance.now()
    const result = await processFullTextJob({
      store: env.DB,
      jobId: message.body.jobId,
      analyzer
    })
    if (result.dispatchIds.length) {
      await env.SEARCH_INDEX_QUEUE.sendBatch(result.dispatchIds.map(jobId => ({
        body: { kind: 'job' as const, jobId }
      })))
    }
    if (result.outcome === 'retry') {
      message.retry({ delaySeconds: result.delaySeconds })
    } else {
      message.ack()
    }
    eventLog('halopress.search.queue_job', {
      jobId: message.body.jobId,
      outcome: result.outcome,
      elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
      dispatchedJobs: result.dispatchIds.length
    })
  }
}

export function scheduleSearchReconciliation(
  env: SearchWorkerEnv,
  ctx: ExecutionContext
) {
  ctx.waitUntil(dispatchPendingSearchJobs(env))
}
