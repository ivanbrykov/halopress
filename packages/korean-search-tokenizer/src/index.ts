export const KOREAN_SEARCH_CONTRACT_VERSION = 1 as const
export const KOREAN_SEARCH_ENGINE_VERSION = 'garu-ko@0.9.11'
export const KOREAN_SEARCH_MODEL_SHA256 = '5186b7ccf18bd1544523f408f1b7aa2a14b09b1c2d27ce96185afd49aa08e741'
export const KOREAN_SEARCH_PROFILE_VERSION = 1 as const
export const KOREAN_SEARCH_TOKENIZER_GENERATION = [
  `contract-${KOREAN_SEARCH_CONTRACT_VERSION}`,
  KOREAN_SEARCH_ENGINE_VERSION,
  `model-${KOREAN_SEARCH_MODEL_SHA256.slice(0, 16)}`,
  `profile-${KOREAN_SEARCH_PROFILE_VERSION}`,
  'nfc'
].join(':')

export const MAX_DOCUMENT_CHUNK_BYTES = 24 * 1024
export const MAX_DOCUMENT_CHUNK_SENTENCES = 10
export const MAX_QUERY_BYTES = 512
export const MAX_QUERY_TERMS = 64
export const MAX_TERM_BYTES = 128

export type KoreanSearchAnalyzerToken = {
  text: string
  pos: string
}

export type KoreanSearchAnalyzer = {
  analyze(text: string): {
    tokens: KoreanSearchAnalyzerToken[]
  } | Array<{
    tokens: KoreanSearchAnalyzerToken[]
  }>
  modelInfo(): {
    version: string
    size: number
    accuracy: number
  }
  destroy(): void
}

export type KoreanSearchTokenizerMetadata = {
  contractVersion: typeof KOREAN_SEARCH_CONTRACT_VERSION
  tokenizerGeneration: typeof KOREAN_SEARCH_TOKENIZER_GENERATION
  engineVersion: typeof KOREAN_SEARCH_ENGINE_VERSION
  modelVersion: string
  modelSha256: typeof KOREAN_SEARCH_MODEL_SHA256
  profileVersion: typeof KOREAN_SEARCH_PROFILE_VERSION
  normalization: 'NFC'
}

export type KoreanSearchTerms = {
  contractVersion: typeof KOREAN_SEARCH_CONTRACT_VERSION
  tokenizerGeneration: typeof KOREAN_SEARCH_TOKENIZER_GENERATION
  normalizedText: string
  rawTerms: string[]
  morphTerms: string[]
}

export type KoreanSearchTokenizer = {
  metadata: KoreanSearchTokenizerMetadata
  analyzeDocument(text: string): KoreanSearchTerms
  analyzeQuery(text: string): KoreanSearchTerms
  destroy(): void
}

const SEARCHABLE_POS = new Set([
  'NNG',
  'NNP',
  'NNB',
  'NP',
  'NR',
  'VV',
  'VA',
  'VX',
  'VCP',
  'VCN',
  'MM',
  'MAG',
  'MAJ',
  'IC',
  'SL',
  'SH',
  'SN',
  'XR'
])

const RAW_TERM_PATTERN = /[\p{L}\p{N}]+(?:[._:/@+-][\p{L}\p{N}]+)*/gu
const SAFE_SEARCH_TERM_PATTERN = /^[\p{L}\p{N}]+(?:[._:/@+-][\p{L}\p{N}]+)*$/u

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function normalizedToken(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('und')
}

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\p{Cc}\u200B-\u200D\u2060\uFEFF]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function extractRawTerms(value: string) {
  return [...normalizeSearchText(value).matchAll(RAW_TERM_PATTERN)]
    .map(match => normalizedToken(match[0]))
    .filter(term => term && utf8Bytes(term) <= MAX_TERM_BYTES)
}

