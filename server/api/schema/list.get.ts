import { getQuery } from 'h3'
import { getDb } from '../../db/db'
import { listActiveSchemas } from '../../cms/repo'
import { requireAdmin } from '../../utils/auth'
import { getSchemaRoleKey } from '../../utils/schema-permission'

export default defineEventHandler(async (event) => {
  const includeInactive = ['1', 'true'].includes(String(getQuery(event).includeInactive ?? ''))
  if (includeInactive) await requireAdmin(event)
  const roleKey = await getSchemaRoleKey(event)
  const db = await getDb(event)
  const items = await listActiveSchemas(db, roleKey === 'admin' ? { includeInactive } : { roleKey })
  return { items }
})
