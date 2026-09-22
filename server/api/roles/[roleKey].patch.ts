import { readBody } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { userRole as userRoleTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest, notFound } from '../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const roleKey = event.context.params?.roleKey as string
  if (!roleKey) throw badRequest('Missing role key')

  const body = await readBody<{ title?: string | null; level?: number }>(event)
  const updates: Record<string, any> = {}

  if (body?.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    updates.title = title.length ? title : null
  }

  if (body?.level !== undefined) {
    const level = Number(body.level)
    if (!Number.isFinite(level)) throw badRequest('Invalid level')
    updates.level = level
  }

  if (!Object.keys(updates).length) throw badRequest('No changes')

  const db = await getDb(event)
  const existing = await db
    .select({ roleKey: userRoleTable.roleKey })
    .from(userRoleTable)
    .where(eq(userRoleTable.roleKey, roleKey))
    .get()
  if (!existing) throw notFound('Role not found')

  await db
    .update(userRoleTable)
    .set(updates)
    .where(eq(userRoleTable.roleKey, roleKey))

  return { ok: true }
})
