import { eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { getDb } from '../../../db/db'
import { schemaRole as schemaRoleTable, userRole as userRoleTable } from '../../../db/schema'
import { requireAdmin } from '../../../utils/auth'
import { badRequest, forbidden, notFound } from '../../../utils/http'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const body = await readBody<{
    roleKey?: string
    canRead?: boolean
    canWrite?: boolean
    canPublish?: boolean
    canArchive?: boolean
    canDelete?: boolean
    canAdmin?: boolean
  }>(event)

  const roleKey = (body?.roleKey ?? '').trim()
  if (!roleKey) throw badRequest('Missing role key')
  if (roleKey === 'admin') throw forbidden('Admin role permissions are immutable')

  const db = await getDb(event)
  const role = await db
    .select({ roleKey: userRoleTable.roleKey })
    .from(userRoleTable)
    .where(eq(userRoleTable.roleKey, roleKey))
    .get()

  if (!role) throw notFound('Role not found')

  const canRead = !!body?.canRead
  const canWrite = !!body?.canWrite
  const canPublish = !!body?.canPublish
  const canArchive = !!body?.canArchive
  const canDelete = !!body?.canDelete
  const canAdmin = !!body?.canAdmin

  await db
    .insert(schemaRoleTable)
    .values({
      schemaKey,
      roleKey,
      canRead,
      canWrite,
      canPublish,
      canArchive,
      canDelete,
      canAdmin
    })
    .onConflictDoUpdate({
      target: [schemaRoleTable.schemaKey, schemaRoleTable.roleKey],
      set: { canRead, canWrite, canPublish, canArchive, canDelete, canAdmin }
    })

  if (roleKey === 'anonymous') queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)

  return { ok: true }
})
