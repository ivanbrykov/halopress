import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type NodeSqlite = {
  exec: (sql: string) => void
  prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> }
  close: () => void
}

async function migrationSql(index: number) {
  const directory = resolve(import.meta.dirname, '../server/db/migrations')
  const filename = (await readdir(directory)).find(name => name.startsWith(`${String(index).padStart(4, '0')}_`) && name.endsWith('.sql'))
  if (!filename) throw new Error(`Migration ${index} not found`)
  return await readFile(resolve(directory, filename), 'utf8')
}

async function databaseBeforePublicRoutes() {
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(':memory:') as unknown as NodeSqlite
  for (let index = 0; index <= 6; index++) sqlite.exec(await migrationSql(index))
  return sqlite
}

describe('public route migration', () => {
  it('backfills only published identities and leaves reserved legacy schemas unreachable', async () => {
    const sqlite = await databaseBeforePublicRoutes()
    try {
      sqlite.exec(`
        INSERT INTO schema_active (schema_key, active_version, updated_at, status)
        VALUES ('article', 1, 1000, 'active'), ('private', 1, 1000, 'active'), ('api', 1, 1000, 'active');
        INSERT INTO content (id, schema_key, schema_version, status, content_json, published_revision_id, created_at, updated_at)
        VALUES
          ('CONTENT01', 'article', 1, 'draft', '{}', 'REV01', 800, 1000),
          ('DRAFT01', 'article', 1, 'draft', '{}', NULL, 800, 1000),
          ('PRIVATE01', 'private', 1, 'published', '{}', 'REV02', 800, 1000),
          ('API01', 'api', 1, 'published', '{}', 'REV03', 800, 1000);
        INSERT INTO page (id, title, status, content_json, published_revision_id, created_at, updated_at)
        VALUES
          ('PAGE01', 'Page', 'draft', '{}', 'PREV01', 800, 1000),
          ('DRAFTPAGE', 'Draft', 'draft', '{}', NULL, 800, 1000),
          ('DELETEDPAGE', 'Deleted', 'deleted', '{}', 'PREV02', 800, 1000);
      `)
      sqlite.exec(await migrationSql(7))

      const routes = sqlite.prepare('SELECT path, document_kind, document_id FROM public_route ORDER BY path').all()
      expect(routes).toEqual([
        { path: '/article', document_kind: 'schema', document_id: 'article' },
        { path: '/article/content01', document_kind: 'content', document_id: 'CONTENT01' },
        { path: '/p/page01', document_kind: 'page', document_id: 'PAGE01' },
        { path: '/private', document_kind: 'schema', document_id: 'private' },
        { path: '/private/private01', document_kind: 'content', document_id: 'PRIVATE01' }
      ])
    } finally {
      sqlite.close()
    }
  })

  it('fails loudly instead of silently omitting case-folded route collisions', async () => {
    const sqlite = await databaseBeforePublicRoutes()
    try {
      sqlite.exec(`
        INSERT INTO page (id, title, status, content_json, published_revision_id, created_at, updated_at)
        VALUES
          ('PAGE', 'Upper', 'published', '{}', 'REV-UPPER', 800, 1000),
          ('page', 'Lower', 'published', '{}', 'REV-LOWER', 800, 1000);
      `)
      const sql = await migrationSql(7)
      expect(() => sqlite.exec(sql)).toThrow(/UNIQUE constraint failed: public_route\.path/)
    } finally {
      sqlite.close()
    }
  })
})
