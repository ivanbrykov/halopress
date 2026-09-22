import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databases: DatabaseSync[] = []

async function migrationSql(index: number) {
  const prefix = String(index).padStart(4, '0')
  const directory = resolve(import.meta.dirname, '../server/db/migrations')
  const entries = await import('node:fs/promises').then(fs => fs.readdir(directory))
  const filename = entries.find(entry => entry.startsWith(`${prefix}_`) && entry.endsWith('.sql'))
  if (!filename) throw new Error(`Missing migration ${prefix}`)
  return await readFile(resolve(directory, filename), 'utf8')
}

async function databaseBeforeFullText() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  for (let index = 0; index <= 10; index++) {
    sqlite.exec((await migrationSql(index)).replaceAll('--> statement-breakpoint', ''))
  }
  return sqlite
}

afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

describe('Korean full-text migration', () => {
  it('upgrades existing search configuration and creates a real FTS5 table', async () => {
    const sqlite = await databaseBeforeFullText()
    sqlite.prepare(`
      INSERT INTO search_config (
        schema_key, field_id, field_key, kind, search_mode, filterable, sortable
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('article', 'field-title', 'title', 'string', 'exact', 1, 1)

    sqlite.exec((await migrationSql(11)).replaceAll('--> statement-breakpoint', ''))

    expect(sqlite.prepare(`
      SELECT full_text AS fullText
      FROM search_config
      WHERE schema_key = 'article' AND field_id = 'field-title'
    `).get()).toEqual({ fullText: 0 })
    const definition = sqlite.prepare(`
      SELECT sql FROM sqlite_master WHERE name = 'full_text_fts'
    `).get() as { sql: string }
    expect(definition.sql).toContain('CREATE VIRTUAL TABLE')
    expect(definition.sql).toContain('USING fts5')
  })

  it('matches pre-tokenized Korean morphology and exact technical raw terms', async () => {
    const sqlite = await databaseBeforeFullText()
    sqlite.exec((await migrationSql(11)).replaceAll('--> statement-breakpoint', ''))

    const insert = sqlite.prepare(`
      INSERT INTO full_text_fts (
        index_generation, content_id, schema_key, schema_version, field_id,
        published_revision_id, chunk_index, raw_text, morph_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      'generation-1',
      'content-korean',
      'article',
      1,
      'field-body',
      'revision-1',
      0,
      '학교에서 점심을 먹었다',
      '학교 점심 먹'
    )
    insert.run(
      'generation-2',
      'content-technical',
      'article',
      1,
      'field-body',
      'revision-2',
      0,
      'cloudflare workers ai bm25 code_123',
      'cloudflare workers ai bm25 code 123'
    )

    expect(sqlite.prepare(`
      SELECT content_id AS contentId
      FROM full_text_fts
      WHERE full_text_fts MATCH ?
    `).all('morph_text : "학교"')).toEqual([{ contentId: 'content-korean' }])
    expect(sqlite.prepare(`
      SELECT content_id AS contentId
      FROM full_text_fts
      WHERE full_text_fts MATCH ?
    `).all('morph_text : "먹"')).toEqual([{ contentId: 'content-korean' }])
    expect(sqlite.prepare(`
      SELECT content_id AS contentId
      FROM full_text_fts
      WHERE full_text_fts MATCH ?
    `).all('raw_text : "code_123"')).toEqual([{ contentId: 'content-technical' }])
  })
})
