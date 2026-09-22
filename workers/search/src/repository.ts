import { KOREAN_SEARCH_TOKENIZER_GENERATION } from '@halopress/korean-search-tokenizer'
import type {
  SearchPreparedStatement,
  SearchStore
} from '../../../shared/search-store'

export type FullTextJobRow = {
  id: string
  operation: 'index' | 'remove' | 'schema-sync' | 'reindex' | 'reindex-sync'
  document_id: string
  schema_key: string | null
  schema_version: number | null
  field_id: string
  target_revision_id: string | null
  tokenizer_generation: string
  index_generation: string
  status: string
  checkpoint: number
  total_chunks: number | null
  attempt_count: number
}

export type IndexTargetRow = {
  content_json: string
  registry_json: string
  published_revision_id: string
  schema_version: number
  current_status: string
  current_revision_id: string | null
  full_text: number
}

function epochSeconds(date = Date.now()) {
  return Math.floor(date / 1000)
}

export async function claimFullTextJob(db: SearchStore, id: string, now = epochSeconds()) {
  return await db.prepare(`
    UPDATE full_text_job
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        lease_expires_at = ?,
        updated_at = ?
    WHERE id = ?
      AND tokenizer_generation = ?
      AND (
        (status = 'pending' AND available_at <= ?)
        OR (status = 'processing' AND lease_expires_at < ?)
      )
    RETURNING *
  `).bind(
    now + 5 * 60,
    now,
    id,
    KOREAN_SEARCH_TOKENIZER_GENERATION,
    now,
    now
  ).first<FullTextJobRow>()
}

export async function loadIndexTarget(db: SearchStore, job: FullTextJobRow) {
  return await db.prepare(`
    SELECT
      pr.content_json,
      s.registry_json,
      pr.schema_version,
      pr.id AS published_revision_id,
      c.status AS current_status,
      c.published_revision_id AS current_revision_id,
      sc.full_text
    FROM publication_revision pr
    JOIN content c
      ON c.id = pr.document_id
    JOIN schema s
      ON s.schema_key = pr.schema_key
     AND s.version = pr.schema_version
    JOIN search_config sc
      ON sc.schema_key = pr.schema_key
     AND sc.field_id = ?
    WHERE pr.id = ?
      AND pr.document_kind = 'content'
      AND pr.document_id = ?
      AND pr.schema_key = ?
    LIMIT 1
  `).bind(
    job.field_id,
    job.target_revision_id,
    job.document_id,
    job.schema_key
  ).first<IndexTargetRow>()
}

export async function targetStillEligible(db: SearchStore, job: FullTextJobRow) {
  const row = await db.prepare(`
    SELECT 1 AS eligible
    FROM content c
    JOIN search_config sc
      ON sc.schema_key = c.schema_key
     AND sc.field_id = ?
     AND sc.full_text = 1
    WHERE c.id = ?
      AND c.status = 'published'
      AND c.published_revision_id = ?
    LIMIT 1
  `).bind(job.field_id, job.document_id, job.target_revision_id).first<{ eligible: number }>()
  return row?.eligible === 1
}

