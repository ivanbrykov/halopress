import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type NodeSqlite = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: unknown[]) => void
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    all: (...params: unknown[]) => Array<Record<string, unknown>>
  }
  close: () => void
}

async function migrationSql(index: number) {
  const directory = resolve(import.meta.dirname, '../server/db/migrations')
  const filename = (await readdir(directory)).find(name => name.startsWith(`${String(index).padStart(4, '0')}_`) && name.endsWith('.sql'))
  if (!filename) throw new Error(`Migration ${index} not found`)
  return await readFile(resolve(directory, filename), 'utf8')
}

async function databaseBeforeLayouts() {
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(':memory:') as unknown as NodeSqlite
  for (let index = 0; index <= 8; index++) sqlite.exec(await migrationSql(index))
  return sqlite
}

async function databaseBeforeLayoutAssignments() {
  const sqlite = await databaseBeforeLayouts()
  sqlite.exec(await migrationSql(9))
  return sqlite
}

describe('Layout migration', () => {
  it('creates empty resource and assignment-reference storage from the generated schema migration', async () => {
    const sqlite = await databaseBeforeLayouts()
    try {
      const sql = await migrationSql(9)
      sqlite.exec(sql)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+[`"]?site_layout_/i)
      expect(sqlite.prepare('SELECT * FROM site_layout_resource').get()).toBeUndefined()
      expect(sqlite.prepare('SELECT * FROM site_layout_reference').get()).toBeUndefined()
    } finally {
      sqlite.close()
    }
  })

  it('uniquely indexes the application-derived Layout name key', async () => {
    const sqlite = await databaseBeforeLayouts()
    try {
      sqlite.exec(await migrationSql(9))
      const document = JSON.stringify({ version: 1, layoutId: 'layout-one', name: 'Straße', grid: {}, elements: [] })
      sqlite.prepare(`
        INSERT INTO site_layout_resource
          (id, name, name_key, document_json, current_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, 1)
      `).run('layout-one', 'Straße', 'strasse', document)

      expect(() => sqlite.prepare(`
        INSERT INTO site_layout_resource
          (id, name, name_key, document_json, current_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, 1)
      `).run('layout-two', 'STRASSE', 'strasse', document))
        .toThrow(/UNIQUE constraint failed: site_layout_resource\.name_key/)
    } finally {
      sqlite.close()
    }
  })

  it('enforces normalized Layout references with an ON DELETE RESTRICT foreign key', async () => {
    const sqlite = await databaseBeforeLayouts()
    try {
      sqlite.exec(await migrationSql(9))
      sqlite.exec('PRAGMA foreign_keys = ON')
      sqlite.prepare(`
        INSERT INTO site_layout_resource
          (id, name, name_key, document_json, current_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, 1)
      `).run('layout-one', 'Referenced', 'referenced', '{}')
      sqlite.prepare(`
        INSERT INTO site_layout_reference
          (owner_type, owner_id, slot, layout_id, label, behavior, created_at, updated_at)
        VALUES ('page', 'home-page', 'working', ?, 'Home Page working Layout', 'use-current', 1, 1)
      `).run('layout-one')

      expect(() => sqlite.prepare('DELETE FROM site_layout_resource WHERE id = ?').run('layout-one'))
        .toThrow(/FOREIGN KEY constraint failed/)
      expect(sqlite.prepare('SELECT id FROM site_layout_resource WHERE id = ?').get('layout-one'))
        .toEqual({ id: 'layout-one' })
    } finally {
      sqlite.close()
    }
  })
})

describe('Layout assignment migration', () => {
  it('preserves Page and publication snapshots while adding nullable Layout metadata without direct foreign keys', async () => {
    const sqlite = await databaseBeforeLayoutAssignments()
    try {
      const workingContent = '{"type":"doc","content":[{"type":"paragraph"}]}'
      const publishedContent = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Published"}]}]}'
      sqlite.prepare(`
        INSERT INTO page
          (id, title, status, content_json, current_revision, published_revision_id, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, 4, ?, 1000, 2000)
      `).run('legacy-page', 'Legacy page', workingContent, 'legacy-publication')
      sqlite.prepare(`
        INSERT INTO publication_revision
          (id, document_kind, document_id, title, content_json, created_by, created_at)
        VALUES (?, 'page', ?, ?, ?, ?, 1500)
      `).run('legacy-publication', 'legacy-page', 'Published page', publishedContent, 'legacy-admin')

      const pageBefore = sqlite.prepare(`
        SELECT id, title, status, content_json, current_revision, published_revision_id, created_at, updated_at
        FROM page WHERE id = 'legacy-page'
      `).get()
      const revisionBefore = sqlite.prepare(`
        SELECT id, document_kind, document_id, title, content_json, created_by, created_at
        FROM publication_revision WHERE id = 'legacy-publication'
      `).get()

      const migration = await migrationSql(10)
      sqlite.exec(migration)

      expect(migration).toContain('ALTER TABLE `page` ADD `layout_id` text')
      expect(migration).toContain('ALTER TABLE `publication_revision` ADD `layout_id` text')
      expect(migration).not.toMatch(/layout_id[^;]*REFERENCES/i)
      expect(sqlite.prepare(`
        SELECT id, title, status, content_json, current_revision, published_revision_id, created_at, updated_at
        FROM page WHERE id = 'legacy-page'
      `).get()).toEqual(pageBefore)
      expect(sqlite.prepare(`
        SELECT id, document_kind, document_id, title, content_json, created_by, created_at
        FROM publication_revision WHERE id = 'legacy-publication'
      `).get()).toEqual(revisionBefore)
      expect(sqlite.prepare(`SELECT layout_id FROM page WHERE id = 'legacy-page'`).get())
        .toEqual({ layout_id: null })
      expect(sqlite.prepare(`SELECT layout_id FROM publication_revision WHERE id = 'legacy-publication'`).get())
        .toEqual({ layout_id: null })

      const pageLayoutColumn = sqlite.prepare(`PRAGMA table_info('page')`).all()
        .find(column => column.name === 'layout_id')
      const publicationLayoutColumn = sqlite.prepare(`PRAGMA table_info('publication_revision')`).all()
        .find(column => column.name === 'layout_id')
      expect(pageLayoutColumn).toMatchObject({ type: 'TEXT', notnull: 0 })
      expect(publicationLayoutColumn).toMatchObject({ type: 'TEXT', notnull: 0 })
      expect(sqlite.prepare(`PRAGMA foreign_key_list('page')`).all()
        .some(foreignKey => foreignKey.from === 'layout_id')).toBe(false)
      expect(sqlite.prepare(`PRAGMA foreign_key_list('publication_revision')`).all()
        .some(foreignKey => foreignKey.from === 'layout_id')).toBe(false)

      expect(() => sqlite.prepare(`UPDATE page SET layout_id = ? WHERE id = 'legacy-page'`)
        .run('historical-layout-without-resource')).not.toThrow()
      expect(() => sqlite.prepare(`UPDATE publication_revision SET layout_id = ? WHERE id = 'legacy-publication'`)
        .run('historical-layout-without-resource')).not.toThrow()
    } finally {
      sqlite.close()
    }
  })
})
