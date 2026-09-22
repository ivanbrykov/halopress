import {
  NodeSearchAnalyzerExecutor
} from './node-analyzer-executor'
import { NodeSearchJobRunner } from './node-job-runner'
import { getNodeSqliteSearchStore } from './sqlite-store'

class NodeSearchRuntime {
  readonly analyzer = new NodeSearchAnalyzerExecutor(32)
  private runner: NodeSearchJobRunner | null = null
  private starting: Promise<void> | null = null

  async start() {
    if (this.starting) {
      await this.starting
      return
    }
    this.starting = Promise.all([
      this.analyzer.start(),
      getNodeSqliteSearchStore().then((store) => {
        if (!this.runner) {
          this.runner = new NodeSearchJobRunner(store, this.analyzer)
          this.runner.start()
        }
      })
    ]).then(() => {}).finally(() => {
      this.starting = null
    })
    await this.starting
  }

  nudge() {
    if (this.runner) this.runner.nudge()
    else void this.start().catch(() => {})
  }

  health() {
    return {
      topology: 'node-worker-thread-sqlite' as const,
      analyzer: this.analyzer.availability(),
      runner: this.runner?.health() ?? null
    }
  }

  async stop() {
    await this.runner?.stop()
    await this.analyzer.stop()
  }
}

let runtime: NodeSearchRuntime | null = null

export function getNodeSearchRuntime() {
  runtime ??= new NodeSearchRuntime()
  return runtime
}

export async function startNodeSearchRuntime() {
  const current = getNodeSearchRuntime()
  await current.start()
  return current
}

export function nudgeNodeSearchRuntime() {
  getNodeSearchRuntime().nudge()
}

export async function stopNodeSearchRuntime() {
  if (!runtime) return
  const current = runtime
  runtime = null
  await current.stop()
}
