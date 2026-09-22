import { and, asc, desc, eq } from 'drizzle-orm'

import { getDb } from '../../../db/db'
import { schemaRole as schemaRoleTable, userRole as userRoleTable } from '../../../db/schema'
import { requireAdmin } from '../../../utils/auth'
import { badRequest } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const db = await getDb(event)

  type RoleRow = {
    roleKey: string
    title: string | null
    level: number
    canRead: boolean | number | null
    canWrite: boolean | number | null
    canPublish: boolean | number | null
    canArchive: boolean | number | null
    canDelete: boolean | number | null
    canAdmin: boolean | number | null
  }

  const rows: RoleRow[] = await db
    .select({
      roleKey: userRoleTable.roleKey,
      title: userRoleTable.title,
      level: userRoleTable.level,
      canRead: schemaRoleTable.canRead,
      canWrite: schemaRoleTable.canWrite,
      canPublish: schemaRoleTable.canPublish,
      canArchive: schemaRoleTable.canArchive,
      canDelete: schemaRoleTable.canDelete,
      canAdmin: schemaRoleTable.canAdmin
    })
    .from(userRoleTable)
    .leftJoin(schemaRoleTable, and(
      eq(schemaRoleTable.roleKey, userRoleTable.roleKey),
      eq(schemaRoleTable.schemaKey, schemaKey)
    ))
    .orderBy(desc(userRoleTable.level), asc(userRoleTable.roleKey))

  type RoleItem = {
    roleKey: string
    title: string | null
    level: number
    canRead: boolean
    canWrite: boolean
    canPublish: boolean
    canArchive: boolean
    canDelete: boolean
    canAdmin: boolean
    locked: boolean
  }

  const items: RoleItem[] = rows.map((row) => ({
    roleKey: row.roleKey,
    title: row.title ?? null,
    level: row.level,
    canRead: !!row.canRead,
    canWrite: !!row.canWrite,
    canPublish: !!row.canPublish,
    canArchive: !!row.canArchive,
    canDelete: !!row.canDelete,
    canAdmin: !!row.canAdmin,
    locked: false
  }))

  const adminItem = items.find((item) => item.roleKey === 'admin')
  if (adminItem) {
    adminItem.canRead = true
    adminItem.canWrite = true
    adminItem.canPublish = true
    adminItem.canArchive = true
    adminItem.canDelete = true
    adminItem.canAdmin = true
    adminItem.locked = true
    adminItem.title = adminItem.title ?? 'Admin'
  } else {
    items.push({
      roleKey: 'admin',
      title: 'Admin',
      level: 100,
      canRead: true,
      canWrite: true,
      canPublish: true,
      canArchive: true,
      canDelete: true,
      canAdmin: true,
      locked: true
    })
  }

  items.sort((a, b) => b.level - a.level || a.roleKey.localeCompare(b.roleKey))

  return { items }
})