export async function initializeIndexBuild(
  db: SearchStore,
  job: FullTextJobRow,
  target: IndexTargetRow,
  totalChunks: number
) {
  const now = epochSeconds()
  const statements: SearchPreparedStatement[] = []
  if (job.checkpoint === 0) {
    statements.push(db.prepare(`
      DELETE FROM full_text_chunk WHERE index_generation = ?
    `).bind(job.index_generation))
  }
  statements.push(db.prepare(`
    INSERT INTO full_text_index_state (
      content_id, schema_key, schema_version, field_id,
      published_revision_id, tokenizer_generation,
      active_index_generation, building_index_generation,
      status, indexed_chunks, total_chunks, attempt_count,
      last_error, updated_at, activated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'building', ?, ?, ?, NULL, ?, NULL)
    ON CONFLICT(content_id, field_id) DO UPDATE SET
      schema_key = excluded.schema_key,
      schema_version = excluded.schema_version,
      published_revision_id = excluded.published_revision_id,
      tokenizer_generation = excluded.tokenizer_generation,
      building_index_generation = excluded.building_index_generation,
      status = 'building',
      indexed_chunks = excluded.indexed_chunks,
      total_chunks = excluded.total_chunks,
      attempt_count = excluded.attempt_count,
      last_error = NULL,
      updated_at = excluded.updated_at
  `).bind(
    job.document_id,
    job.schema_key,
    target.schema_version,
    job.field_id,
    job.target_revision_id,
    job.tokenizer_generation,
    job.index_generation,
    job.checkpoint,
    totalChunks,
    job.attempt_count,
    now
  ))
  statements.push(db.prepare(`
    UPDATE full_text_job
    SET total_chunks = ?, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(totalChunks, now, job.id))
  await db.batch(statements)
}

export async function storeAnalyzedChunk(args: {
  db: SearchStore
  job: FullTextJobRow
  target: IndexTargetRow
  chunkIndex: number
  totalChunks: number
  rawText: string
  morphText: string
}) {
  const now = epochSeconds()
  await args.db.batch([
    args.db.prepare(`
      INSERT INTO full_text_chunk (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index,
        raw_text, morph_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(index_generation, chunk_index) DO UPDATE SET
        raw_text = excluded.raw_text,
        morph_text = excluded.morph_text,
        created_at = excluded.created_at
    `).bind(
      args.job.index_generation,
      args.job.document_id,
      args.job.schema_key,
      args.target.schema_version,
      args.job.field_id,
      args.job.target_revision_id,
      args.chunkIndex,
      args.rawText,
      args.morphText,
      now
    ),
    args.db.prepare(`
      UPDATE full_text_job
      SET checkpoint = ?, total_chunks = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(args.chunkIndex + 1, args.totalChunks, now + 5 * 60, now, args.job.id),
    args.db.prepare(`
      UPDATE full_text_index_state
      SET indexed_chunks = ?, total_chunks = ?, updated_at = ?
      WHERE content_id = ? AND field_id = ? AND building_index_generation = ?
    `).bind(
      args.chunkIndex + 1,
      args.totalChunks,
      now,
      args.job.document_id,
      args.job.field_id,
      args.job.index_generation
    )
  ])
}

export async function activateIndexGeneration(
  db: SearchStore,
  job: FullTextJobRow,
  target: IndexTargetRow,
  totalChunks: number
) {
  const now = epochSeconds()
  await db.batch([
    // If publication, field eligibility, or generation ownership changed
    // after the last precheck, this attempts to duplicate the singleton
    // control key and aborts the entire D1 batch before any active FTS rows
    // are replaced.
    db.prepare(`
      INSERT INTO full_text_control (
        key, tokenizer_generation, query_epoch, status, updated_at
      )
      SELECT 'singleton', ?, 1, 'available', ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM content c
        JOIN search_config sc
          ON sc.schema_key = c.schema_key
         AND sc.field_id = ?
         AND sc.full_text = 1
        WHERE c.id = ?
          AND c.status = 'published'
          AND c.published_revision_id = ?
      )
      OR NOT EXISTS (
        SELECT 1
        FROM full_text_index_state state
        WHERE state.content_id = ?
          AND state.field_id = ?
          AND state.building_index_generation = ?
          AND state.published_revision_id = ?
      )
    `).bind(
      job.tokenizer_generation,
      now,
      job.field_id,
      job.document_id,
      job.target_revision_id,
      job.document_id,
      job.field_id,
      job.index_generation,
      job.target_revision_id
    ),
    db.prepare(`
      DELETE FROM full_text_fts WHERE content_id = ? AND field_id = ?
    `).bind(job.document_id, job.field_id),
    db.prepare(`
      INSERT INTO full_text_fts (
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index, raw_text, morph_text
      )
      SELECT
        index_generation, content_id, schema_key, schema_version,
        field_id, published_revision_id, chunk_index, raw_text, morph_text
      FROM full_text_chunk
      WHERE index_generation = ?
      ORDER BY chunk_index
    `).bind(job.index_generation),
    db.prepare(`
      UPDATE full_text_index_state
      SET active_index_generation = ?,
          building_index_generation = NULL,
          status = 'ready',
          indexed_chunks = ?,
          total_chunks = ?,
          last_error = NULL,
          updated_at = ?,
          activated_at = ?
      WHERE content_id = ?
        AND field_id = ?
        AND building_index_generation = ?
        AND published_revision_id = ?
    `).bind(
      job.index_generation,
      totalChunks,
      totalChunks,
      now,
      now,
      job.document_id,
      job.field_id,
      job.index_generation,
      job.target_revision_id
    ),
    db.prepare(`
      DELETE FROM full_text_chunk WHERE index_generation = ?
    `).bind(job.index_generation),
    db.prepare(`
      UPDATE full_text_job
      SET status = 'ready',
          checkpoint = ?,
          total_chunks = ?,
          lease_expires_at = NULL,
          last_error = NULL,
          updated_at = ?,
          completed_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(totalChunks, totalChunks, now, now, job.id),
    db.prepare(`
      UPDATE full_text_control
      SET tokenizer_generation = ?,
          query_epoch = query_epoch + 1,
          status = 'available',
          updated_at = ?
      WHERE key = 'singleton'
    `).bind(job.tokenizer_generation, now)
  ])
}

export async function removeContentIndex(db: SearchStore, job: FullTextJobRow) {
  const now = epochSeconds()
  await db.batch([
    db.prepare(`
      DELETE FROM full_text_fts
      WHERE content_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM content current
          WHERE current.id = ? AND current.status = 'published'
        )
    `).bind(job.document_id, job.document_id),
    db.prepare(`
      DELETE FROM full_text_chunk
      WHERE content_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM content current
          WHERE current.id = ? AND current.status = 'published'
        )
    `).bind(job.document_id, job.document_id),
    db.prepare(`
      DELETE FROM full_text_index_state
      WHERE content_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM content current
          WHERE current.id = ? AND current.status = 'published'
        )
    `).bind(job.document_id, job.document_id),
    db.prepare(`
      UPDATE full_text_job
      SET status = CASE
            WHEN EXISTS (
              SELECT 1 FROM content current
              WHERE current.id = ? AND current.status = 'published'
            ) THEN 'stale'
            ELSE 'ready'
          END,
          lease_expires_at = NULL,
          last_error = CASE
            WHEN EXISTS (
              SELECT 1 FROM content current
              WHERE current.id = ? AND current.status = 'published'
            ) THEN 'Content was republished before index removal'
            ELSE NULL
          END,
          updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(job.document_id, job.document_id, now, now, job.id),
    db.prepare(`
      UPDATE full_text_control
      SET query_epoch = query_epoch + 1, updated_at = ?
      WHERE key = 'singleton'
        AND NOT EXISTS (
          SELECT 1 FROM content current
          WHERE current.id = ? AND current.status = 'published'
        )
    `).bind(now, job.document_id)
  ])
  const completed = await db.prepare(`
    SELECT status FROM full_text_job WHERE id = ?
  `).bind(job.id).first<{ status: string }>()
  return completed?.status === 'ready' ? 'removed' as const : 'stale' as const
}

