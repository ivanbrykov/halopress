import { readBody } from 'h3'

import { purgeSchema } from '../../../cms/schema-lifecycle'
import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { badRequest } from '../../../utils/http'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const body = await readBody<{ confirmation?: string }>(event)
  const db = await getDb(event)
  const impact = await purgeSchema(event, db, schemaKey, body?.confirmation ?? '')
  queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  return { ok: true, impact }
})
