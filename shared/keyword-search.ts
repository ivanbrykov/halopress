import {
  KOREAN_SEARCH_TOKENIZER_GENERATION,
  MAX_QUERY_BYTES,
  MAX_QUERY_TERMS,
  validateSearchTerms
} from '@halopress/korean-search-tokenizer'

export const KEYWORD_SEARCH_CONTRACT_VERSION = 1 as const
export const KEYWORD_SEARCH_MAX_LIMIT = 50
export const KEYWORD_SEARCH_DEFAULT_LIMIT = 12
export const KEYWORD_SEARCH_MAX_FILTERS = 4

export type KeywordSearchDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>
      all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>
    }
  }
}

export type KeywordSearchAccess = {
  roleKey: string
  admin: boolean
}

export type KeywordSearchFilter =
  | { fieldId: string, op: 'exact', value: string | number }
  | { fieldId: string, op: 'exact_set', values: Array<string | number> }
  | { fieldId: string, op: 'range', min?: number, max?: number }

export type KeywordSearchTokenRequest = {
  contractVersion: typeof KEYWORD_SEARCH_CONTRACT_VERSION
  mode: 'tokens'
  tokenizerGeneration: string
  rawTerms: string[]
  morphTerms: string[]
  operator: 'all' | 'any'
  schemaKeys: string[]
  fieldIds: string[]
  filters: KeywordSearchFilter[]
  limit: number
  cursor: string | null
}

export type KeywordSearchRawRequest = Omit<
  KeywordSearchTokenRequest,
  'mode' | 'tokenizerGeneration' | 'rawTerms' | 'morphTerms'
> & {
  mode: 'raw'
  query: string
}

export type KeywordSearchResult = {
  id: string
  schemaKey: string
  schemaVersion: number
  title: string | null
  description: string | null
  image: string | null
  to: string
  score: number
}

export type KeywordSearchResponse = {
  contractVersion: typeof KEYWORD_SEARCH_CONTRACT_VERSION
  tokenizerGeneration: string
  queryEpoch: number
  items: KeywordSearchResult[]
  nextCursor: string | null
  availability: 'available' | 'partial'
  indexing: {
    pending: number
    failed: number
  }
}

export class KeywordSearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function stringList(value: unknown, name: string, limit: number) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > limit) {
    throw new KeywordSearchError('invalid_request', `${name} must contain at most ${limit} items`)
  }
  const values = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new KeywordSearchError('invalid_request', `${name} must contain strings`)
    }
    const normalized = entry.trim()
    if (!normalized || normalized.length > 128 || hasControlCharacter(normalized)) {
      throw new KeywordSearchError('invalid_request', `${name} contains an invalid value`)
    }
    return normalized
  })
  return [...new Set(values)]
}

function parseLimit(value: unknown) {
  if (value == null) return KEYWORD_SEARCH_DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > KEYWORD_SEARCH_MAX_LIMIT) {
    throw new KeywordSearchError(
      'invalid_request',
      `limit must be between 1 and ${KEYWORD_SEARCH_MAX_LIMIT}`
    )
  }
  return Number(value)
}

function parseFilters(value: unknown): KeywordSearchFilter[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > KEYWORD_SEARCH_MAX_FILTERS) {
    throw new KeywordSearchError(
      'invalid_request',
      `filters must contain at most ${KEYWORD_SEARCH_MAX_FILTERS} items`
    )
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new KeywordSearchError('invalid_filter', 'Invalid keyword filter')
    const fieldId = stringList([entry.fieldId], 'filter fieldId', 1)[0]!
    if (entry.op === 'exact') {
      if (typeof entry.value !== 'string' && typeof entry.value !== 'number') {
        throw new KeywordSearchError('invalid_filter', 'Exact filter requires a string or number')
      }
      if (typeof entry.value === 'string' && utf8Bytes(entry.value) > 256) {
        throw new KeywordSearchError('invalid_filter', 'Exact filter value is too long')
      }
      if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) {
        throw new KeywordSearchError('invalid_filter', 'Exact filter number must be finite')
      }
      return { fieldId, op: 'exact', value: entry.value }
    }
    if (entry.op === 'exact_set') {
      if (!Array.isArray(entry.values) || !entry.values.length || entry.values.length > 10) {
        throw new KeywordSearchError('invalid_filter', 'Exact-set filter requires 1 to 10 values')
      }
      const values = entry.values.map((item) => {
        if (typeof item !== 'string' && typeof item !== 'number') {
          throw new KeywordSearchError('invalid_filter', 'Exact-set values must be strings or numbers')
        }
        if (typeof item === 'string' && utf8Bytes(item) > 256) {
          throw new KeywordSearchError('invalid_filter', 'Exact-set value is too long')
        }
        if (typeof item === 'number' && !Number.isFinite(item)) {
          throw new KeywordSearchError('invalid_filter', 'Exact-set number must be finite')
        }
        return item
      })
      if (values.some(item => typeof item !== typeof values[0])) {
        throw new KeywordSearchError('invalid_filter', 'Exact-set values must use one data type')
      }
      return { fieldId, op: 'exact_set', values }
    }
    if (entry.op === 'range') {
      const min = entry.min == null ? undefined : Number(entry.min)
      const max = entry.max == null ? undefined : Number(entry.max)
      if ((min == null && max == null)
        || (min != null && !Number.isFinite(min))
        || (max != null && !Number.isFinite(max))
        || (min != null && max != null && min > max)) {
        throw new KeywordSearchError('invalid_filter', 'Range filter requires a valid min or max')
      }
      return { fieldId, op: 'range', min, max }
    }
    throw new KeywordSearchError('invalid_filter', 'Unsupported keyword filter operation')
  })
}

