import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  KOREAN_SEARCH_TOKENIZER_GENERATION
} from '@halopress/korean-search-tokenizer'

import {
  NodeSearchAnalyzerExecutor
} from '../server/search/node-analyzer-executor'
import { runSearchJobCycle } from '../server/search/node-job-runner'
import { NodeSqliteSearchStore } from '../server/search/sqlite-store'
import {
  executeKeywordSearch,
  parseKeywordTokenRequest
} from '../shared/keyword-search'
import { applyMigrations, SqliteD1 } from '../workers/search/tests/sqlite-d1'

let directory: string | null = null
let analyzer: NodeSearchAnalyzerExecutor | null = null

afterEach(async () => {
  await analyzer?.stop()
  analyzer = null
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = null
})

function configure(sqlite: DatabaseSync) {
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA busy_timeout = 5000')
}

function seedJob(sqlite: DatabaseSync) {
  const registry = JSON.stringify({
    fields: [{ fieldId: 'field-body', key: 'body', kind: 'text' }]
  })
  const text = Array.from(
    { length: 60 },
    (_, index) => `학교에서 ${index}번째 점심을 먹었다.`
  ).join(' ')
  sqlite.prepare(`
    INSERT INTO user_role (role_key, title, level)
    VALUES ('anonymous', 'Anonymous', 0)
  `).run()
  sqlite.prepare(`
    INSERT INTO schema (
      schema_key, version, title, ast_json, json_schema, registry_json, created_at
    ) VALUES ('article', 1, 'Article', '{}', '{}', ?, 1)
  `).run(registry)
  sqlite.prepare(`
    INSERT INTO schema_active (schema_key, active_version, status, updated_at)
    VALUES ('article', 1, 'active', 1)
  `).run()
  sqlite.prepare(`
    INSERT INTO schema_role (schema_key, role_key, can_read)
    VALUES ('article', 'anonymous', 1)
  `).run()
  sqlite.prepare(`
    INSERT INTO content (
      id, schema_key, schema_version, status, content_json,
      created_at, updated_at, published_revision_id, published_at
    ) VALUES ('content-1', 'article', 1, 'published', ?, 1, 1, 'revision-1', 1)
  `).run(JSON.stringify({ body: text }))
  sqlite.prepare(`
    INSERT INTO content_listing (
      content_id, projection_scope, schema_key, schema_version,
      title, status, created_at, updated_at
    ) VALUES (
      'content-1', 'published', 'article', 1,
      'School lunch', 'published', 1, 1
    )
  `).run()
  sqlite.prepare(`
    INSERT INTO publication_revision (
      id, document_kind, document_id, schema_key,
      schema_version, content_json, created_at
    ) VALUES ('revision-1', 'content', 'content-1', 'article', 1, ?, 1)
  `).run(JSON.stringify({ body: text }))
  sqlite.prepare(`
    INSERT INTO public_route (
      path, route_kind, document_kind, document_id,
      schema_key, created_at, updated_at
    ) VALUES (
      '/articles/school-lunch', 'canonical', 'content', 'content-1',
      'article', 1, 1
    )
  `).run()
  sqlite.prepare(`
    INSERT INTO search_config (
      schema_key, field_id, field_key, kind,
      search_mode, filterable, sortable, full_text
    ) VALUES ('article', 'field-body', 'body', 'text', 'off', 0, 0, 1)
  `).run()
  sqlite.prepare(`
    INSERT INTO full_text_job (
      id, identity_key, operation, document_kind, document_id,
      schema_key, schema_version, field_id, target_revision_id,
      tokenizer_generation, index_generation, status, checkpoint,
      total_chunks, attempt_count, available_at, lease_expires_at,
      last_error, created_at, updated_at, completed_at
    ) VALUES (
      'job-1', ?, 'index', 'content', 'content-1',
      'article', 1, 'field-body', 'revision-1',
      ?, 'generation-1', 'pending', 0,
      NULL, 0, 0, NULL, NULL, 0, 0, NULL
    )
  `).run(
    `index:content-1:field-body:revision-1:${KOREAN_SEARCH_TOKENIZER_GENERATION}`,
    KOREAN_SEARCH_TOKENIZER_GENERATION
  )
}

