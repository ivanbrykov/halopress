import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KOREAN_SEARCH_TOKENIZER_GENERATION } from '@halopress/korean-search-tokenizer'

import {
  KeywordSearchError,
  buildKeywordMatchExpression,
  executeKeywordSearch as executeKeywordSearchWithAccess,
  parseKeywordTokenRequest
} from '../shared/keyword-search'
import { applyMigrations, SqliteD1 } from '../workers/search/tests/sqlite-d1'

let db: SqliteD1
const anonymousAccess = { roleKey: 'anonymous', admin: false }

function executeKeywordSearch(
  database: SqliteD1,
  value: ReturnType<typeof request>,
  access = anonymousAccess
) {
  return executeKeywordSearchWithAccess(database, value, access)
}

function seedSchema() {
  db.sqlite.prepare(`
    INSERT INTO user_role (role_key, title, level)
    VALUES
      ('anonymous', 'Anonymous', 0),
      ('editor', 'Editor', 10),
      ('admin', 'Admin', 100)
  `).run()
  db.sqlite.prepare(`
    INSERT INTO schema (
      schema_key, version, title, ast_json, json_schema, registry_json, created_at
    ) VALUES ('article', 1, 'Article', '{}', '{}', '{"fields":[]}', 1)
  `).run()
  db.sqlite.prepare(`
    INSERT INTO schema_active (schema_key, active_version, updated_at)
    VALUES ('article', 1, 1)
  `).run()
  db.sqlite.prepare(`
    INSERT INTO schema_role (
      schema_key, role_key, can_read, can_write, can_admin
    ) VALUES ('article', 'anonymous', 1, 0, 0)
  `).run()
  for (const [fieldId, fieldKey, kind, searchMode, filterable, fullText] of [
    ['field-body', 'body', 'text', 'off', 0, 1],
    ['field-category', 'category', 'string', 'exact_set', 1, 0],
    ['field-year', 'year', 'integer', 'range', 1, 0]
  ]) {
    db.sqlite.prepare(`
      INSERT INTO search_config (
        schema_key, field_id, field_key, kind,
        search_mode, filterable, sortable, full_text
      ) VALUES ('article', ?, ?, ?, ?, ?, 0, ?)
    `).run(fieldId, fieldKey, kind, searchMode, filterable, fullText)
  }
}

