import {
  KOREAN_SEARCH_CONTRACT_VERSION,
  KOREAN_SEARCH_ENGINE_VERSION,
  KOREAN_SEARCH_MODEL_SHA256,
  KOREAN_SEARCH_PROFILE_VERSION,
  KOREAN_SEARCH_TOKENIZER_GENERATION,
  MAX_DOCUMENT_CHUNK_BYTES,
  MAX_QUERY_BYTES,
  MAX_TERM_BYTES,
  type KoreanSearchTerms,
  type KoreanSearchTokenizerMetadata
} from '@halopress/korean-search-tokenizer'

import {
  SEARCH_ANALYZER_CONTRACT_VERSION,
  SEARCH_ANALYZER_MAX_BATCH_ITEMS,
  type SearchAnalyzer,
  type SearchAnalyzerBatchRequest,
  type SearchAnalyzerBatchResponse
} from '../../shared/search-analyzer'
import {
  SEARCH_ANALYZER_ARTIFACT_VERSION_ID
} from '../../shared/search-analyzer-artifact'
import { NODE_ANALYZER_WORKER_SOURCE } from './node-analyzer-worker-source'

type WorkerLike = {
  on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): void
  postMessage(value: unknown): void
  terminate(): Promise<number>
  unref(): void
}

type PendingCall = {
  resolve(value: any): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export type NodeAnalyzerMetrics = {
  initializedAt: number
  initializationMs: number
  modelBytes: number
  rssBytes: number
  lastCallMs?: number
}

export type NodeAnalyzerAvailability = {
  status: 'initializing' | 'available' | 'unavailable' | 'stopped'
  retryable: boolean
  error: string | null
  pendingCalls: number
  maxPendingCalls: number
  metrics: NodeAnalyzerMetrics | null
}

const metadata: KoreanSearchTokenizerMetadata = {
  contractVersion: KOREAN_SEARCH_CONTRACT_VERSION,
  tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
  engineVersion: KOREAN_SEARCH_ENGINE_VERSION,
  modelVersion: '0.9.11',
  modelSha256: KOREAN_SEARCH_MODEL_SHA256,
  profileVersion: KOREAN_SEARCH_PROFILE_VERSION,
  normalization: 'NFC'
}

function retryableError(message: string) {
  const error = new Error(message)
  error.name = 'RetryableSearchAnalyzerError'
  return error
}

export class NodeSearchAnalyzerExecutor implements SearchAnalyzer {
  private worker: WorkerLike | null = null
  private starting: Promise<void> | null = null
  private pending = new Map<number, PendingCall>()
  private nextCallId = 1
  private closed = false
  private runtimeStatus: NodeAnalyzerAvailability['status'] = 'initializing'
  private lastError: string | null = null
  private runtimeMetrics: NodeAnalyzerMetrics | null = null

  constructor(
    private readonly maxPendingCalls = 32,
    private readonly callTimeoutMs = 30_000
  ) {}

  availability(): NodeAnalyzerAvailability {
    return {
      status: this.runtimeStatus,
      retryable: this.runtimeStatus !== 'stopped',
      error: this.lastError,
      pendingCalls: this.pending.size,
      maxPendingCalls: this.maxPendingCalls,
      metrics: this.runtimeMetrics
    }
  }

  async start() {
    await this.ensureStarted()
    return this.availability()
  }

  private async ensureStarted() {
    if (this.closed) throw retryableError('Node search analyzer is stopped')
    if (this.worker && this.runtimeStatus === 'available') return
    if (this.starting) return await this.starting

    this.runtimeStatus = 'initializing'
    this.lastError = null
    this.starting = new Promise<void>((resolve, reject) => {
      void (async () => {
        try {
        const moduleName = ['node', 'worker_threads'].join(':')
        const nodeModuleName = ['node', 'module'].join(':')
        const { Worker } = await import(moduleName) as {
          Worker: new (
            source: string,
            options: { eval: boolean; workerData: Record<string, unknown> }
          ) => WorkerLike
        }
        const { createRequire } = await import(nodeModuleName) as {
          createRequire(url: string): {
            resolve(specifier: string): string
          }
        }
        const garuModule = createRequire(import.meta.url).resolve('garu-ko')
        const worker = new Worker(NODE_ANALYZER_WORKER_SOURCE, {
          eval: true,
          workerData: {
            artifactVersionId: SEARCH_ANALYZER_ARTIFACT_VERSION_ID,
            garuModule,
            metadata,
            maxBatchItems: SEARCH_ANALYZER_MAX_BATCH_ITEMS,
            maxDocumentBytes: MAX_DOCUMENT_CHUNK_BYTES,
            maxQueryBytes: MAX_QUERY_BYTES,
            maxTermBytes: MAX_TERM_BYTES
          }
        })
        this.worker = worker
        worker.unref()
        let settled = false
        let restartAfterExit = true
        worker.on('message', (message: any) => {
          if (message?.kind === 'ready') {
            settled = true
            this.runtimeMetrics = message.metrics
            this.runtimeStatus = 'available'
            resolve()
            return
          }
          if (message?.kind === 'initialization-error') {
            const error = retryableError(message.error || 'Node analyzer initialization failed')
            settled = true
            restartAfterExit = false
            this.handleWorkerFailure(error)
            reject(error)
            return
          }
          const call = this.pending.get(message?.id)
          if (!call) return
          clearTimeout(call.timer)
          this.pending.delete(message.id)
          if (this.runtimeMetrics) {
            this.runtimeMetrics.lastCallMs = message.elapsedMs
            if (typeof message.rssBytes === 'number') {
              this.runtimeMetrics.rssBytes = message.rssBytes
            }
          }
          if (message.kind === 'result') call.resolve(message.value)
          else call.reject(retryableError(message.error || 'Node analyzer call failed'))
        })
        worker.on('error', (error: Error) => {
          this.handleWorkerFailure(error)
          if (!settled) reject(error)
        })
        worker.on('exit', (code: number) => {
          if (this.closed) return
          if (!restartAfterExit) return
          const error = retryableError(`Node search analyzer exited with code ${code}`)
          this.handleWorkerFailure(error)
          if (!settled) reject(error)
          const timer = setTimeout(() => {
            if (!this.closed) void this.ensureStarted().catch(() => {})
          }, 100)
          timer.unref()
        })
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error))
          this.handleWorkerFailure(normalized)
          reject(normalized)
        }
      })()
    }).finally(() => {
      this.starting = null
    })
    return await this.starting
  }

  private handleWorkerFailure(error: Error) {
    this.worker = null
    this.runtimeStatus = this.closed ? 'stopped' : 'unavailable'
    this.lastError = error.message
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(retryableError(error.message))
    }
    this.pending.clear()
  }

  private async call<T>(operation: string, value?: unknown): Promise<T> {
    await this.ensureStarted()
    if (!this.worker) throw retryableError('Node search analyzer is unavailable')
    if (this.pending.size >= this.maxPendingCalls) {
      throw retryableError('Node search analyzer pending-call limit reached')
    }
    const id = this.nextCallId++
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(retryableError(`Node search analyzer ${operation} timed out`))
      }, this.callTimeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ id, operation, value })
    })
  }

  async metadata() {
    return await this.call<KoreanSearchTokenizerMetadata>('metadata')
  }

  async compatibility() {
    await this.ensureStarted()
    return {
      analyzerContractVersion: SEARCH_ANALYZER_CONTRACT_VERSION,
      artifactVersionId: SEARCH_ANALYZER_ARTIFACT_VERSION_ID,
      tokenizer: metadata
    }
  }

  async analyzeQuery(input: string) {
    return await this.call<KoreanSearchTerms>('analyzeQuery', input)
  }

  async analyzeBatch(request: SearchAnalyzerBatchRequest) {
    return await this.call<SearchAnalyzerBatchResponse>('analyzeBatch', request)
  }

  async crashForTests() {
    await this.ensureStarted()
    const worker = this.worker
    if (!worker) return
    const exited = new Promise<void>((resolve) => {
      worker.on('exit', () => resolve())
    })
    worker.postMessage({ operation: '__crash_for_tests__' })
    await exited
  }

  async stop() {
    this.closed = true
    const worker = this.worker
    this.handleWorkerFailure(retryableError('Node search analyzer stopped'))
    if (worker) await worker.terminate()
    this.runtimeStatus = 'stopped'
  }
}
