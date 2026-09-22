import { readBody } from 'h3'
import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { user as userTable, userRole as userRoleTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest, notFound } from '../../utils/http'

const allowedStatuses = new Set(['pending', 'active', 'suspended', 'disabled', 'deleted'])

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const userId = event.context.params?.userId as string
  if (!userId) throw badRequest('Missing user id')

  const body = await readBody<{ name?: string | null; roleKey?: string; status?: string }>(event)
  const db = await getDb(event)

  const existing = await db
    .select({ id: userTable.id, roleKey: userTable.roleKey, accountType: userTable.accountType, status: userTable.status })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .get()
  if (!existing) throw notFound('User not found')

  const updates: Record<string, any> = {}

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    updates.name = name.length ? name : null
  }

  if (body?.roleKey !== undefined) {
    const roleKey = body.roleKey.trim()
    if (!roleKey) throw badRequest('Missing role')

    const role = await db
      .select({ roleKey: userRoleTable.roleKey })
      .from(userRoleTable)
      .where(eq(userRoleTable.roleKey, roleKey))
      .get()
    if (!role) throw badRequest('Invalid role')
    if (roleKey === 'admin' && existing.accountType !== 'staff') {
      throw badRequest('Public member accounts cannot be assigned the administrator role')
    }

    updates.roleKey = roleKey
  }

  if (body?.status !== undefined) {
    const status = body.status.trim()
    if (!allowedStatuses.has(status)) throw badRequest('Invalid status')
    updates.status = status
  }

  if (!Object.keys(updates).length) throw badRequest('No changes')

  const selfId = actorId && !actorId.startsWith('admin:') ? actorId : null
  if (selfId && selfId === userId && updates.status === 'deleted') {
    throw badRequest('Cannot delete current user')
  }

  const isDeactivating = updates.status && updates.status !== 'active'
  const isDemoting = updates.roleKey && existing.roleKey === 'admin' && updates.roleKey !== 'admin'
  if ((isDeactivating || isDemoting)
    && existing.roleKey === 'admin'
    && existing.accountType === 'staff'
    && existing.status === 'active') {
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
    if (adminCount <= 1) throw badRequest('Cannot remove the last admin user')
  }

  await db
    .update(userTable)
    .set(updates)
    .where(eq(userTable.id, userId))

  return { ok: true }
})
