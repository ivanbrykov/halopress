import { and, desc, eq, sql } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../db/db'
import { user as userTable, userRole as userRoleTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const limit = Math.min(Number(q.limit ?? 50) || 50, 200)
  const statusRaw = typeof q.status === 'string' && q.status.length ? q.status : null
  const status = statusRaw && statusRaw !== 'all' ? statusRaw : null
  const roleKeyParam = typeof q.role === 'string' && q.role.length ? q.role : null
  const roleKeyRaw = roleKeyParam || (typeof q.roleKey === 'string' && q.roleKey.length ? q.roleKey : null)
  const roleKey = roleKeyRaw && roleKeyRaw !== 'all' ? roleKeyRaw : null
  const search = typeof q.q === 'string' ? q.q.trim().toLowerCase() : ''

  const db = await getDb(event)

  const whereParts: any[] = []
  if (status) whereParts.push(eq(userTable.status, status))
  if (roleKey) whereParts.push(eq(userTable.roleKey, roleKey))
  if (search) {
    const term = `%${search}%`
    whereParts.push(sql`(\n      lower(coalesce(${userTable.name}, '')) like ${term}\n      or lower(${userTable.email}) like ${term}\n      or lower(${userTable.id}) like ${term}\n    )`)
  }

  let query = db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      roleKey: userTable.roleKey,
      accountType: userTable.accountType,
      roleTitle: userRoleTable.title,
      roleLevel: userRoleTable.level,
      status: userTable.status,
      createdAt: userTable.createdAt
    })
    .from(userTable)
    .leftJoin(userRoleTable, eq(userTable.roleKey, userRoleTable.roleKey))

  if (whereParts.length) {
    query = query.where(and(...whereParts))
  }

  type UserListRow = {
    id: string
    email: string
    name: string | null
    roleKey: string
    accountType: string
    roleTitle: string | null
    roleLevel: number | null
    status: string
    createdAt: Date | string | number
  }

  const items: UserListRow[] = await query
    .orderBy(desc(userTable.createdAt))
    .limit(limit)

  const adminCountRow = await db
    .select({ count: sql<number>`count(1)` })
    .from(userTable)
    .where(and(
      eq(userTable.roleKey, 'admin'),
      eq(userTable.accountType, 'staff'),
      eq(userTable.status, 'active')
    ))
    .get()
  const adminCount = Number(adminCountRow?.count ?? 0)

  const enriched = items.map((item: UserListRow) => ({
    ...item,
    canDelete: !(item.roleKey === 'admin' && item.accountType === 'staff' && item.status === 'active' && adminCount <= 1)
  }))

  return { items: enriched }
})
