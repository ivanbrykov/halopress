import {
  splitTokenizerChunks,
  type KoreanSearchTerms
} from '@halopress/korean-search-tokenizer'
import { extractSearchPlainText } from '@halopress/korean-search-tokenizer/plain-text'
import type {
  SearchAnalyzerBatchRequest,
  SearchAnalyzerBatchResponse
} from '../../../shared/search-analyzer'
import type { SearchStore } from '../../../shared/search-store'

import {
  activateIndexGeneration,
  claimFullTextJob,
  initializeIndexBuild,
  loadIndexTarget,
  markJobFailed,
  markJobRetry,
  markJobStale,
  reconcileSchemaJobs,
  removeContentIndex,
  storeAnalyzedChunk,
  targetStillEligible
} from './repository'

const ANALYZER_BATCH_SIZE = 4

class AnalyzerItemError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

export type DocumentAnalyzer = {
  analyzeDocument?(input: string): KoreanSearchTerms | Promise<KoreanSearchTerms>
  analyzeBatch?(request: SearchAnalyzerBatchRequest): Promise<SearchAnalyzerBatchResponse>
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function sourceText(args: {
  contentJson: string
  registryJson: string
  fieldId: string
}) {
  const registry = parseRecord(args.registryJson)
  const fields = Array.isArray(registry.fields) ? registry.fields : []
  const field = fields.find((candidate) => {
    return candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).fieldId === args.fieldId
  }) as Record<string, unknown> | undefined
  if (!field || typeof field.key !== 'string') return null

  const content = parseRecord(args.contentJson)
  const value = content[field.key]
  if (field.kind === 'richtext') return extractSearchPlainText(value).text
  if (field.kind === 'string' || field.kind === 'text') {
    return typeof value === 'string' ? value : ''
  }
  return null
}

export async function processFullTextJob(args: {
  store: SearchStore
  jobId: string
  analyzer: () => Promise<DocumentAnalyzer>
}) {
  const job = await claimFullTextJob(args.store, args.jobId)
  if (!job) return { outcome: 'not-claimed' as const, dispatchIds: [] as string[] }

  try {
    if (job.operation === 'remove') {
      const outcome = await removeContentIndex(args.store, job)
      return { outcome, dispatchIds: [] as string[] }
    }
    if (job.operation === 'schema-sync' || job.operation === 'reindex-sync') {
      const dispatchIds = await reconcileSchemaJobs(args.store, job)
      return { outcome: 'reconciled' as const, dispatchIds }
    }
    if (job.operation !== 'index' && job.operation !== 'reindex') {
      await markJobStale(args.store, job, `Unsupported operation: ${job.operation}`)
      return { outcome: 'stale' as const, dispatchIds: [] as string[] }
    }

    const target = await loadIndexTarget(args.store, job)
    if (!target
      || target.current_status !== 'published'
      || target.current_revision_id !== job.target_revision_id
      || target.full_text !== 1) {
      await markJobStale(args.store, job, 'Publication or field eligibility changed')
      return { outcome: 'stale' as const, dispatchIds: [] as string[] }
    }
    const text = sourceText({
      contentJson: target.content_json,
      registryJson: target.registry_json,
      fieldId: job.field_id
    })
    if (text === null) {
      await markJobStale(args.store, job, 'Published field contract is unavailable')
      return { outcome: 'stale' as const, dispatchIds: [] as string[] }
    }

    const chunks = splitTokenizerChunks(text)
    await initializeIndexBuild(args.store, job, target, chunks.length)
    const analyzer = await args.analyzer()
    for (let index = job.checkpoint; index < chunks.length; index += ANALYZER_BATCH_SIZE) {
      const batch = chunks.slice(index, index + ANALYZER_BATCH_SIZE)
      const batchId = `${job.id}:${index}`
      const requestedItems = batch.map((input, offset) => ({
        id: `${job.id}:${index + offset}`,
        input
      }))
      let analyzed: SearchAnalyzerBatchResponse
      if (typeof analyzer.analyzeBatch === 'function') {
        analyzed = await analyzer.analyzeBatch({ batchId, items: requestedItems })
      } else if (typeof analyzer.analyzeDocument === 'function') {
        analyzed = {
          batchId,
          tokenizerGeneration: job.tokenizer_generation,
          items: await Promise.all(batch.map(async (input, offset) => ({
            id: requestedItems[offset]!.id,
            ok: true as const,
            terms: await analyzer.analyzeDocument!(input)
          })))
        }
      } else {
        throw new TypeError('Analyzer does not implement batch or document analysis')
      }
      if (analyzed.batchId !== batchId
        || analyzed.tokenizerGeneration !== job.tokenizer_generation
        || analyzed.items.length !== requestedItems.length) {
        throw new Error('Analyzer batch response does not match the indexing job')
      }
      for (let offset = 0; offset < analyzed.items.length; offset += 1) {
        const result = analyzed.items[offset]!
        if (result.id !== requestedItems[offset]!.id) {
          throw new Error('Analyzer batch item identity or order changed')
        }
        if (!result.ok) {
          throw new AnalyzerItemError(
            `Analyzer item ${result.id} failed (${result.error.code}): ${result.error.message}`,
            result.error.retryable
          )
        }
        const terms = result.terms
        if (terms.tokenizerGeneration !== job.tokenizer_generation) {
          throw new Error('Analyzer item tokenizer generation changed')
        }
        await storeAnalyzedChunk({
          db: args.store,
          job,
          target,
          chunkIndex: index + offset,
          totalChunks: chunks.length,
          rawText: terms.rawTerms.join(' '),
          morphText: terms.morphTerms.join(' ')
        })
      }
    }

    if (!await targetStillEligible(args.store, job)) {
      await markJobStale(args.store, job, 'Publication changed before activation')
      return { outcome: 'stale' as const, dispatchIds: [] as string[] }
    }
    await activateIndexGeneration(args.store, job, target, chunks.length)
    return { outcome: 'ready' as const, dispatchIds: [] as string[] }
  } catch (error) {
    if (error instanceof AnalyzerItemError && !error.retryable) {
      await markJobFailed(args.store, job, error)
      return {
        outcome: 'failed' as const,
        dispatchIds: [] as string[]
      }
    }
    const retry = await markJobRetry(args.store, job, error)
    return {
      outcome: retry.terminal ? 'failed' as const : 'retry' as const,
      dispatchIds: [] as string[],
      delaySeconds: retry.delay
    }
  }
}
