import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  KOREAN_SEARCH_TOKENIZER_GENERATION,
  type KoreanSearchTokenizer
} from '@halopress/korean-search-tokenizer'

import { processFullTextJob } from '../src/indexer'
import { pendingJobIds } from '../src/repository'
import type { SearchStore } from '../../../shared/search-store'
import { applyMigrations, SqliteD1 } from './sqlite-d1'

let db: SqliteD1
let store: SearchStore

function fakeTokenizer(): KoreanSearchTokenizer {
  return {
    metadata: {
      contractVersion: 1,
      tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
      engineVersion: 'garu-ko@0.9.11',
      modelVersion: '0.9.11',
      modelSha256: '5186b7ccf18bd1544523f408f1b7aa2a14b09b1c2d27ce96185afd49aa08e741',
      profileVersion: 1,
      normalization: 'NFC'
    },
    analyzeDocument(text) {
      const rawTerms = text.toLocaleLowerCase('und').match(/[\p{L}\p{N}_]+/gu) ?? []
      const morphTerms = [
        ...(text.includes('학교에서') ? ['학교'] : []),
        ...(text.includes('먹었다') ? ['먹'] : []),
        ...rawTerms.filter(term => /^[a-z0-9_]+$/u.test(term))
      ]
      return {
        contractVersion: 1,
        tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
        normalizedText: text,
        rawTerms,
        morphTerms
      }
    },
    analyzeQuery(text) {
      return {
        contractVersion: 1,
        tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
        normalizedText: text,
        rawTerms: [text],
        morphTerms: text === '먹다' ? ['먹'] : [text]
      }
    },
    destroy() {}
  }
}

function seedPublishedJob(args: {
  contentId?: string
  revisionId?: string
  jobId?: string
  indexGeneration?: string
  text?: string
} = {}) {
  const contentId = args.contentId ?? 'content-1'
  const revisionId = args.revisionId ?? 'revision-1'
  const jobId = args.jobId ?? 'job-1'
  const indexGeneration = args.indexGeneration ?? 'generation-1'
  const text = args.text ?? Array.from(
    { length: 60 },
    (_, index) => `학교에서 ${index}번째 점심을 먹었다.`
  ).join(' ')
  const registry = JSON.stringify({
    fields: [{ fieldId: 'field-body', key: 'body', kind: 'text' }]
  })

  db.sqlite.prepare(`
    INSERT OR IGNORE INTO schema (
      schema_key, version, title, ast_json, json_schema,
      registry_json, created_at
    ) VALUES ('article', 1, 'Article', '{}', '{}', ?, 1)
  `).run(registry)
  db.sqlite.prepare(`
    INSERT OR REPLACE INTO content (
      id, schema_key, schema_version, status, content_json,
      created_at, updated_at, published_revision_id, published_at
    ) VALUES (?, 'article', 1, 'published', ?, 1, 1, ?, 1)
  `).run(contentId, JSON.stringify({ body: text }), revisionId)
  db.sqlite.prepare(`
    INSERT OR REPLACE INTO content_listing (
      content_id, projection_scope, schema_key, schema_version,
      title, status, created_at, updated_at
    ) VALUES (?, 'published', 'article', 1, 'School lunch', 'published', 1, 1)
  `).run(contentId)
  db.sqlite.prepare(`
    INSERT OR REPLACE INTO publication_revision (
      id, document_kind, document_id, schema_key,
      schema_version, content_json, created_at
    ) VALUES (?, 'content', ?, 'article', 1, ?, 1)
  `).run(revisionId, contentId, JSON.stringify({ body: text }))
  db.sqlite.prepare(`
    INSERT OR REPLACE INTO search_config (
      schema_key, field_id, field_key, kind,
      search_mode, filterable, sortable, full_text
    ) VALUES ('article', 'field-body', 'body', 'text', 'off', 0, 0, 1)
  `).run()
  db.sqlite.prepare(`
    INSERT INTO full_text_job (
      id, identity_key, operation, document_kind, document_id,
      schema_key, schema_version, field_id, target_revision_id,
      tokenizer_generation, index_generation, status, checkpoint,
      total_chunks, attempt_count, available_at, lease_expires_at,
      last_error, created_at, updated_at, completed_at
    ) VALUES (?, ?, 'index', 'content', ?, 'article', 1, 'field-body', ?,
      ?, ?, 'pending', 0, NULL, 0, 0, NULL, NULL, 0, 0, NULL)
  `).run(
    jobId,
    `index:${contentId}:field-body:${revisionId}:${KOREAN_SEARCH_TOKENIZER_GENERATION}`,
    contentId,
    revisionId,
    KOREAN_SEARCH_TOKENIZER_GENERATION,
    indexGeneration
  )
  return { contentId, revisionId, jobId, indexGeneration }
}

