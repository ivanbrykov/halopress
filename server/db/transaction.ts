import type { H3Event } from 'h3'

import type { Db } from './db'

export type DbStatement = any

export async function executeDbStatement(statement: DbStatement, statements?: DbStatement[]) {
  if (statements) {
    statements.push(statement)
    return
  }

  await statement
}

export async function withDbTransaction<T>(
  event: H3Event,
  db: Db,
  work: (tx: Db, statements?: DbStatement[]) => Promise<T>
): Promise<T> {
  const isCloudflareD1 = Boolean((event as any).context?.cloudflare?.env?.DB)

  // Drizzle's D1 transaction implementation issues an explicit BEGIN, but D1
  // only supports transactional statement groups through its batch API. Collect
  // the callback's statements for D1 and retain real transactions locally.
  if (isCloudflareD1) {
    const statements: DbStatement[] = []
    const result = await work(db, statements)
    if (statements.length) await db.batch(statements)
    return result
  }

  return await db.transaction(work)
}