function seedResult(args: {
  id: string
  revision: string
  rawText: string
  morphText: string
  title?: string
  category?: string
  year?: number
}) {
  const generation = `generation-${args.id}`
  db.sqlite.prepare(`
    INSERT INTO content (
      id, schema_key, schema_version, status, content_json,
      created_at, updated_at, published_revision_id, published_at
    ) VALUES (?, 'article', 1, 'published', '{}', 1, 1, ?, 1)
  `).run(args.id, args.revision)
  db.sqlite.prepare(`
    INSERT INTO content_listing (
      content_id, projection_scope, schema_key, schema_version,
      title, description, status, created_at, updated_at
    ) VALUES (?, 'published', 'article', 1, ?, 'Public description', 'published', 1, 1)
  `).run(args.id, args.title ?? args.id)
  db.sqlite.prepare(`
    INSERT INTO public_route (
      path, route_kind, document_kind, document_id,
      schema_key, created_at, updated_at
    ) VALUES (?, 'canonical', 'content', ?, 'article', 1, 1)
  `).run(`/article/${args.id}`, args.id)
  db.sqlite.prepare(`
    INSERT INTO full_text_index_state (
      content_id, schema_key, schema_version, field_id,
      published_revision_id, tokenizer_generation,
      active_index_generation, status, indexed_chunks,
      total_chunks, attempt_count, updated_at, activated_at
    ) VALUES (?, 'article', 1, 'field-body', ?, ?, ?, 'ready', 1, 1, 1, 1, 1)
  `).run(args.id, args.revision, KOREAN_SEARCH_TOKENIZER_GENERATION, generation)
  db.sqlite.prepare(`
    INSERT INTO full_text_fts (
      index_generation, content_id, schema_key, schema_version,
      field_id, published_revision_id, chunk_index, raw_text, morph_text
    ) VALUES (?, ?, 'article', 1, 'field-body', ?, 0, ?, ?)
  `).run(generation, args.id, args.revision, args.rawText, args.morphText)
  if (args.category) {
    db.sqlite.prepare(`
      INSERT INTO content_search_data (
        content_id, projection_scope, field_id, data_type, text
      ) VALUES (?, 'published', 'field-category', 'text', ?)
    `).run(args.id, args.category)
  }
  if (args.year != null) {
    db.sqlite.prepare(`
      INSERT INTO content_search_data (
        content_id, projection_scope, field_id, data_type, value
      ) VALUES (?, 'published', 'field-year', 'integer', ?)
    `).run(args.id, args.year)
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return parseKeywordTokenRequest({
    contractVersion: 1,
    mode: 'tokens',
    tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
    rawTerms: [],
    morphTerms: ['학교'],
    operator: 'all',
    limit: 12,
    ...overrides
  })
}

beforeEach(async () => {
  db = new SqliteD1()
  await applyMigrations(db)
  seedSchema()
})

afterEach(() => db.close())

describe('safe ranked keyword search', () => {
  it('constructs quoted raw and morphology expressions without accepting FTS grammar', () => {
    expect(buildKeywordMatchExpression(request({
      rawTerms: ['cloudflare', 'code_123'],
      morphTerms: ['학교']
    }))).toBe('(raw_text : ("cloudflare" AND "code_123") OR morph_text : ("학교"))')
    expect(() => request({ rawTerms: ['학교*'], morphTerms: [] })).toThrow(KeywordSearchError)
    expect(() => request({ rawTerms: ['" or "'], morphTerms: [] })).toThrow(KeywordSearchError)
    expect(() => request({
      rawTerms: Array.from({ length: 33 }, (_, index) => `raw${index}`),
      morphTerms: Array.from({ length: 32 }, (_, index) => `morph${index}`)
    })).toThrow('exceed')
  })

  it('finds Korean stems and exact technical identifiers with canonical metadata', async () => {
    seedResult({
      id: 'school',
      revision: 'revision-school',
      rawText: '학교에서 cloudflare code_123',
      morphText: '학교 먹 cloudflare code_123',
      title: 'School lunch'
    })

    await expect(executeKeywordSearch(db, request())).resolves.toMatchObject({
      availability: 'available',
      items: [{
        id: 'school',
        schemaKey: 'article',
        title: 'School lunch',
        to: '/article/school'
      }]
    })
    await expect(executeKeywordSearch(db, request({
      rawTerms: [],
      morphTerms: ['먹']
    }))).resolves.toMatchObject({ items: [{ id: 'school' }] })
    await expect(executeKeywordSearch(db, request({
      rawTerms: ['code_123'],
      morphTerms: []
    }))).resolves.toMatchObject({ items: [{ id: 'school' }] })
  })

  it('combines exact-set and range filters through enabled published projections', async () => {
    seedResult({
      id: 'matching',
      revision: 'revision-matching',
      rawText: '학교에서',
      morphText: '학교',
      category: 'news',
      year: 2026
    })
    seedResult({
      id: 'filtered',
      revision: 'revision-filtered',
      rawText: '학교에서',
      morphText: '학교',
      category: 'guide',
      year: 2024
    })
    const result = await executeKeywordSearch(db, request({
      filters: [
        { fieldId: 'field-category', op: 'exact_set', values: ['news', 'release'] },
        { fieldId: 'field-year', op: 'range', min: 2025 }
      ]
    }))
    expect(result.items.map(item => item.id)).toEqual(['matching'])
  })

  it('rechecks publication, active schema, anonymous permission, and active generation', async () => {
    seedResult({
      id: 'stale',
      revision: 'revision-stale',
      rawText: '학교에서',
      morphText: '학교'
    })
    db.sqlite.prepare(`
      UPDATE content SET published_revision_id = 'revision-new' WHERE id = 'stale'
    `).run()
    expect((await executeKeywordSearch(db, request())).items).toEqual([])

    db.sqlite.prepare(`
      UPDATE content SET published_revision_id = 'revision-stale' WHERE id = 'stale'
    `).run()
    db.sqlite.prepare(`
      UPDATE schema_role SET can_read = 0
      WHERE schema_key = 'article' AND role_key = 'anonymous'
    `).run()
    expect((await executeKeywordSearch(db, request())).items).toEqual([])

    db.sqlite.prepare(`
      UPDATE schema_role SET can_read = 1
      WHERE schema_key = 'article' AND role_key = 'anonymous'
    `).run()
    db.sqlite.prepare(`DELETE FROM schema_active WHERE schema_key = 'article'`).run()
    expect((await executeKeywordSearch(db, request())).items).toEqual([])
  })

  it('gates the global candidate set with the server-resolved role before ranking', async () => {
    seedResult({
      id: 'role-gated',
      revision: 'revision-role-gated',
      rawText: '학교에서',
      morphText: '학교'
    })
    db.sqlite.prepare(`
      UPDATE schema_role
      SET can_read = 0
      WHERE schema_key = 'article' AND role_key = 'anonymous'
    `).run()
    db.sqlite.prepare(`
      INSERT INTO schema_role (
        schema_key, role_key, can_read, can_write, can_admin
      ) VALUES ('article', 'editor', 0, 1, 0)
    `).run()

    expect((await executeKeywordSearch(db, request())).items).toEqual([])
    await expect(executeKeywordSearch(
      db,
      request(),
      { roleKey: 'editor', admin: false }
    )).resolves.toMatchObject({ items: [{ id: 'role-gated' }] })
    await expect(executeKeywordSearch(
      db,
      request(),
      { roleKey: 'admin', admin: true }
    )).resolves.toMatchObject({ items: [{ id: 'role-gated' }] })
  })

  it('paginates tied ranks deterministically and rejects cursors after an epoch change', async () => {
    for (const id of ['a', 'b', 'c']) {
      seedResult({
        id,
        revision: `revision-${id}`,
        rawText: '학교에서',
        morphText: '학교'
      })
    }
    const first = await executeKeywordSearch(db, request({ limit: 1 }))
    expect(first.items.map(item => item.id)).toEqual(['a'])
    expect(first.nextCursor).toBeTruthy()
    const second = await executeKeywordSearch(db, request({
      limit: 1,
      cursor: first.nextCursor
    }))
    expect(second.items.map(item => item.id)).toEqual(['b'])
    const repeated = await executeKeywordSearch(db, request({
      limit: 1,
      cursor: first.nextCursor
    }))
    expect(repeated.items.map(item => item.id)).toEqual(['b'])
    await expect(executeKeywordSearch(
      db,
      request({ limit: 1, cursor: first.nextCursor }),
      { roleKey: 'editor', admin: false }
    )).rejects.toMatchObject({ code: 'stale_cursor', status: 409 })

    db.sqlite.prepare(`
      UPDATE full_text_control SET query_epoch = query_epoch + 1 WHERE key = 'singleton'
    `).run()
    await expect(executeKeywordSearch(db, request({
      limit: 1,
      cursor: first.nextCursor
    }))).rejects.toMatchObject({ code: 'stale_cursor', status: 409 })
  })

  it('reports partial availability without exposing job errors', async () => {
    seedResult({
      id: 'ready',
      revision: 'revision-ready',
      rawText: '학교에서',
      morphText: '학교'
    })
    db.sqlite.prepare(`
      INSERT INTO full_text_job (
        id, identity_key, operation, document_kind, document_id,
        schema_key, field_id, tokenizer_generation, index_generation,
        status, checkpoint, attempt_count, available_at, last_error,
        created_at, updated_at
      ) VALUES ('failed-job', 'failed-job', 'index', 'content', 'missing',
        'article', 'field-body', ?, 'failed-generation',
        'failed', 0, 5, 0, 'private analyzer detail', 0, 0)
    `).run(KOREAN_SEARCH_TOKENIZER_GENERATION)

    const result = await executeKeywordSearch(db, request())
    expect(result).toMatchObject({
      availability: 'partial',
      indexing: { pending: 0, failed: 1 }
    })
    expect(JSON.stringify(result)).not.toContain('private analyzer detail')
  })
})
