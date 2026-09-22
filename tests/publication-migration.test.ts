import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const databases: Array<{ close: () => void }> = []

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

async function openLegacyDatabase() {
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  const root = resolve(import.meta.dirname, '..')
  const baseline = await readFile(resolve(root, 'server/db/migrations/0000_restore_materialized_search_index.sql'), 'utf8')
  sqlite.exec(baseline.replaceAll('--> statement-breakpoint', ''))

  sqlite.exec(`
    INSERT INTO asset (id, kind, status, object_key, mime_type, size_bytes, created_at)
    VALUES
      ('live-asset', 'image', 'ready', 'live', 'image/png', 1, 1000),
      ('html-asset', 'image', 'ready', 'html', 'image/png', 1, 1000),
      ('markdown-asset', 'image', 'ready', 'markdown', 'image/png', 1, 1000),
      ('query-asset', 'image', 'ready', 'query', 'image/png', 1, 1000),
      ('01KENCODED', 'image', 'ready', 'encoded', 'image/png', 1, 1000),
      ('external', 'image', 'ready', 'external', 'image/png', 1, 1000),
      ('prefix-asset', 'image', 'ready', 'prefix', 'image/png', 1, 1000),
      ('page-asset', 'image', 'ready', 'page', 'image/png', 1, 1000);

    INSERT INTO schema (schema_key, version, title, ast_json, json_schema, registry_json, created_at)
    VALUES ('article', 1, 'Article', '{"fields":[]}', '{"type":"object"}', '{"fields":[],"relations":[]}', 1000);

    INSERT INTO content (id, schema_key, schema_version, status, content_json, created_at, updated_at)
    VALUES
      ('published-content', 'article', 1, 'published', '{"title":"Live","cover":"/assets/live-asset/raw","query":"/assets/query-asset/raw?width=1200","encoded":"/assets/01%4BENCODED/raw","embedded":"<img src=\\"/assets/html-asset/raw\\"> ![Markdown](/assets/markdown-asset/raw#body)","nearMiss":"prefix/assets/prefix-asset/raw https://example.com/assets/external/raw"}', 1000, 2000),
      ('draft-content', 'article', 1, 'draft', '{"title":"Draft"}', 1000, 3000);

    INSERT INTO content_listing (content_id, schema_key, schema_version, title, status, created_at, updated_at)
    VALUES
      ('published-content', 'article', 1, 'Live', 'published', 1000, 2000),
      ('draft-content', 'article', 1, 'Draft', 'draft', 1000, 3000);

    INSERT INTO content_search_data (content_id, field_id, data_type, text)
    VALUES ('published-content', 'title-field', 'text', 'Live');

    INSERT INTO content_ref (content_id, field_path, target_kind, target_id)
    VALUES ('published-content', 'cover', 'asset', 'live-asset');

    INSERT INTO page (id, title, status, content_json, created_at, updated_at)
    VALUES
      ('published-page', 'Public Page', 'published', '{"type":"doc","content":[{"type":"image","attrs":{"src":"/assets/page-asset/raw#hero"}}]}', 1000, 2500),
      ('draft-page', 'Draft Page', 'draft', '{"type":"doc"}', 1000, 3500);
  `)
  return sqlite
}

