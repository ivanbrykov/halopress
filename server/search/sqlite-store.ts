import type {
  SearchPreparedStatement,
  SearchStatementResult,
  SearchStore
} from '../../shared/search-store'
import { getLocalSqlite } from '../db/db'

type NodeSqlite = Awaited<ReturnType<typeof getLocalSqlite>>

class NodeSearchStatement implements SearchPreparedStatement {
  private values: unknown[] = []

  constructor(
    private readonly sqlite: NodeSqlite,
    private readonly query: string
  ) {}

  bind(...values: unknown[]) {
    const statement = new NodeSearchStatement(this.sqlite, this.query)
    statement.values = values
    return statement
  }

  async first<T>() {
    return (this.sqlite.prepare(this.query).get(...this.values as any[]) as T | undefined) ?? null
  }

  async all<T>() {
    return {
      success: true,
      results: this.sqlite.prepare(this.query).all(...this.values as any[]) as T[]
    }
  }

  async run<T>() {
    const result = this.sqlite.prepare(this.query).run(...this.values as any[])
    return {
      success: true,
      results: [] as T[],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid)
      }
    }
  }
}

export class NodeSqliteSearchStore implements SearchStore {
  constructor(readonly sqlite: NodeSqlite) {}

  prepare(query: string) {
    return new NodeSearchStatement(this.sqlite, query)
  }

  async batch<T>(statements: SearchPreparedStatement[]) {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results: Array<SearchStatementResult<T>> = []
      for (const statement of statements) results.push(await statement.run<T>())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  validateSchema() {
    const required = [
      'full_text_chunk',
      'full_text_control',
      'full_text_fts',
      'full_text_index_state',
      'full_text_job'
    ]
    const placeholders = required.map(() => '?').join(', ')
    const rows = this.sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE name IN (${placeholders})
      ORDER BY name
    `).all(...required) as Array<{ name: string }>
    const present = new Set(rows.map(row => row.name))
    const missing = required.filter(name => !present.has(name))
    if (missing.length) {
      throw new Error(
        `Node search schema is unavailable; apply migration 0011 before startup (missing: ${missing.join(', ')})`
      )
    }
  }
}

let localSearchStore: NodeSqliteSearchStore | null = null

export async function getNodeSqliteSearchStore() {
  if (!localSearchStore) {
    localSearchStore = new NodeSqliteSearchStore(await getLocalSqlite())
  }
  return localSearchStore
}
