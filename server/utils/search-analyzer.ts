import type { H3Event } from 'h3'

import type {
  SearchAnalyzerRuntimeEnv
} from '../../shared/search-analyzer'
import {
  KeywordSearchError,
  type KeywordSearchRawRequest
} from '../../shared/keyword-search'

function runtimeEnv(event: H3Event) {
  return ((event as any)?.context?.cloudflare?.env ?? {}) as SearchAnalyzerRuntimeEnv
}

export type ServerSearchAnalyzerAvailability = {
  status: 'initializing' | 'available' | 'unavailable'
  retryable: boolean
}

export async function getServerSearchAnalyzerAvailability(
  event: H3Event
): Promise<ServerSearchAnalyzerAvailability> {
  const env = runtimeEnv(event)
  if (env.HALOPRESS_SEARCH_ANALYZER) {
    return { status: 'available', retryable: false }
  }
  if ((event as any)?.context?.cloudflare) {
    return { status: 'unavailable', retryable: true }
  }
  const module = await import('../search/node-runtime')
  const runtime = module.getNodeSearchRuntime()
  const current = runtime.analyzer.availability()
  if (current.status !== 'available') void runtime.start().catch(() => {})
  return {
    status: current.status === 'stopped' ? 'unavailable' : current.status,
    retryable: true
  }
}

export async function hasServerSearchAnalyzer(event: H3Event) {
  return (await getServerSearchAnalyzerAvailability(event)).status === 'available'
}

export async function analyzeKeywordSearchRequest(
  event: H3Event,
  raw: KeywordSearchRawRequest
) {
  const env = runtimeEnv(event)
  if (env.HALOPRESS_SEARCH_ANALYZER) {
    try {
      return await env.HALOPRESS_SEARCH_ANALYZER.analyzeQuery(raw.query)
    } catch {
      throw new KeywordSearchError(
        'analyzer_unavailable',
        'Search analyzer is unavailable',
        503,
        true
      )
    }
  }
  if (!(event as any)?.context?.cloudflare) {
    try {
      const { getNodeSearchRuntime } = await import('../search/node-runtime')
      const runtime = getNodeSearchRuntime()
      await runtime.analyzer.start()
      return await runtime.analyzer.analyzeQuery(raw.query)
    } catch {
      throw new KeywordSearchError(
        'analyzer_unavailable',
        'Search analyzer is unavailable',
        503,
        true
      )
    }
  }
  throw new KeywordSearchError(
    'analyzer_unavailable',
    'Search analyzer is unavailable',
    503,
    true
  )
}
