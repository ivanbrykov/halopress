import { readBody } from 'h3'
import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { schemaRole as schemaRoleTable, user as userTable, userRole as userRoleTable } from '../../db/schema'
import { executeDbStatement, withDbTransaction } from '../../db/transaction'
import { requireAdmin } from '../../utils/auth'
import { badRequest, notFound } from '../../utils/http'

const protectedRoles = new Set(['admin', 'anonymous'])

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const roleKey = event.context.params?.roleKey as string
  if (!roleKey) throw badRequest('Missing role key')
  if (protectedRoles.has(roleKey)) throw badRequest('Cannot delete protected role')

  const body = await readBody<{ transferRoleKey?: string }>(event)
  const transferRoleKey = body?.transferRoleKey?.trim()

  const db = await getDb(event)
  const existing = await db
    .select({ roleKey: userRoleTable.roleKey })
    .from(userRoleTable)
    .where(eq(userRoleTable.roleKey, roleKey))
    .get()
  if (!existing) throw notFound('Role not found')

  const userCountRow = await db
    .select({ count: sql<number>`count(1)` })
    .from(userTable)
    .where(eq(userTable.roleKey, roleKey))
    .get()
  const userCount = Number(userCountRow?.count ?? 0)

  const schemaCountRow = await db
    .select({ count: sql<number>`count(1)` })
    .from(schemaRoleTable)
    .where(eq(schemaRoleTable.roleKey, roleKey))
    .get()
  const schemaCount = Number(schemaCountRow?.count ?? 0)

  const needsTransfer = userCount > 0 || schemaCount > 0
  if (needsTransfer && !transferRoleKey) throw badRequest('Replacement role required')

  if (transferRoleKey) {
    if (transferRoleKey === roleKey) throw badRequest('Invalid replacement role')
    const target = await db
      .select({ roleKey: userRoleTable.roleKey })
      .from(userRoleTable)
      .where(eq(userRoleTable.roleKey, transferRoleKey))
      .get()
    if (!target) throw badRequest('Replacement role not found')
  }

  await withDbTransaction(event, db, async (tx: any, statements) => {
    if (transferRoleKey) {
      await executeDbStatement(tx
        .update(userTable)
        .set({ roleKey: transferRoleKey })
        .where(eq(userTable.roleKey, roleKey)), statements)

      await executeDbStatement(tx
        .delete(schemaRoleTable)
        .where(and(
          eq(schemaRoleTable.roleKey, roleKey),
          sql`${schemaRoleTable.schemaKey} in (select ${schemaRoleTable.schemaKey} from ${schemaRoleTable} where ${schemaRoleTable.roleKey} = ${transferRoleKey})`
        )), statements)

      await executeDbStatement(tx
        .update(schemaRoleTable)
        .set({ roleKey: transferRoleKey })
        .where(eq(schemaRoleTable.roleKey, roleKey)), statements)
    }

    await executeDbStatement(tx
      .delete(userRoleTable)
      .where(eq(userRoleTable.roleKey, roleKey)), statements)
  })

  return { ok: true }
})