export async function markJobStale(db: SearchStore, job: FullTextJobRow, reason: string) {
  const now = epochSeconds()
  await db.batch([
    db.prepare(`DELETE FROM full_text_chunk WHERE index_generation = ?`).bind(job.index_generation),
    db.prepare(`
      UPDATE full_text_index_state
      SET building_index_generation = NULL,
          status = CASE WHEN active_index_generation IS NULL THEN 'stale' ELSE 'ready' END,
          last_error = ?, updated_at = ?
      WHERE content_id = ? AND field_id = ? AND building_index_generation = ?
    `).bind(reason, now, job.document_id, job.field_id, job.index_generation),
    db.prepare(`
      UPDATE full_text_job
      SET status = 'stale', lease_expires_at = NULL, last_error = ?,
          updated_at = ?, completed_at = ?
      WHERE id = ?
    `).bind(reason, now, now, job.id)
  ])
}

export async function markJobRetry(db: SearchStore, job: FullTextJobRow, error: unknown) {
  const now = epochSeconds()
  const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
  const terminal = job.attempt_count >= 5
  const delay = Math.min(15 * 60, 2 ** Math.max(0, job.attempt_count - 1) * 15)
  await db.batch([
    db.prepare(`
      UPDATE full_text_job
      SET status = ?, available_at = ?, lease_expires_at = NULL,
          last_error = ?, updated_at = ?
      WHERE id = ?
    `).bind(terminal ? 'failed' : 'pending', now + delay, message, now, job.id),
    db.prepare(`
      UPDATE full_text_index_state
      SET status = ?, last_error = ?, updated_at = ?
      WHERE content_id = ? AND field_id = ? AND building_index_generation = ?
    `).bind(terminal ? 'failed' : 'pending', message, now, job.document_id, job.field_id, job.index_generation)
  ])
  return { terminal, delay }
}

