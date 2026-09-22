import { getPublishedSchema } from '../../../cms/repo'
import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { applyPrivateDeliveryHeaders } from '../../../utils/delivery-policy'
import { badRequest, notFound } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  applyPrivateDeliveryHeaders(event)
  const db = await getDb(event)
  const schema = await getPublishedSchema(db, schemaKey, { includeInactive: true })
  if (!schema) throw notFound('Schema not found')
  return schema
})