describe('Node SQLite search runtime integration', () => {
  it('recovers a checkpoint after reopen and serves the permission-gated FTS query', async () => {
    directory = await mkdtemp(join(tmpdir(), 'halopress-node-search-'))
    const path = join(directory, 'halopress.sqlite')
    let sqlite = new DatabaseSync(path)
    configure(sqlite)
    const fixture = new SqliteD1(sqlite)
    await applyMigrations(fixture)
    const store = new NodeSqliteSearchStore(sqlite as any)
    store.validateSchema()
    seedJob(sqlite)

    let firstBatch = true
    const retryingAnalyzer = {
      async analyzeBatch(request: any) {
        return {
          batchId: request.batchId,
          tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
          items: request.items.map((item: any, index: number) => {
            if (firstBatch && index === 1) {
              return {
                id: item.id,
                ok: false,
                error: {
                  code: 'analysis_failed',
                  message: 'simulated restart',
                  retryable: true
                }
              }
            }
            return {
              id: item.id,
              ok: true,
              terms: {
                contractVersion: 1,
                tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
                normalizedText: item.input,
                rawTerms: ['학교에서'],
                morphTerms: ['학교', '먹']
              }
            }
          })
        }
      }
    } as any
    await runSearchJobCycle({ store, analyzer: retryingAnalyzer, maxJobs: 1 })
    firstBatch = false
    expect(sqlite.prepare(`
      SELECT status, checkpoint FROM full_text_job WHERE id = 'job-1'
    `).get()).toEqual({ status: 'pending', checkpoint: 1 })

    sqlite.close()
    sqlite = new DatabaseSync(path)
    configure(sqlite)
    sqlite.prepare(`
      UPDATE full_text_job SET available_at = 0 WHERE id = 'job-1'
    `).run()
    const reopened = new NodeSqliteSearchStore(sqlite as any)
    analyzer = new NodeSearchAnalyzerExecutor()
    await analyzer.start()
    await expect(runSearchJobCycle({
      store: reopened,
      analyzer,
      maxJobs: 1
    })).resolves.toBe(1)
    expect(sqlite.prepare(`
      SELECT status, checkpoint, total_chunks
      FROM full_text_job WHERE id = 'job-1'
    `).get()).toEqual({ status: 'ready', checkpoint: 6, total_chunks: 6 })

    const analyzed = await analyzer.analyzeQuery('먹다')
    const result = await executeKeywordSearch(reopened, parseKeywordTokenRequest({
      contractVersion: 1,
      mode: 'tokens',
      tokenizerGeneration: analyzed.tokenizerGeneration,
      rawTerms: analyzed.rawTerms,
      morphTerms: analyzed.morphTerms,
      operator: 'all',
      limit: 10
    }), {
      roleKey: 'anonymous',
      admin: false
    })
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'content-1',
        to: '/articles/school-lunch'
      })
    ])
    sqlite.close()
  })

  it('uses WAL and lets a reader retain the active generation during a write', async () => {
    directory = await mkdtemp(join(tmpdir(), 'halopress-node-search-wal-'))
    const path = join(directory, 'halopress.sqlite')
    const writer = new DatabaseSync(path)
    configure(writer)
    const fixture = new SqliteD1(writer)
    await applyMigrations(fixture)
    seedJob(writer)
    writer.prepare(`
      INSERT INTO full_text_fts (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index, raw_text, morph_text
      ) VALUES (
        'active-generation', 'content-1', 'article', 1,
        'field-body', 'revision-1', 0, '학교에서', '학교'
      )
    `).run()
    const reader = new DatabaseSync(path)
    reader.exec('PRAGMA busy_timeout = 5000')

    expect(writer.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(writer.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    writer.exec('BEGIN IMMEDIATE')
    writer.prepare(`
      INSERT INTO full_text_chunk (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index,
        raw_text, morph_text, created_at
      ) VALUES (
        'building-generation', 'content-1', 'article', 1,
        'field-body', 'revision-1', 0, '새 학교', '학교', 1
      )
    `).run()
    expect(reader.prepare(`
      SELECT index_generation FROM full_text_fts
      WHERE full_text_fts MATCH 'morph_text : "학교"'
    `).all()).toEqual([{ index_generation: 'active-generation' }])
    writer.exec('ROLLBACK')

    reader.close()
    writer.close()
  })

  it('keeps two runner instances lease-safe on one same-host SQLite file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'halopress-node-search-runners-'))
    const path = join(directory, 'halopress.sqlite')
    const first = new DatabaseSync(path)
    configure(first)
    await applyMigrations(new SqliteD1(first))
    seedJob(first)
    const second = new DatabaseSync(path)
    configure(second)
    const firstStore = new NodeSqliteSearchStore(first as any)
    const secondStore = new NodeSqliteSearchStore(second as any)
    analyzer = new NodeSearchAnalyzerExecutor()
    await analyzer.start()

    await Promise.all([
      runSearchJobCycle({ store: firstStore, analyzer, maxJobs: 1 }),
      runSearchJobCycle({ store: secondStore, analyzer, maxJobs: 1 })
    ])
    expect(first.prepare(`
      SELECT status, attempt_count, checkpoint
      FROM full_text_job WHERE id = 'job-1'
    `).get()).toEqual({
      status: 'ready',
      attempt_count: 1,
      checkpoint: 6
    })
    expect(first.prepare(`
      SELECT count(*) AS count
      FROM full_text_fts WHERE content_id = 'content-1'
    `).get()).toEqual({ count: 6 })

    second.close()
    first.close()
  })
})
