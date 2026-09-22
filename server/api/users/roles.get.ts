import { asc, desc } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { userRole as userRoleTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await getDb(event)

  const items = await db
    .select({
      roleKey: userRoleTable.roleKey,
      title: userRoleTable.title,
      level: userRoleTable.level
    })
    .from(userRoleTable)
    .orderBy(desc(userRoleTable.level), asc(userRoleTable.roleKey))

  return { items }
})
