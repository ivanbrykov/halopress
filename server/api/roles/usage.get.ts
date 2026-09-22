import { and, eq, sql } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../db/db'
import { schema as schemaTable, schemaActive as schemaActiveTable, schemaRole as schemaRoleTable, user as userTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest } from '../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const roleKey = typeof q.roleKey === 'string' ? q.roleKey : ''
  if (!roleKey) throw badRequest('Missing role key')

  const db = await getDb(event)

  type SchemaUsageRow = {
    schemaKey: string
    title: string | null
    canRead: boolean | number
    canWrite: boolean | number
    canAdmin: boolean | number
  }

  const schemas: SchemaUsageRow[] = await db
    .select({
      schemaKey: schemaRoleTable.schemaKey,
      canRead: schemaRoleTable.canRead,
      canWrite: schemaRoleTable.canWrite,
      canAdmin: schemaRoleTable.canAdmin,
      title: schemaTable.title
    })
    .from(schemaRoleTable)
    .leftJoin(schemaActiveTable, eq(schemaRoleTable.schemaKey, schemaActiveTable.schemaKey))
    .leftJoin(schemaTable, and(
      eq(schemaTable.schemaKey, schemaActiveTable.schemaKey),
      eq(schemaTable.version, schemaActiveTable.activeVersion)
    ))
    .where(eq(schemaRoleTable.roleKey, roleKey))
    .orderBy(schemaRoleTable.schemaKey)

  const userCountRow = await db
    .select({ count: sql<number>`count(1)` })
    .from(userTable)
    .where(eq(userTable.roleKey, roleKey))
    .get()

  return {
    schemas: schemas.map((row: SchemaUsageRow) => ({
      schemaKey: row.schemaKey,
      title: row.title ?? row.schemaKey,
      canRead: !!row.canRead,
      canWrite: !!row.canWrite,
      canAdmin: !!row.canAdmin
    })),
    userCount: Number(userCountRow?.count ?? 0)
  }
})