function commonRequest(input: Record<string, unknown>) {
  if (input.contractVersion !== KEYWORD_SEARCH_CONTRACT_VERSION) {
    throw new KeywordSearchError('contract_mismatch', 'Unsupported keyword search contract', 409)
  }
  return {
    contractVersion: KEYWORD_SEARCH_CONTRACT_VERSION,
    operator: input.operator === 'any' ? 'any' as const : 'all' as const,
    schemaKeys: stringList(input.schemaKeys, 'schemaKeys', 10),
    fieldIds: stringList(input.fieldIds, 'fieldIds', 20),
    filters: parseFilters(input.filters),
    limit: parseLimit(input.limit),
    cursor: input.cursor == null
      ? null
      : typeof input.cursor === 'string' && input.cursor.length <= 512
        ? input.cursor
        : (() => {
            throw new KeywordSearchError('invalid_cursor', 'Search cursor is invalid')
          })()
  }
}

export function parseKeywordTokenRequest(input: unknown): KeywordSearchTokenRequest {
  if (!isRecord(input) || input.mode !== 'tokens') {
    throw new KeywordSearchError('invalid_request', 'A tokenized keyword request is required')
  }
  if (input.tokenizerGeneration !== KOREAN_SEARCH_TOKENIZER_GENERATION) {
    throw new KeywordSearchError('generation_mismatch', 'Tokenizer generation does not match', 409, true)
  }
  let rawTerms: string[]
  let morphTerms: string[]
  try {
    rawTerms = validateSearchTerms(input.rawTerms)
    morphTerms = validateSearchTerms(input.morphTerms)
  } catch (error) {
    throw new KeywordSearchError(
      'invalid_terms',
      error instanceof Error ? error.message : 'Invalid search terms'
    )
  }
  if (!rawTerms.length && !morphTerms.length) {
    throw new KeywordSearchError('empty_query', 'Search terms are empty')
  }
  if (rawTerms.length + morphTerms.length > MAX_QUERY_TERMS) {
    throw new KeywordSearchError('invalid_terms', `Search terms exceed ${MAX_QUERY_TERMS}`)
  }
  return {
    ...commonRequest(input),
    mode: 'tokens',
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    rawTerms,
    morphTerms
  }
}

export function parseKeywordRawRequest(input: unknown): KeywordSearchRawRequest {
  if (!isRecord(input) || input.mode !== 'raw' || typeof input.query !== 'string') {
    throw new KeywordSearchError('invalid_request', 'A raw keyword query is required')
  }
  const query = input.query.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (!query) throw new KeywordSearchError('empty_query', 'Search query is empty')
  if (utf8Bytes(query) > MAX_QUERY_BYTES) {
    throw new KeywordSearchError('query_too_large', `Search query exceeds ${MAX_QUERY_BYTES} bytes`)
  }
  return { ...commonRequest(input), mode: 'raw', query }
}

function quotedTerm(term: string) {
  return `"${term.replaceAll('"', '""')}"`
}

export function buildKeywordMatchExpression(request: Pick<
  KeywordSearchTokenRequest,
  'rawTerms' | 'morphTerms' | 'operator'
>) {
  const joiner = request.operator === 'any' ? ' OR ' : ' AND '
  const streams = [
    request.rawTerms.length
      ? `raw_text : (${request.rawTerms.map(quotedTerm).join(joiner)})`
      : null,
    request.morphTerms.length
      ? `morph_text : (${request.morphTerms.map(quotedTerm).join(joiner)})`
      : null
  ].filter((value): value is string => Boolean(value))
  return streams.length > 1 ? `(${streams.join(' OR ')})` : streams[0]!
}