export function validateSearchTerms(terms: unknown, options: { maxTerms?: number } = {}) {
  if (!Array.isArray(terms)) throw new TypeError('Search terms must be an array')
  const maxTerms = options.maxTerms ?? MAX_QUERY_TERMS
  if (terms.length > maxTerms) throw new RangeError(`Search terms exceed ${maxTerms}`)
  return terms.map((term) => {
    if (typeof term !== 'string') throw new TypeError('Search terms must be strings')
    const normalized = normalizedToken(term)
    if (!normalized
      || normalized !== term
      || !SAFE_SEARCH_TERM_PATTERN.test(normalized)) {
      throw new TypeError('Search terms must be non-empty normalized tokens')
    }
    if (utf8Bytes(normalized) > MAX_TERM_BYTES) {
      throw new RangeError(`Search term exceeds ${MAX_TERM_BYTES} bytes`)
    }
    return normalized
  })
}

export function splitTokenizerChunks(
  value: string,
  maxBytes = MAX_DOCUMENT_CHUNK_BYTES,
  maxSentences = MAX_DOCUMENT_CHUNK_SENTENCES
) {
  if (!Number.isInteger(maxBytes) || maxBytes < 256) {
    throw new RangeError('Tokenizer chunk size must be at least 256 bytes')
  }
  if (!Number.isInteger(maxSentences) || maxSentences < 1) {
    throw new RangeError('Tokenizer chunk sentence limit must be positive')
  }
  const normalized = normalizeSearchText(value)
  if (!normalized) return []

  const segments = normalized.match(/[^.!?。！？\n]+[.!?。！？]?|\n+/gu) ?? [normalized]
  const chunks: string[] = []
  let current = ''
  let currentSentences = 0
  const pushCurrent = () => {
    const chunk = current.trim()
    if (chunk) chunks.push(chunk)
    current = ''
    currentSentences = 0
  }

  for (const segment of segments) {
    if (current && currentSentences >= maxSentences) pushCurrent()
    const candidate = current ? `${current} ${segment.trim()}` : segment.trim()
    if (candidate && utf8Bytes(candidate) <= maxBytes) {
      current = candidate
      currentSentences += 1
      continue
    }
    pushCurrent()

    let partial = ''
    for (const symbol of segment.trim()) {
      const next = partial + symbol
      if (utf8Bytes(next) <= maxBytes) {
        partial = next
        continue
      }
      if (partial) chunks.push(partial)
      partial = symbol
    }
    current = partial
    currentSentences = partial ? 1 : 0
  }
  pushCurrent()
  return chunks
}

function analyzedTokens(result: ReturnType<KoreanSearchAnalyzer['analyze']>) {
  return Array.isArray(result) ? result[0]?.tokens ?? [] : result.tokens
}

export function createSearchTokenizer(analyzer: KoreanSearchAnalyzer): KoreanSearchTokenizer {
  const model = analyzer.modelInfo()
  if (model.version !== '0.9.11') {
    analyzer.destroy()
    throw new Error(`Unsupported Garu model version: ${model.version}`)
  }

  const metadata: KoreanSearchTokenizerMetadata = {
    contractVersion: KOREAN_SEARCH_CONTRACT_VERSION,
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    engineVersion: KOREAN_SEARCH_ENGINE_VERSION,
    modelVersion: model.version,
    modelSha256: KOREAN_SEARCH_MODEL_SHA256,
    profileVersion: KOREAN_SEARCH_PROFILE_VERSION,
    normalization: 'NFC'
  }

  const analyze = (input: string, maxBytes: number): KoreanSearchTerms => {
    if (typeof input !== 'string') throw new TypeError('Search input must be a string')
    const normalizedText = normalizeSearchText(input)
    if (utf8Bytes(normalizedText) > maxBytes) {
      throw new RangeError(`Search input exceeds ${maxBytes} bytes`)
    }
    const rawTerms = extractRawTerms(normalizedText)
    const morphTerms = normalizedText
      ? analyzedTokens(analyzer.analyze(normalizedText))
          .filter(token => SEARCHABLE_POS.has(token.pos))
          .map(token => normalizedToken(token.text))
          .filter(term => term && utf8Bytes(term) <= MAX_TERM_BYTES)
      : []

    return {
      contractVersion: KOREAN_SEARCH_CONTRACT_VERSION,
      tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
      normalizedText,
      rawTerms,
      morphTerms
    }
  }

  return {
    metadata,
    analyzeDocument: input => analyze(input, MAX_DOCUMENT_CHUNK_BYTES),
    analyzeQuery: input => analyze(input, MAX_QUERY_BYTES),
    destroy: () => analyzer.destroy()
  }
}
