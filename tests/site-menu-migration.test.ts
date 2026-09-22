import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type NodeSqlite = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: unknown[]) => void
    get: (...params: unknown[]) => Record<string, unknown> | undefined
  }
  close: () => void
}

async function migrationSql(index: number) {
  const directory = resolve(import.meta.dirname, '../server/db/migrations')
  const filename = (await readdir(directory)).find(name => name.startsWith(`${String(index).padStart(4, '0')}_`) && name.endsWith('.sql'))
  if (!filename) throw new Error(`Migration ${index} not found`)
  return await readFile(resolve(directory, filename), 'utf8')
}

async function databaseBeforeSiteMenus() {
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(':memory:') as unknown as NodeSqlite
  for (let index = 0; index <= 7; index++) sqlite.exec(await migrationSql(index))
  return sqlite
}

describe('site menu migration', () => {
  it('creates menu and reference storage without taking an early legacy snapshot', async () => {
    const sqlite = await databaseBeforeSiteMenus()
    try {
      const sql = await migrationSql(8)
      sqlite.exec(sql)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+[`"]?site_menu_set/i)
      expect(sqlite.prepare('SELECT * FROM site_menu_set').get()).toBeUndefined()
      expect(sqlite.prepare('SELECT * FROM site_menu_reference').get()).toBeUndefined()
    } finally {
      sqlite.close()
    }
  })

  it('uniquely indexes the application-derived Unicode name key', async () => {
    const sqlite = await databaseBeforeSiteMenus()
    try {
      sqlite.exec(await migrationSql(8))
      const emptyDocument = JSON.stringify({ version: 1, items: [] })
      sqlite.prepare(`
        INSERT INTO site_menu_set
          (id, name, name_key, document_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run('uppercase-menu', 'Straße', 'strasse', emptyDocument)

      expect(() => sqlite.prepare(`
        INSERT INTO site_menu_set
          (id, name, name_key, document_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run('lowercase-menu', 'STRASSE', 'strasse', emptyDocument))
        .toThrow(/UNIQUE constraint failed: site_menu_set\.name_key/)
    } finally {
      sqlite.close()
    }
  })

  it('enforces normalized menu references with an ON DELETE RESTRICT foreign key', async () => {
    const sqlite = await databaseBeforeSiteMenus()
    try {
      sqlite.exec(await migrationSql(8))
      sqlite.exec('PRAGMA foreign_keys = ON')
      sqlite.prepare(`
        INSERT INTO site_menu_set
          (id, name, name_key, document_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, NULL, 1, 1)
      `).run('referenced-menu', 'Referenced', 'referenced', JSON.stringify({ version: 1, items: [] }))
      sqlite.prepare(`
        INSERT INTO site_menu_reference
          (owner_type, owner_id, slot, menu_set_id, label, created_at, updated_at)
        VALUES ('site-layout', 'layout-1', 'header', ?, 'Layout header', 1, 1)
      `).run('referenced-menu')

      expect(() => sqlite.prepare('DELETE FROM site_menu_set WHERE id = ?').run('referenced-menu'))
        .toThrow(/FOREIGN KEY constraint failed/)
      expect(sqlite.prepare('SELECT id FROM site_menu_set WHERE id = ?').get('referenced-menu'))
        .toEqual({ id: 'referenced-menu' })
    } finally {
      sqlite.close()
    }
  })
})
