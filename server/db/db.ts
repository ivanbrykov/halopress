import { join } from 'node:path'
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy'
import type { H3Event } from 'h3'

import * as tables from './schema'

type D1Database = {
  exec: (sql: string) => Promise<unknown>
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => {
      first: <T>() => Promise<T | null>
      all: <T>() => Promise<{ results?: T[] }>
    }
  }
}

type SqlMethod = 'run' | 'all' | 'values' | 'get'

type NodeSqlite = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: any[]) => {
      changes?: number | bigint
      lastInsertRowid?: number | bigint
    }
    all: (...params: any[]) => any[]
    get: (...params: any[]) => any
    columns: () => { name: string }[]
  }
  close: () => void
}

let localDb: NodeSqlite | null = null

export function getLocalSqlitePath() {
  return join(process.cwd(), '.data', 'halopress.sqlite')
}

export async function getLocalSqlite(): Promise<NodeSqlite> {
  if (localDb) return localDb
  const { DatabaseSync } = await import('node:sqlite')
  await import('node:fs/promises').then(fs => fs.mkdir(join(process.cwd(), '.data'), { recursive: true }))

  const dbPath = getLocalSqlitePath()
  localDb = new DatabaseSync(dbPath) as unknown as NodeSqlite
  localDb.exec('PRAGMA foreign_keys = ON;')
  localDb.exec('PRAGMA journal_mode = WAL;')
  localDb.exec('PRAGMA synchronous = NORMAL;')
  localDb.exec('PRAGMA busy_timeout = 5000;')
  return localDb
}

export type Db = any

export async function getDb(event?: H3Event): Promise<Db> {
  // Cloudflare D1 path (runtime binding)
  const cf = (event as any)?.context?.cloudflare
  const d1: D1Database | undefined = cf?.env?.DB
  if (d1) {
    const { drizzle } = await import('drizzle-orm/d1')
    return drizzle(d1, { schema: tables }) as unknown as Db
  }
  if (cf) {
    throw new Error('Missing Cloudflare D1 binding: DB')
  }

  // Local dev path: Node 22 built-in SQLite (node:sqlite) via drizzle sqlite-proxy.
  const sqlite = await getLocalSqlite()

  const callback = async (sql: string, params: any[], method: SqlMethod) => {
    const stmt = sqlite.prepare(sql)
    const safeParams = params ?? []

    if (method === 'run') {
      stmt.run(...safeParams)
      return { rows: [] }
    }
    if (method === 'get') {
      const row = stmt.get(...safeParams)
      return { rows: row ? Object.values(row) : undefined }
    }
    if (method === 'values') {
      const rows = stmt.all(...safeParams).map(row => Object.values(row))
      return { rows }
    }
    // all
    return { rows: stmt.all(...safeParams).map(row => Object.values(row)) }
  }

  return drizzleProxy(callback as any, { schema: tables })
}

export async function getRawDb(event?: H3Event) {
  const cf = (event as any)?.context?.cloudflare
  const d1: D1Database | undefined = cf?.env?.DB
  if (d1) return d1
  if (cf) throw new Error('Missing Cloudflare D1 binding: DB')

  const sqlite = await getLocalSqlite()
  return {
    prepare(query: string) {
      return {
        bind(...params: any[]) {
          return {
            async first<T>() {
              return (sqlite.prepare(query).get(...params) as T | undefined) ?? null
            },
            async all<T>() {
              return { results: sqlite.prepare(query).all(...params) as T[] }
            }
          }
        }
      }
    }
  }
}