describe('preserve published revisions migration', () => {
  it('backfills published pointers, immutable snapshots, scoped projections, and assets without changing IDs or JSON', async () => {
    const sqlite = await openLegacyDatabase()
    const root = resolve(import.meta.dirname, '..')
    const migration = await readFile(resolve(root, 'server/db/migrations/0003_preserve_published_revisions.sql'), 'utf8')
    sqlite.exec(migration.replaceAll('--> statement-breakpoint', ''))

    const published = sqlite.prepare(`
      SELECT id, content_json, published_revision_id, first_published_at, published_at
      FROM content WHERE id = 'published-content'
    `).get() as any
    expect(published).toEqual({
      id: 'published-content',
      content_json: '{"title":"Live","cover":"/assets/live-asset/raw","query":"/assets/query-asset/raw?width=1200","encoded":"/assets/01%4BENCODED/raw","embedded":"<img src=\\"/assets/html-asset/raw\\"> ![Markdown](/assets/markdown-asset/raw#body)","nearMiss":"prefix/assets/prefix-asset/raw https://example.com/assets/external/raw"}',
      published_revision_id: 'legacy:content:published-content',
      first_published_at: 2000,
      published_at: 2000
    })

    expect(sqlite.prepare(`SELECT published_revision_id FROM content WHERE id = 'draft-content'`).get()).toEqual({
      published_revision_id: null
    })
    expect(sqlite.prepare(`SELECT id, document_kind, document_id, content_json FROM publication_revision ORDER BY id`).all()).toEqual([
      {
        id: 'legacy:content:published-content',
        document_kind: 'content',
        document_id: 'published-content',
        content_json: '{"title":"Live","cover":"/assets/live-asset/raw","query":"/assets/query-asset/raw?width=1200","encoded":"/assets/01%4BENCODED/raw","embedded":"<img src=\\"/assets/html-asset/raw\\"> ![Markdown](/assets/markdown-asset/raw#body)","nearMiss":"prefix/assets/prefix-asset/raw https://example.com/assets/external/raw"}'
      },
      {
        id: 'legacy:page:published-page',
        document_kind: 'page',
        document_id: 'published-page',
        content_json: '{"type":"doc","content":[{"type":"image","attrs":{"src":"/assets/page-asset/raw#hero"}}]}'
      }
    ])

    expect(sqlite.prepare(`SELECT content_id, projection_scope, title, status FROM content_listing ORDER BY content_id, projection_scope`).all()).toEqual([
      { content_id: 'draft-content', projection_scope: 'working', title: 'Draft', status: 'draft' },
      { content_id: 'published-content', projection_scope: 'published', title: 'Live', status: 'published' },
      { content_id: 'published-content', projection_scope: 'working', title: 'Live', status: 'published' }
    ])
    expect(sqlite.prepare(`SELECT document_kind, document_id, projection_scope, asset_id FROM document_asset_ref ORDER BY document_kind, document_id, projection_scope, asset_id`).all()).toEqual([
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'published', asset_id: '01KENCODED' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'published', asset_id: 'html-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'published', asset_id: 'live-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'published', asset_id: 'markdown-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'published', asset_id: 'query-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'working', asset_id: '01KENCODED' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'working', asset_id: 'html-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'working', asset_id: 'live-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'working', asset_id: 'markdown-asset' },
      { document_kind: 'content', document_id: 'published-content', projection_scope: 'working', asset_id: 'query-asset' },
      { document_kind: 'page', document_id: 'published-page', projection_scope: 'published', asset_id: 'page-asset' },
      { document_kind: 'page', document_id: 'published-page', projection_scope: 'working', asset_id: 'page-asset' }
    ])
    expect(sqlite.prepare(`SELECT count(*) AS count FROM document_asset_ref WHERE asset_id LIKE '%25%' OR asset_id IN ('external', 'prefix-asset')`).get()).toEqual({ count: 0 })
  })

  it('backfills editorial revision one and conservative publication permissions', async () => {
    const sqlite = await openLegacyDatabase()
    const root = resolve(import.meta.dirname, '..')
    for (const name of [
      '0001_add_installation_state.sql',
      '0002_add_browser_setup_session.sql',
      '0003_preserve_published_revisions.sql',
      '0004_add_editorial_safety_revisions.sql'
    ]) {
      const migration = await readFile(resolve(root, 'server/db/migrations', name), 'utf8')
      sqlite.exec(migration.replaceAll('--> statement-breakpoint', ''))
    }

    sqlite.exec(`
      INSERT INTO user_role (role_key, title, level) VALUES ('writer', 'Writer', 50);
      INSERT INTO schema_role (schema_key, role_key, can_read, can_write, can_admin)
      VALUES ('article', 'writer', true, true, false);
    `)

    expect(sqlite.prepare(`
      SELECT document_kind, document_id, revision, action, status, snapshot_json
      FROM document_revision ORDER BY document_kind, document_id
    `).all()).toEqual([
      {
        document_kind: 'content',
        document_id: 'draft-content',
        revision: 1,
        action: 'backfill',
        status: 'draft',
        snapshot_json: '{"title":"Draft"}'
      },
      {
        document_kind: 'content',
        document_id: 'published-content',
        revision: 1,
        action: 'backfill',
        status: 'published',
        snapshot_json: '{"title":"Live","cover":"/assets/live-asset/raw","query":"/assets/query-asset/raw?width=1200","encoded":"/assets/01%4BENCODED/raw","embedded":"<img src=\\"/assets/html-asset/raw\\"> ![Markdown](/assets/markdown-asset/raw#body)","nearMiss":"prefix/assets/prefix-asset/raw https://example.com/assets/external/raw"}'
      },
      {
        document_kind: 'page',
        document_id: 'draft-page',
        revision: 1,
        action: 'backfill',
        status: 'draft',
        snapshot_json: '{"type":"doc"}'
      },
      {
        document_kind: 'page',
        document_id: 'published-page',
        revision: 1,
        action: 'backfill',
        status: 'published',
        snapshot_json: '{"type":"doc","content":[{"type":"image","attrs":{"src":"/assets/page-asset/raw#hero"}}]}'
      }
    ])

    expect(sqlite.prepare(`
      SELECT can_write, can_publish, can_archive, can_delete
      FROM schema_role WHERE schema_key = 'article' AND role_key = 'writer'
    `).get()).toEqual({ can_write: 1, can_publish: 0, can_archive: 0, can_delete: 0 })
  })
})
