import { describe, expect, it } from 'vitest'

import {
  KOREAN_SEARCH_TOKENIZER_GENERATION,
  MAX_DOCUMENT_CHUNK_BYTES,
  type KoreanSearchTokenizer
} from '@halopress/korean-search-tokenizer'

import { analyzeSearchBatch } from '../src/analyzer-batch'

function tokenizer(): KoreanSearchTokenizer {
  const metadata = {
    contractVersion: 1 as const,
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    engineVersion: 'garu-ko@0.9.11' as const,
    modelVersion: '0.9.11',
    modelSha256: '5186b7ccf18bd1544523f408f1b7aa2a14b09b1c2d27ce96185afd49aa08e741' as const,
    profileVersion: 1 as const,
    normalization: 'NFC' as const
  }
  return {
    metadata,
    analyzeDocument(input) {
      if (input === 'explode') throw new Error('synthetic analyzer failure')
      return {
        contractVersion: 1,
        tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
        normalizedText: input,
        rawTerms: [input],
        morphTerms: [input]
      }
    },
    analyzeQuery(input) {
      return this.analyzeDocument(input)
    },
    destroy() {}
  }
}

describe('Durable analyzer batch contract', () => {
  it('preserves batch and item identity, order, and tokenizer generation', () => {
    const response = analyzeSearchBatch(tokenizer(), {
      batchId: 'job-1:0',
      items: [
        { id: 'job-1:0', input: '아버지가 방에 들어가신다.' },
        { id: 'job-1:1', input: '어머니가 방에 들어가신다.' },
        { id: 'job-1:2', input: '방에 들어가' }
      ]
    })

    expect(response.batchId).toBe('job-1:0')
    expect(response.tokenizerGeneration).toBe(KOREAN_SEARCH_TOKENIZER_GENERATION)
    expect(response.items.map(item => item.id)).toEqual([
      'job-1:0',
      'job-1:1',
      'job-1:2'
    ])
    expect(response.items.every(item => item.ok)).toBe(true)
  })

  it('reports oversized and analyzer failures per item without dropping siblings', () => {
    const response = analyzeSearchBatch(tokenizer(), {
      batchId: 'mixed',
      items: [
        { id: 'valid', input: '방에 들어가' },
        { id: 'oversized', input: '가'.repeat(MAX_DOCUMENT_CHUNK_BYTES) },
        { id: 'failure', input: 'explode' }
      ]
    })

    expect(response.items[0]).toMatchObject({ id: 'valid', ok: true })
    expect(response.items[1]).toMatchObject({
      id: 'oversized',
      ok: false,
      error: { code: 'invalid_input', retryable: false }
    })
    expect(response.items[2]).toMatchObject({
      id: 'failure',
      ok: false,
      error: { code: 'analysis_failed', retryable: true }
    })
  })

  it('rejects ambiguous or unbounded batch envelopes', () => {
    expect(() => analyzeSearchBatch(tokenizer(), {
      batchId: 'duplicates',
      items: [
        { id: 'same', input: 'one' },
        { id: 'same', input: 'two' }
      ]
    })).toThrow('Duplicate analyzer item ID')
    expect(() => analyzeSearchBatch(tokenizer(), {
      batchId: 'too-many',
      items: Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        input: 'value'
      }))
    })).toThrow('1-4 items')
  })
})
