import {
  MAX_DOCUMENT_CHUNK_BYTES,
  type KoreanSearchTokenizer
} from '@halopress/korean-search-tokenizer'

import {
  SEARCH_ANALYZER_MAX_BATCH_ITEMS,
  type SearchAnalyzerBatchRequest,
  type SearchAnalyzerBatchResponse,
  type SearchAnalyzerBatchResult
} from '../../../shared/search-analyzer'

const MAX_ID_BYTES = 160
const encoder = new TextEncoder()

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== 'string'
    || !value
    || encoder.encode(value).byteLength > MAX_ID_BYTES) {
    throw new TypeError(`${label} must be a non-empty string of at most ${MAX_ID_BYTES} UTF-8 bytes`)
  }
}

export function analyzeSearchBatch(
  tokenizer: KoreanSearchTokenizer,
  request: SearchAnalyzerBatchRequest
): SearchAnalyzerBatchResponse {
  assertIdentifier(request?.batchId, 'Analyzer batch ID')
  if (!Array.isArray(request?.items)
    || request.items.length < 1
    || request.items.length > SEARCH_ANALYZER_MAX_BATCH_ITEMS) {
    throw new RangeError(
      `Analyzer batch must contain 1-${SEARCH_ANALYZER_MAX_BATCH_ITEMS} items`
    )
  }
  const seen = new Set<string>()
  for (const item of request.items) {
    assertIdentifier(item?.id, 'Analyzer item ID')
    if (seen.has(item.id)) throw new TypeError(`Duplicate analyzer item ID: ${item.id}`)
    seen.add(item.id)
  }

  const items: SearchAnalyzerBatchResult[] = request.items.map((item) => {
    if (typeof item.input !== 'string'
      || encoder.encode(item.input.normalize('NFC')).byteLength > MAX_DOCUMENT_CHUNK_BYTES) {
      return {
        id: item.id,
        ok: false,
        error: {
          code: 'invalid_input',
          message: `Document chunk must be a string of at most ${MAX_DOCUMENT_CHUNK_BYTES} UTF-8 bytes`,
          retryable: false
        }
      }
    }
    try {
      return {
        id: item.id,
        ok: true,
        terms: tokenizer.analyzeDocument(item.input)
      }
    } catch (error) {
      return {
        id: item.id,
        ok: false,
        error: {
          code: error instanceof RangeError || error instanceof TypeError
            ? 'invalid_input'
            : 'analysis_failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: !(error instanceof RangeError || error instanceof TypeError)
        }
      }
    }
  })

  return {
    batchId: request.batchId,
    tokenizerGeneration: tokenizer.metadata.tokenizerGeneration,
    items
  }
}
