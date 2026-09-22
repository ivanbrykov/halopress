import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy'
import * as tables from '../../server/db/schema'

type SqlMethod = 'run' | 'all' | 'values' | 'get'

type NodeSqlite = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: any[]) => { changes?: number; lastInsertRowid?: number }
    all: (...params: any[]) => any[]
    get: (...params: any[]) => any
  }
  close: () => void
}

type TestSqliteQuery = {
  sql: string
  params: any[]
  method: SqlMethod
}

export async function createTestSqliteDb(options: {
  path?: string
  onQueryStart?: (query: TestSqliteQuery) => void | Promise<void>
  onQueryEnd?: (query: TestSqliteQuery) => void | Promise<void>
} = {}) {
  const { DatabaseSync } = await import('node:sqlite')
  const path = options.path ?? ':memory:'

  if (path !== ':memory:') {
    await mkdir(dirname(path), { recursive: true })
    await rm(path, { force: true })
  }

  const sqlite = new DatabaseSync(path) as unknown as NodeSqlite
  sqlite.exec('PRAGMA foreign_keys = ON;')

  const callback = async (sql: string, params: any[], method: SqlMethod) => {
    const safeParams = params ?? []
    const query = { sql, params: safeParams, method }
    await options.onQueryStart?.(query)
    try {
      const stmt = sqlite.prepare(sql)
      if (method === 'run') {
        stmt.run(...safeParams)
        return { rows: [] }
      }
      if (method === 'get') {
        const row = stmt.get(...safeParams)
        return { rows: row ? Object.values(row) : undefined }
      }
      if (method === 'values') {
        return { rows: stmt.all(...safeParams).map(row => Object.values(row)) }
      }
      return { rows: stmt.all(...safeParams).map(row => Object.values(row)) }
    } finally {
      await options.onQueryEnd?.(query)
    }
  }

  return {
    db: drizzleProxy(callback as any, { schema: tables }),
    path,
    close: () => sqlite.close()
  }
}