function placeholders(length: number) {
  return Array.from({ length }, () => '?').join(', ')
}

function selectionSql(
  alias: string,
  request: Pick<KeywordSearchTokenRequest, 'schemaKeys' | 'fieldIds'>
) {
  const clauses: string[] = []
  const params: unknown[] = []
  if (request.schemaKeys.length) {
    clauses.push(`${alias}.schema_key IN (${placeholders(request.schemaKeys.length)})`)
    params.push(...request.schemaKeys)
  }
  if (request.fieldIds.length) {
    clauses.push(`${alias}.field_id IN (${placeholders(request.fieldIds.length)})`)
    params.push(...request.fieldIds)
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  }
}

function filterSql(filters: KeywordSearchFilter[]) {
  const clauses: string[] = []
  const params: unknown[] = []
  for (const filter of filters) {
    const capability = filter.op === 'range'
      ? `fc.search_mode = 'range'`
      : filter.op === 'exact_set'
        ? `fc.search_mode = 'exact_set'`
        : `fc.search_mode IN ('exact', 'exact_set')`
    const common = `
      EXISTS (
        SELECT 1
        FROM search_config fc
        JOIN content_search_data csd
          ON csd.content_id = c.id
         AND csd.projection_scope = 'published'
         AND csd.field_id = fc.field_id
        WHERE fc.schema_key = c.schema_key
          AND fc.field_id = ?
          AND fc.filterable = 1
          AND ${capability}`
    params.push(filter.fieldId)
    if (filter.op === 'exact') {
      if (typeof filter.value === 'string') {
        clauses.push(`${common} AND csd.data_type = 'text' AND csd.text = ?)`)
      } else {
        clauses.push(`${common} AND csd.data_type <> 'text' AND csd.value = ?)`)
      }
      params.push(filter.value)
      continue
    }
    if (filter.op === 'exact_set') {
      const text = typeof filter.values[0] === 'string'
      clauses.push(`${common}
        AND csd.data_type ${text ? '=' : '<>'} 'text'
        AND ${text ? 'csd.text' : 'csd.value'} IN (${placeholders(filter.values.length)})
      )`)
      params.push(...filter.values)
      continue
    }
    const range: string[] = []
    if (filter.min != null) {
      range.push('csd.value >= ?')
      params.push(filter.min)
    }
    if (filter.max != null) {
      range.push('csd.value <= ?')
      params.push(filter.max)
    }
    clauses.push(`${common} AND csd.data_type <> 'text' AND ${range.join(' AND ')})`)
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  }
}

function fingerprint(request: KeywordSearchTokenRequest, access: KeywordSearchAccess) {
  const value = JSON.stringify({
    rawTerms: request.rawTerms,
    morphTerms: request.morphTerms,
    operator: request.operator,
    schemaKeys: request.schemaKeys,
    fieldIds: request.fieldIds,
    filters: request.filters,
    limit: request.limit,
    roleKey: access.roleKey,
    admin: access.admin
  })
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function encodeCursor(value: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeCursor(value: string) {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new KeywordSearchError('invalid_cursor', 'Search cursor is invalid')
  }
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(
      Math.ceil(value.length / 4) * 4,
      '='
    )
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes))
    if (!isRecord(decoded)) throw new Error('invalid')
    return decoded
  } catch {
    throw new KeywordSearchError('invalid_cursor', 'Search cursor is invalid')
  }
}

