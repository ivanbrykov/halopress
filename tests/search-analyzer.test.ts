import { describe, expect, it, vi } from 'vitest'

import { KOREAN_SEARCH_TOKENIZER_GENERATION } from '@halopress/korean-search-tokenizer'

import type { KeywordSearchError } from '../shared/keyword-search'
import {
  analyzeKeywordSearchRequest,
  hasServerSearchAnalyzer
} from '../server/utils/search-analyzer'

const terms = {
  contractVersion: 1 as const,
  tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
  normalizedText: '방에 들어가',
  rawTerms: ['방에', '들어가'],
  morphTerms: ['방', '들어가']
}

function event(analyzer?: Record<string, unknown>) {
  return {
    context: {
      cloudflare: {
        env: analyzer ? { HALOPRESS_SEARCH_ANALYZER: analyzer } : {}
      }
    }
  } as any
}

describe('server keyword-search analyzer boundary', () => {
  it('uses only the same-script injected analyzer for raw requests', async () => {
    const analyzeQuery = vi.fn(async () => terms)
    const requestEvent = event({ analyzeQuery })

    await expect(hasServerSearchAnalyzer(requestEvent)).resolves.toBe(true)
    await expect(analyzeKeywordSearchRequest(requestEvent, {
      mode: 'raw',
      contractVersion: 1,
      query: '방에 들어가',
      operator: 'all',
      schemaKeys: ['article'],
      fieldIds: [],
      filters: [],
      limit: 20,
      cursor: null
    })).resolves.toEqual(terms)
    expect(analyzeQuery).toHaveBeenCalledWith('방에 들어가')
  })

  it('returns a typed retryable error instead of false empty terms', async () => {
    for (const requestEvent of [
      event(),
      event({ analyzeQuery: vi.fn(async () => { throw new Error('DO unavailable') }) })
    ]) {
      await expect(analyzeKeywordSearchRequest(requestEvent, {
        mode: 'raw',
        contractVersion: 1,
        query: '방에 들어가',
        operator: 'all',
        schemaKeys: ['article'],
        fieldIds: [],
        filters: [],
        limit: 20,
        cursor: null
      })).rejects.toMatchObject<Partial<KeywordSearchError>>({
        code: 'analyzer_unavailable',
        status: 503,
        retryable: true
      })
    }
  })
})
