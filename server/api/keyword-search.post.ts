import type { H3Event } from 'h3'
import { createError, readBody, setHeader } from 'h3'

import {
  KeywordSearchError,
  executeKeywordSearch,
  parseKeywordRawRequest,
  parseKeywordTokenRequest
} from '../../shared/keyword-search'
import { getRawDb } from '../db/db'
import { analyzeKeywordSearchRequest } from '../utils/search-analyzer'
import { getSchemaRoleKey } from '../utils/schema-permission'

async function analyzeRawRequest(event: H3Event, body: unknown) {
  const raw = parseKeywordRawRequest(body)
  const analyzed = await analyzeKeywordSearchRequest(event, raw)
  return parseKeywordTokenRequest({
    ...raw,
    mode: 'tokens',
    tokenizerGeneration: analyzed.tokenizerGeneration,
    rawTerms: analyzed.rawTerms,
    morphTerms: analyzed.morphTerms
  })
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<Record<string, unknown>>(event)
    const request = body?.mode === 'raw'
      ? await analyzeRawRequest(event, body)
      : parseKeywordTokenRequest(body)
    const roleKey = await getSchemaRoleKey(event)
    const result = await executeKeywordSearch(await getRawDb(event), request, {
      roleKey,
      admin: roleKey === 'admin'
    })
    setHeader(
      event,
      'Cache-Control',
      roleKey === 'anonymous'
        ? 'public, max-age=15, stale-while-revalidate=30'
        : 'private, no-store'
    )
    setHeader(event, 'Vary', 'Cookie')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return result
  } catch (error) {
    if (error instanceof KeywordSearchError) {
      throw createError({
        statusCode: error.status,
        statusMessage: error.message,
        data: { code: error.code, retryable: error.retryable }
      })
    }
    throw error
  }
})
