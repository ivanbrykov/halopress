import type { SearchAnalyzer } from '../../shared/search-analyzer'
import type { SearchStore } from '../../shared/search-store'
import { processFullTextJob } from '../../workers/search/src/indexer'
import { pendingJobIds } from '../../workers/search/src/repository'

export type NodeSearchRunnerHealth = {
  status: 'idle' | 'running' | 'stopped' | 'unavailable'
  pollIntervalMs: number
  lastCycleAt: number | null
  lastCycleMs: number | null
  lastProcessedJobs: number
  lastError: string | null
}

export async function runSearchJobCycle(args: {
  store: SearchStore
  analyzer: SearchAnalyzer
  maxJobs?: number
}) {
  const maxJobs = Math.max(1, Math.min(args.maxJobs ?? 4, 50))
  const queued = await pendingJobIds(args.store, maxJobs)
  const seen = new Set<string>()
  let processed = 0
  while (queued.length && processed < maxJobs) {
    const jobId = queued.shift()!
    if (seen.has(jobId)) continue
    seen.add(jobId)
    const result = await processFullTextJob({
      store: args.store,
      jobId,
      analyzer: async () => args.analyzer
    })
    processed += 1
    for (const dispatchId of result.dispatchIds) {
      if (!seen.has(dispatchId) && queued.length + processed < maxJobs) {
        queued.push(dispatchId)
      }
    }
  }
  return processed
}

export class NodeSearchJobRunner {
  private timer: ReturnType<typeof setTimeout> | null = null
  private currentCycle: Promise<void> | null = null
  private stopped = true
  private healthState: NodeSearchRunnerHealth

  constructor(
    private readonly store: SearchStore & { validateSchema?(): void },
    private readonly analyzer: SearchAnalyzer,
    private readonly pollIntervalMs = 1_000,
    private readonly maxJobsPerCycle = 4
  ) {
    this.healthState = {
      status: 'stopped',
      pollIntervalMs,
      lastCycleAt: null,
      lastCycleMs: null,
      lastProcessedJobs: 0,
      lastError: null
    }
  }

  health() {
    return { ...this.healthState }
  }

  start() {
    if (!this.stopped) return
    this.store.validateSchema?.()
    this.stopped = false
    this.healthState.status = 'idle'
    this.schedule(0)
  }

  nudge() {
    if (this.stopped) this.start()
    if (!this.currentCycle) this.schedule(0)
  }

  private schedule(delay: number) {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.cycle()
    }, delay)
    this.timer.unref()
  }

  private async cycle() {
    if (this.stopped || this.currentCycle) return
    const startedAt = performance.now()
    this.healthState.status = 'running'
    this.currentCycle = runSearchJobCycle({
      store: this.store,
      analyzer: this.analyzer,
      maxJobs: this.maxJobsPerCycle
    }).then((processed) => {
      this.healthState.lastProcessedJobs = processed
      this.healthState.lastError = null
    }).catch((error) => {
      this.healthState.status = 'unavailable'
      this.healthState.lastError = error instanceof Error ? error.message : String(error)
    }).finally(() => {
      this.healthState.lastCycleAt = Date.now()
      this.healthState.lastCycleMs = Number((performance.now() - startedAt).toFixed(3))
      this.currentCycle = null
      if (!this.stopped) {
        if (this.healthState.status !== 'unavailable') this.healthState.status = 'idle'
        this.schedule(this.pollIntervalMs)
      }
    })
    await this.currentCycle
  }

  async stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.currentCycle
    this.healthState.status = 'stopped'
  }
}
