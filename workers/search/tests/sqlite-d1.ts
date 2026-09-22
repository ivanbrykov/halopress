import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { NodeSqliteSearchStore } from '../../../server/search/sqlite-store'

export class SqliteD1 extends NodeSqliteSearchStore {
  constructor(readonly sqlite = new DatabaseSync(':memory:')) {
    super(sqlite as any)
  }

  close() {
    this.sqlite.close()
  }
}

export async function applyMigrations(db: SqliteD1) {
  const directory = resolve(import.meta.dirname, '../../../server/db/migrations')
  const migrations = (await readdir(directory))
    .filter(filename => /^\d{4}_.+\.sql$/.test(filename))
    .sort()
  for (const filename of migrations) {
    const sql = await readFile(resolve(directory, filename), 'utf8')
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map(value => value.trim())
      .filter(Boolean)) {
      db.sqlite.exec(statement)
    }
  }
}