beforeEach(async () => {
  db = new SqliteD1()
  await applyMigrations(db)
  store = db
})

afterEach(() => db.close())

describe('lazy search indexer', () => {
  it('checkpoints only the successful prefix of a mixed analyzer batch', async () => {
    const seeded = seedPublishedJob()
    const base = fakeTokenizer()
    let firstBatch = true
    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => ({
        async analyzeBatch(request) {
          return {
            batchId: request.batchId,
            tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
            items: request.items.map((item, index) => {
              if (firstBatch && index === 1) {
                return {
                  id: item.id,
                  ok: false as const,
                  error: {
                    code: 'analysis_failed' as const,
                    message: 'temporary failure',
                    retryable: true
                  }
                }
              }
              return {
                id: item.id,
                ok: true as const,
                terms: base.analyzeDocument(item.input)
              }
            })
          }
        }
      })
    })
    firstBatch = false

    expect(result.outcome).toBe('retry')
    expect(db.sqlite.prepare(`
      SELECT status, checkpoint FROM full_text_job WHERE id = ?
    `).get(seeded.jobId)).toEqual({ status: 'pending', checkpoint: 1 })

    db.sqlite.prepare(`
      UPDATE full_text_job SET available_at = 0 WHERE id = ?
    `).run(seeded.jobId)
    await expect(processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => base
    })).resolves.toMatchObject({ outcome: 'ready' })
    expect(db.sqlite.prepare(`
      SELECT count(*) AS count FROM full_text_fts WHERE content_id = ?
    `).get(seeded.contentId)).toEqual({ count: 6 })
  })

  it('fails a non-retryable analyzer item without consuming retry claims', async () => {
    const seeded = seedPublishedJob()
    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => ({
        async analyzeBatch(request) {
          return {
            batchId: request.batchId,
            tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
            items: request.items.map(item => ({
              id: item.id,
              ok: false as const,
              error: {
                code: 'invalid_input' as const,
                message: 'invalid bounded chunk',
                retryable: false
              }
            }))
          }
        }
      })
    })

    expect(result.outcome).toBe('failed')
    expect(db.sqlite.prepare(`
      SELECT status, checkpoint, attempt_count, last_error
      FROM full_text_job WHERE id = ?
    `).get(seeded.jobId)).toEqual({
      status: 'failed',
      checkpoint: 0,
      attempt_count: 1,
      last_error: expect.stringContaining('invalid bounded chunk')
    })
  })

  it('checkpoints 50+ sentences and activates only the complete generation', async () => {
    const seeded = seedPublishedJob()
    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => fakeTokenizer()
    })

    expect(result.outcome).toBe('ready')
    expect(db.sqlite.prepare(`
      SELECT status, checkpoint, total_chunks
      FROM full_text_job WHERE id = ?
    `).get(seeded.jobId)).toEqual({
      status: 'ready',
      checkpoint: 6,
      total_chunks: 6
    })
    expect(db.sqlite.prepare(`
      SELECT status, indexed_chunks, total_chunks, active_index_generation
      FROM full_text_index_state
      WHERE content_id = ? AND field_id = 'field-body'
    `).get(seeded.contentId)).toEqual({
      status: 'ready',
      indexed_chunks: 6,
      total_chunks: 6,
      active_index_generation: seeded.indexGeneration
    })
    expect(db.sqlite.prepare(`
      SELECT DISTINCT content_id
      FROM full_text_fts
      WHERE full_text_fts MATCH 'morph_text : "학교"'
    `).all()).toEqual([{ content_id: seeded.contentId }])
    expect(db.sqlite.prepare(`
      SELECT DISTINCT content_id
      FROM full_text_fts
      WHERE full_text_fts MATCH 'morph_text : "먹"'
    `).all()).toEqual([{ content_id: seeded.contentId }])
    expect(db.sqlite.prepare(`
      SELECT count(*) AS count FROM full_text_chunk
    `).get()).toEqual({ count: 0 })
  })

  it('resumes an expired partial lease without duplicating active chunks', async () => {
    const seeded = seedPublishedJob()
    db.sqlite.prepare(`
      UPDATE full_text_job
      SET status = 'processing', checkpoint = 1, total_chunks = 6,
          attempt_count = 1, lease_expires_at = 0
      WHERE id = ?
    `).run(seeded.jobId)
    db.sqlite.prepare(`
      INSERT INTO full_text_chunk (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index,
        raw_text, morph_text, created_at
      ) VALUES (?, ?, 'article', 1, 'field-body', ?, 0, '학교에서', '학교', 0)
    `).run(seeded.indexGeneration, seeded.contentId, seeded.revisionId)

    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => fakeTokenizer()
    })
    expect(result.outcome).toBe('ready')
    expect(db.sqlite.prepare(`
      SELECT count(*) AS count FROM full_text_fts
      WHERE content_id = ?
    `).get(seeded.contentId)).toEqual({ count: 6 })
    await expect(processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => fakeTokenizer()
    })).resolves.toMatchObject({ outcome: 'not-claimed' })
  })

  it('keeps an older complete generation when a republish races activation', async () => {
    const seeded = seedPublishedJob()
    db.sqlite.prepare(`
      INSERT INTO full_text_fts (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index, raw_text, morph_text
      ) VALUES ('old-generation', ?, 'article', 1, 'field-body',
        'revision-0', 0, 'legacy', 'legacy')
    `).run(seeded.contentId)

    const tokenizer = fakeTokenizer()
    const originalAnalyze = tokenizer.analyzeDocument
    let changed = false
    tokenizer.analyzeDocument = (text) => {
      if (!changed) {
        changed = true
        db.sqlite.prepare(`
          UPDATE content SET published_revision_id = 'revision-2' WHERE id = ?
        `).run(seeded.contentId)
      }
      return originalAnalyze(text)
    }
    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => tokenizer
    })

    expect(result.outcome).toBe('stale')
    expect(db.sqlite.prepare(`
      SELECT index_generation, published_revision_id
      FROM full_text_fts WHERE content_id = ?
    `).all(seeded.contentId)).toEqual([{
      index_generation: 'old-generation',
      published_revision_id: 'revision-0'
    }])
  })

  it('keeps the active generation when a competing build owns activation', async () => {
    const initial = seedPublishedJob()
    await processFullTextJob({
      store,
      jobId: initial.jobId,
      analyzer: async () => fakeTokenizer()
    })
    const competing = seedPublishedJob({
      revisionId: 'revision-2',
      jobId: 'job-2',
      indexGeneration: 'generation-2'
    })
    const tokenizer = fakeTokenizer()
    const originalAnalyze = tokenizer.analyzeDocument
    let ownershipChanged = false
    tokenizer.analyzeDocument = (text) => {
      if (!ownershipChanged) {
        ownershipChanged = true
        db.sqlite.prepare(`
          UPDATE full_text_index_state
          SET building_index_generation = 'competing-generation'
          WHERE content_id = ? AND field_id = 'field-body'
        `).run(competing.contentId)
      }
      return originalAnalyze(text)
    }

    await expect(processFullTextJob({
      store,
      jobId: competing.jobId,
      analyzer: async () => tokenizer
    })).resolves.toMatchObject({ outcome: 'retry' })
    expect(db.sqlite.prepare(`
      SELECT DISTINCT index_generation, published_revision_id
      FROM full_text_fts WHERE content_id = ?
    `).all(competing.contentId)).toEqual([{
      index_generation: initial.indexGeneration,
      published_revision_id: initial.revisionId
    }])
  })

  it('records retryable failure state and redispatches expired jobs', async () => {
    const seeded = seedPublishedJob()
    const result = await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => {
        throw new Error('model unavailable')
      }
    })
    expect(result.outcome).toBe('retry')
    expect(db.sqlite.prepare(`
      SELECT status, attempt_count, last_error FROM full_text_job WHERE id = ?
    `).get(seeded.jobId)).toMatchObject({
      status: 'pending',
      attempt_count: 1,
      last_error: 'model unavailable'
    })
    db.sqlite.prepare(`
      UPDATE full_text_job SET available_at = 0 WHERE id = ?
    `).run(seeded.jobId)
    await expect(pendingJobIds(db)).resolves.toEqual([seeded.jobId])
  })

  it('removes every active and staged row idempotently', async () => {
    const seeded = seedPublishedJob()
    await processFullTextJob({
      store,
      jobId: seeded.jobId,
      analyzer: async () => fakeTokenizer()
    })
    db.sqlite.prepare(`
      UPDATE content
      SET status = 'draft', published_revision_id = NULL
      WHERE id = ?
    `).run(seeded.contentId)
    db.sqlite.prepare(`
      INSERT INTO full_text_job (
        id, identity_key, operation, document_kind, document_id,
        schema_key, field_id, target_revision_id,
        tokenizer_generation, index_generation,
        status, checkpoint, attempt_count, available_at, created_at, updated_at
      ) VALUES ('remove-1', 'remove:content-1:2', 'remove', 'content', ?,
        'article', '*', ?, ?, 'remove-generation', 'pending', 0, 0, 0, 0, 0)
    `).run(seeded.contentId, seeded.revisionId, KOREAN_SEARCH_TOKENIZER_GENERATION)

    await expect(processFullTextJob({
      store,
      jobId: 'remove-1',
      analyzer: async () => fakeTokenizer()
    })).resolves.toMatchObject({ outcome: 'removed' })
    expect(db.sqlite.prepare(`
      SELECT count(*) AS count FROM full_text_fts WHERE content_id = ?
    `).get(seeded.contentId)).toEqual({ count: 0 })
    await expect(processFullTextJob({
      store,
      jobId: 'remove-1',
      analyzer: async () => fakeTokenizer()
    })).resolves.toMatchObject({ outcome: 'not-claimed' })
  })

  it('marks a delayed removal stale after the content is republished', async () => {
    const initial = seedPublishedJob()
    await processFullTextJob({
      store,
      jobId: initial.jobId,
      analyzer: async () => fakeTokenizer()
    })
    db.sqlite.prepare(`
      INSERT INTO full_text_job (
        id, identity_key, operation, document_kind, document_id,
        schema_key, field_id, target_revision_id,
        tokenizer_generation, index_generation,
        status, checkpoint, attempt_count, available_at, created_at, updated_at
      ) VALUES ('remove-delayed', 'remove:content-1:2', 'remove', 'content', ?,
        'article', '*', ?, ?, 'remove-generation', 'pending', 0, 0, 0, 0, 0)
    `).run(initial.contentId, initial.revisionId, KOREAN_SEARCH_TOKENIZER_GENERATION)
    const republished = seedPublishedJob({
      revisionId: 'revision-2',
      jobId: 'job-2',
      indexGeneration: 'generation-2'
    })
    await processFullTextJob({
      store,
      jobId: republished.jobId,
      analyzer: async () => fakeTokenizer()
    })

    await expect(processFullTextJob({
      store,
      jobId: 'remove-delayed',
      analyzer: async () => fakeTokenizer()
    })).resolves.toMatchObject({ outcome: 'stale' })
    expect(db.sqlite.prepare(`
      SELECT DISTINCT index_generation, published_revision_id
      FROM full_text_fts WHERE content_id = ?
    `).all(republished.contentId)).toEqual([{
      index_generation: republished.indexGeneration,
      published_revision_id: republished.revisionId
    }])
    expect(db.sqlite.prepare(`
      SELECT status, last_error FROM full_text_job WHERE id = 'remove-delayed'
    `).get()).toEqual({
      status: 'stale',
      last_error: 'Content was republished before index removal'
    })
  })
})
