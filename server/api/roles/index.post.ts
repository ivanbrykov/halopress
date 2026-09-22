import { readBody } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { userRole as userRoleTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest } from '../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ roleKey?: string; title?: string; level?: number }>(event)
  const roleKey = (body?.roleKey ?? '').trim().toLowerCase()
  if (!roleKey) throw badRequest('Missing role key')

  const level = Number.isFinite(body?.level) ? Number(body?.level) : 50
  const title = body?.title?.trim() || null

  const db = await getDb(event)
  const existing = await db
    .select({ roleKey: userRoleTable.roleKey })
    .from(userRoleTable)
    .where(eq(userRoleTable.roleKey, roleKey))
    .get()
  if (existing) throw badRequest('Role already exists')

  await db
    .insert(userRoleTable)
    .values({ roleKey, title, level })

  return { ok: true }
})
