import type {
  KoreanSearchTerms,
  KoreanSearchTokenizerMetadata
} from '@halopress/korean-search-tokenizer'

export const SEARCH_ANALYZER_BINDING = 'HALOPRESS_SEARCH_ANALYZER' as const
export const SEARCH_ANALYZER_CONTRACT_VERSION = 1 as const
export const SEARCH_ANALYZER_MAX_BATCH_ITEMS = 4 as const

export type SearchAnalyzerBatchItem = {
  id: string
  input: string
}

export type SearchAnalyzerBatchRequest = {
  batchId: string
  items: SearchAnalyzerBatchItem[]
}

export type SearchAnalyzerBatchResult =
  | {
      id: string
      ok: true
      terms: KoreanSearchTerms
    }
    | {
      id: string
      ok: false
      error: {
        code: 'invalid_input' | 'analysis_failed'
        message: string
        retryable: boolean
      }
    }

export type SearchAnalyzerBatchResponse = {
  batchId: string
  tokenizerGeneration: string
  items: SearchAnalyzerBatchResult[]
}

export type SearchAnalyzerCompatibility = {
  analyzerContractVersion: typeof SEARCH_ANALYZER_CONTRACT_VERSION
  artifactVersionId: string
  tokenizer: KoreanSearchTokenizerMetadata
}

export type SearchAnalyzer = {
  metadata(): Promise<KoreanSearchTokenizerMetadata>
  compatibility(): Promise<SearchAnalyzerCompatibility>
  analyzeQuery(input: string): Promise<KoreanSearchTerms>
  analyzeBatch(request: SearchAnalyzerBatchRequest): Promise<SearchAnalyzerBatchResponse>
}

export type SearchAnalyzerRuntimeEnv = {
  HALOPRESS_SEARCH_ANALYZER?: SearchAnalyzer
}
