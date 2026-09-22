/**
 * Kept as source text so the Cloudflare bundle never imports node:worker_threads.
 * The thread loads Garu's Node entry once and owns the Wasm/model for its whole
 * generation. Functional parity is enforced by the Node/DO fixture tests.
 */
export const NODE_ANALYZER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const SEARCHABLE_POS = new Set([
  'NNG', 'NNP', 'NNB', 'NP', 'NR', 'VV', 'VA', 'VX', 'VCP', 'VCN',
  'MM', 'MAG', 'MAJ', 'IC', 'SL', 'SH', 'SN', 'XR'
])
const RAW_TERM_PATTERN = /[\p{L}\p{N}]+(?:[._:/@+-][\p{L}\p{N}]+)*/gu
const SAFE_ID_BYTES = 160
const encoder = new TextEncoder()
let tokenizer

function bytes(value) {
  return encoder.encode(value).byteLength
}

function normalizeText(value) {
  return value
    .normalize('NFC')
    .replace(/[\p{Cc}\u200B-\u200D\u2060\uFEFF]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeTerm(value) {
  return value.normalize('NFC').toLocaleLowerCase('und')
}

function termsFor(input, maxBytes) {
  if (typeof input !== 'string') throw new TypeError('Search input must be a string')
  const normalizedText = normalizeText(input)
  if (bytes(normalizedText) > maxBytes) {
    throw new RangeError('Search input exceeds ' + maxBytes + ' bytes')
  }
  const rawTerms = [...normalizedText.matchAll(RAW_TERM_PATTERN)]
    .map(match => normalizeTerm(match[0]))
    .filter(term => term && bytes(term) <= workerData.maxTermBytes)
  const analyzed = normalizedText ? tokenizer.analyzer.analyze(normalizedText) : { tokens: [] }
  const tokens = Array.isArray(analyzed) ? (analyzed[0]?.tokens ?? []) : analyzed.tokens
  const morphTerms = tokens
    .filter(token => SEARCHABLE_POS.has(token.pos))
    .map(token => normalizeTerm(token.text))
    .filter(term => term && bytes(term) <= workerData.maxTermBytes)
  return {
    contractVersion: workerData.metadata.contractVersion,
    tokenizerGeneration: workerData.metadata.tokenizerGeneration,
    normalizedText,
    rawTerms,
    morphTerms
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !value || bytes(value) > SAFE_ID_BYTES) {
    throw new TypeError(label + ' must be a non-empty string of at most 160 UTF-8 bytes')
  }
}

function analyzeBatch(request) {
  assertIdentifier(request?.batchId, 'Analyzer batch ID')
  if (!Array.isArray(request?.items)
    || request.items.length < 1
    || request.items.length > workerData.maxBatchItems) {
    throw new RangeError('Analyzer batch must contain 1-' + workerData.maxBatchItems + ' items')
  }
  const seen = new Set()
  for (const item of request.items) {
    assertIdentifier(item?.id, 'Analyzer item ID')
    if (seen.has(item.id)) throw new TypeError('Duplicate analyzer item ID: ' + item.id)
    seen.add(item.id)
  }
  return {
    batchId: request.batchId,
    tokenizerGeneration: workerData.metadata.tokenizerGeneration,
    items: request.items.map((item) => {
      if (typeof item.input !== 'string'
        || bytes(item.input.normalize('NFC')) > workerData.maxDocumentBytes) {
        return {
          id: item.id,
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'Document chunk must be a string of at most '
              + workerData.maxDocumentBytes + ' UTF-8 bytes',
            retryable: false
          }
        }
      }
      try {
        return {
          id: item.id,
          ok: true,
          terms: termsFor(item.input, workerData.maxDocumentBytes)
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
  }
}

async function initialize() {
  const startedAt = performance.now()
  const { Garu } = await import(workerData.garuModule)
  const analyzer = await Garu.load()
  const model = analyzer.modelInfo()
  if (model.version !== workerData.metadata.modelVersion) {
    analyzer.destroy()
    throw new Error('Unsupported Garu model version: ' + model.version)
  }
  tokenizer = { analyzer }
  parentPort.postMessage({
    kind: 'ready',
    metrics: {
      initializedAt: Date.now(),
      initializationMs: Number((performance.now() - startedAt).toFixed(3)),
      modelBytes: model.size,
      rssBytes: process.memoryUsage().rss
    }
  })
}

parentPort.on('message', async (message) => {
  if (message.operation === '__crash_for_tests__') process.exit(86)
  const startedAt = performance.now()
  try {
    let value
    if (message.operation === 'metadata') value = workerData.metadata
    else if (message.operation === 'analyzeQuery') {
      value = termsFor(message.value, workerData.maxQueryBytes)
    } else if (message.operation === 'analyzeBatch') {
      value = analyzeBatch(message.value)
    } else {
      throw new TypeError('Unsupported analyzer operation')
    }
    parentPort.postMessage({
      kind: 'result',
      id: message.id,
      value,
      elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
      rssBytes: process.memoryUsage().rss
    })
  } catch (error) {
    parentPort.postMessage({
      kind: 'error',
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Number((performance.now() - startedAt).toFixed(3))
    })
  }
})

initialize().catch((error) => {
  parentPort.postMessage({
    kind: 'initialization-error',
    error: error instanceof Error ? error.message : String(error)
  })
  parentPort.close()
})
`
