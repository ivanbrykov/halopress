// Nuxt generates this module before Wrangler bundles the code-owned entry wrapper.
// @ts-expect-error generated Cloudflare module output has no declaration file
import nitroHandler from '../../../.output/server/index.mjs'

import { SEARCH_ANALYZER_BINDING } from '../../../shared/search-analyzer'
import {
  AnalyzerDurableObject
} from './durable-analyzer'
import {
  createDurableSearchAnalyzer,
  DURABLE_ANALYZER_DESCRIPTOR
} from './durable-analyzer-client'
import {
  handleSearchQueue,
  scheduleSearchReconciliation
} from './orchestration'
import type {
  ExecutionContext,
  MessageBatch,
  SearchQueueMessage,
  SearchWorkerEnv
} from './types'

type DurableAnalyzerNamespace = Parameters<typeof createDurableSearchAnalyzer>[0]

type DurableSearchEnv = SearchWorkerEnv & {
  SEARCH_ANALYZER_DO: DurableAnalyzerNamespace
}

type NitroHandler = {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response>
  queue?(batch: MessageBatch<unknown>, env: Record<string, unknown>, ctx: ExecutionContext): void
  scheduled?(controller: unknown, env: Record<string, unknown>, ctx: ExecutionContext): void
}

const generatedHandler = nitroHandler as NitroHandler
let topologyLogged = false
const ANALYZER_HEALTH_PATH = '/__halopress/search/analyzer-health'

function analyzerFor(env: DurableSearchEnv) {
  return createDurableSearchAnalyzer(env.SEARCH_ANALYZER_DO)
}

export { AnalyzerDurableObject }

export default {
  async fetch(request: Request, env: DurableSearchEnv, ctx: ExecutionContext) {
    const analyzer = analyzerFor(env)
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === ANALYZER_HEALTH_PATH) {
      try {
        const startedAt = performance.now()
        const [compatibility, query] = await Promise.all([
          analyzer.compatibility(),
          analyzer.analyzeQuery('방에 들어가')
        ])
        return Response.json({
          ok: true,
          topology: 'durable-object',
          compatibility,
          query,
          elapsedMs: Number((performance.now() - startedAt).toFixed(3))
        }, {
          headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          }
        })
      } catch (error) {
        return Response.json({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' }
        })
      }
    }
    const nitroEnv = Object.assign({}, env, {
      [SEARCH_ANALYZER_BINDING]: analyzer
    }) as Record<string, unknown>
    if (!topologyLogged) {
      topologyLogged = true
      console.log(JSON.stringify({
        event: 'halopress.search.topology',
        topology: 'durable-object',
        artifactVersionId: DURABLE_ANALYZER_DESCRIPTOR.artifactVersionId,
        objectName: DURABLE_ANALYZER_DESCRIPTOR.objectName,
        tokenizerGeneration: DURABLE_ANALYZER_DESCRIPTOR.tokenizerGeneration
      }))
    }
    return generatedHandler.fetch(request, nitroEnv, ctx)
  },

  async queue(
    batch: MessageBatch<SearchQueueMessage>,
    env: DurableSearchEnv,
    ctx: ExecutionContext
  ) {
    generatedHandler.queue?.(
      batch as MessageBatch<unknown>,
      env as unknown as Record<string, unknown>,
      ctx
    )
    const analyzer = analyzerFor(env)
    await handleSearchQueue(batch, env, async () => analyzer)
  },

  scheduled(controller: unknown, env: DurableSearchEnv, ctx: ExecutionContext) {
    generatedHandler.scheduled?.(
      controller,
      env as unknown as Record<string, unknown>,
      ctx
    )
    scheduleSearchReconciliation(env, ctx)
  }
}
