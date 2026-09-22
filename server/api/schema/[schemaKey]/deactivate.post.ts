import { deactivateSchema } from '../../../cms/schema-lifecycle'
import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { badRequest } from '../../../utils/http'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const db = await getDb(event)
  const lifecycle = await deactivateSchema(db, schemaKey, (session.user as any)?.id ?? null)
  queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  return { ok: true, lifecycle }
})