export async function markJobFailed(db: SearchStore, job: FullTextJobRow, error: unknown) {
  const now = epochSeconds()
  const message = error instanceof Error
    ? error.message.slice(0, 2000)
    : String(error).slice(0, 2000)
  await db.batch([
    db.prepare(`
      UPDATE full_text_job
      SET status = 'failed', lease_expires_at = NULL,
          last_error = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).bind(message, now, now, job.id),
    db.prepare(`
      UPDATE full_text_index_state
      SET status = 'failed', last_error = ?, updated_at = ?
      WHERE content_id = ? AND field_id = ? AND building_index_generation = ?
    `).bind(message, now, job.document_id, job.field_id, job.index_generation)
  ])
}

export async function pendingJobIds(db: SearchStore, limit = 50) {
  const now = epochSeconds()
  const rows = await db.prepare(`
    SELECT id
    FROM full_text_job
    WHERE (status = 'pending' AND available_at <= ?)
       OR (status = 'processing' AND lease_expires_at < ?)
    ORDER BY created_at, id
    LIMIT ?
  `).bind(now, now, limit).all<{ id: string }>()
  return (rows.results ?? []).map(row => row.id)
}

export async function reconcileSchemaJobs(db: SearchStore, job: FullTextJobRow) {
  const now = epochSeconds()
  const candidates = await db.prepare(`
    SELECT
      c.id AS content_id,
      c.published_revision_id,
      cl.schema_version,
      sc.field_id
    FROM content c
    JOIN content_listing cl
      ON cl.content_id = c.id
     AND cl.projection_scope = 'published'
     AND cl.status = 'published'
    JOIN search_config sc
      ON sc.schema_key = c.schema_key
     AND sc.full_text = 1
    WHERE c.schema_key = ?
      AND c.status = 'published'
      AND c.published_revision_id IS NOT NULL
    ORDER BY c.id, sc.field_id
  `).bind(job.schema_key).all<{
    content_id: string
    published_revision_id: string
    schema_version: number
    field_id: string
  }>()

  const dispatchIds: string[] = []
  const forceReindex = job.operation === 'reindex-sync'
  for (const candidate of candidates.results ?? []) {
    const identity = [
      forceReindex ? 'reindex' : 'index',
      candidate.content_id,
      candidate.field_id,
      candidate.published_revision_id,
      KOREAN_SEARCH_TOKENIZER_GENERATION,
      ...(forceReindex ? [job.id] : [])
    ].join(':')
    const id = crypto.randomUUID()
    const generation = crypto.randomUUID()
    const inserted = await db.prepare(`
      INSERT INTO full_text_job (
        id, identity_key, operation, document_kind, document_id,
        schema_key, schema_version, field_id, target_revision_id,
        tokenizer_generation, index_generation, status, checkpoint,
        total_chunks, attempt_count, available_at, lease_expires_at,
        last_error, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, 'content', ?, ?, ?, ?, ?, ?, ?, 'pending',
        0, NULL, 0, ?, NULL, NULL, ?, ?, NULL)
      ON CONFLICT(identity_key) DO NOTHING
      RETURNING id
    `).bind(
      id,
      identity,
      forceReindex ? 'reindex' : 'index',
      candidate.content_id,
      job.schema_key,
      candidate.schema_version,
      candidate.field_id,
      candidate.published_revision_id,
      KOREAN_SEARCH_TOKENIZER_GENERATION,
      generation,
      now,
      now,
      now
    ).first<{ id: string }>()
    if (inserted?.id) dispatchIds.push(inserted.id)
  }

  await db.batch([
    db.prepare(`
      DELETE FROM full_text_fts
      WHERE schema_key = ?
        AND (
          NOT EXISTS (
            SELECT 1 FROM search_config sc
            WHERE sc.schema_key = full_text_fts.schema_key
              AND sc.field_id = full_text_fts.field_id
              AND sc.full_text = 1
          )
          OR NOT EXISTS (
            SELECT 1 FROM content c
            WHERE c.id = full_text_fts.content_id
              AND c.status = 'published'
              AND c.published_revision_id = full_text_fts.published_revision_id
          )
        )
    `).bind(job.schema_key),
    db.prepare(`
      DELETE FROM full_text_index_state
      WHERE schema_key = ?
        AND (
          NOT EXISTS (
            SELECT 1 FROM search_config sc
            WHERE sc.schema_key = full_text_index_state.schema_key
              AND sc.field_id = full_text_index_state.field_id
              AND sc.full_text = 1
          )
          OR NOT EXISTS (
            SELECT 1 FROM content c
            WHERE c.id = full_text_index_state.content_id
              AND c.status = 'published'
              AND c.published_revision_id = full_text_index_state.published_revision_id
          )
        )
    `).bind(job.schema_key),
    db.prepare(`
      UPDATE full_text_job
      SET status = 'ready', lease_expires_at = NULL, last_error = NULL,
          updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(now, now, job.id),
    db.prepare(`
      UPDATE full_text_control
      SET query_epoch = query_epoch + 1, updated_at = ?
      WHERE key = 'singleton'
    `).bind(now)
  ])
  return dispatchIds
}
