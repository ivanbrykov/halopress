import { ne, sql } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { user as userTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await getDb(event)

  const row = await db
    .select({ total: sql<number>`count(1)` })
    .from(userTable)
    .where(ne(userTable.status, 'deleted'))
    .get()

  return { total: Number(row?.total ?? 0) }
})
