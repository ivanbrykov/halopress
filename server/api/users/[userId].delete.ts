import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { user as userTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest, notFound } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const userId = event.context.params?.userId as string
  if (!userId) throw badRequest('Missing user id')

  const selfId = actorId && !actorId.startsWith('admin:') ? actorId : null
  if (selfId && selfId === userId) throw badRequest('Cannot delete current user')

  const db = await getDb(event)
  const existing = await db
    .select({ id: userTable.id, roleKey: userTable.roleKey, accountType: userTable.accountType, status: userTable.status })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .get()
  if (!existing) throw notFound('User not found')

  if (existing.roleKey === 'admin' && existing.accountType === 'staff' && existing.status === 'active') {
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
    if (adminCount <= 1) throw badRequest('Cannot delete the last admin user')
  }

  await db
    .update(userTable)
    .set({ status: 'deleted' })
    .where(eq(userTable.id, userId))

  return { ok: true }
})