export async function executeKeywordSearch(
  db: KeywordSearchDatabase,
  request: KeywordSearchTokenRequest,
  access: KeywordSearchAccess
): Promise<KeywordSearchResponse> {
  const control = await db.prepare(`
    SELECT tokenizer_generation, query_epoch, status
    FROM full_text_control
    WHERE key = 'singleton'
  `).bind().first<{
    tokenizer_generation: string
    query_epoch: number
    status: string
  }>()
  if (!control || control.status !== 'available') {
    throw new KeywordSearchError('search_unavailable', 'Keyword search is unavailable', 503, true)
  }
  if (control.tokenizer_generation !== request.tokenizerGeneration) {
    throw new KeywordSearchError('generation_mismatch', 'Search index generation changed', 409, true)
  }

  const requestFingerprint = fingerprint(request, access)
  let offset = 0
  if (request.cursor) {
    const cursor = decodeCursor(request.cursor)
    if (cursor.fingerprint !== requestFingerprint
      || cursor.generation !== control.tokenizer_generation
      || cursor.epoch !== control.query_epoch
      || !Number.isInteger(cursor.offset)
      || Number(cursor.offset) < 0
      || Number(cursor.offset) > 100_000) {
      throw new KeywordSearchError('stale_cursor', 'Search cursor is stale or invalid', 409, true)
    }
    offset = Number(cursor.offset)
  }

  const match = buildKeywordMatchExpression(request)
  const outerSelection = selectionSql('f', request)
  const innerSelection = selectionSql('candidate', request)
  const filters = filterSql(request.filters)
  const rank = 'bm25(full_text_fts, 0, 0, 0, 0, 0, 0, 0, 8.0, 3.0)'
  const sql = `
    WITH readable_schema AS (
      SELECT active.schema_key
      FROM schema_active active
      WHERE active.status = 'active'
        AND (
          ? = 1
          OR EXISTS (
            SELECT 1
            FROM schema_role gate
            WHERE gate.schema_key = active.schema_key
              AND gate.role_key = ?
              AND (
                gate.can_read = 1
                OR gate.can_write = 1
                OR gate.can_publish = 1
                OR gate.can_archive = 1
                OR gate.can_delete = 1
                OR gate.can_admin = 1
              )
          )
        )
    )
    SELECT
      c.id,
      c.schema_key,
      cl.schema_version,
      cl.title,
      cl.description,
      cl.image,
      pr.path,
      ${rank} AS rank
    FROM full_text_fts f
    JOIN full_text_index_state state
      ON state.content_id = f.content_id
     AND state.field_id = f.field_id
     AND state.active_index_generation = f.index_generation
     AND state.published_revision_id = f.published_revision_id
     AND state.tokenizer_generation = ?
     AND state.status = 'ready'
    JOIN content c
      ON c.id = f.content_id
     AND c.schema_key = f.schema_key
     AND c.status = 'published'
     AND c.published_revision_id = f.published_revision_id
    JOIN content_listing cl
      ON cl.content_id = c.id
     AND cl.projection_scope = 'published'
     AND cl.status = 'published'
    JOIN readable_schema access
      ON access.schema_key = c.schema_key
    JOIN search_config sc
      ON sc.schema_key = c.schema_key
     AND sc.field_id = f.field_id
     AND sc.full_text = 1
    JOIN public_route pr
      ON pr.document_kind = 'content'
     AND pr.document_id = c.id
     AND pr.schema_key = c.schema_key
     AND pr.route_kind = 'canonical'
    WHERE full_text_fts MATCH ?
      ${outerSelection.sql}
      AND f.rowid = (
        SELECT candidate.rowid
        FROM full_text_fts candidate
        WHERE full_text_fts MATCH ?
          AND candidate.content_id = f.content_id
          ${innerSelection.sql}
        ORDER BY ${rank}, candidate.rowid
        LIMIT 1
      )
      ${filters.sql}
    ORDER BY rank, c.id
    LIMIT ? OFFSET ?
  `
  const rows = await db.prepare(sql).bind(
    access.admin ? 1 : 0,
    access.roleKey,
    request.tokenizerGeneration,
    match,
    ...outerSelection.params,
    match,
    ...innerSelection.params,
    ...filters.params,
    request.limit + 1,
    offset
  ).all<{
    id: string
    schema_key: string
    schema_version: number
    title: string | null
    description: string | null
    image: string | null
    path: string
    rank: number
  }>()
  const visibleRows = rows.results ?? []
  const hasMore = visibleRows.length > request.limit
  const page = visibleRows.slice(0, request.limit)
  const jobHealth = await db.prepare(`
    SELECT
      coalesce(sum(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END), 0) AS pending,
      coalesce(sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM full_text_job
  `).bind().first<{ pending: number, failed: number }>()

  return {
    contractVersion: KEYWORD_SEARCH_CONTRACT_VERSION,
    tokenizerGeneration: control.tokenizer_generation,
    queryEpoch: control.query_epoch,
    items: page.map((row): KeywordSearchResult => ({
      id: row.id,
      schemaKey: row.schema_key,
      schemaVersion: Number(row.schema_version),
      title: row.title,
      description: row.description,
      image: row.image,
      to: row.path,
      score: Number((-Number(row.rank)).toFixed(8))
    })),
    nextCursor: hasMore
      ? encodeCursor({
          generation: control.tokenizer_generation,
          epoch: control.query_epoch,
          fingerprint: requestFingerprint,
          offset: offset + request.limit
        })
      : null,
    availability: Number(jobHealth?.pending) > 0 || Number(jobHealth?.failed) > 0
      ? 'partial' as const
      : 'available' as const,
    indexing: {
      pending: Number(jobHealth?.pending ?? 0),
      failed: Number(jobHealth?.failed ?? 0)
    }
  }
}
