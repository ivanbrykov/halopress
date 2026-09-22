import { getSchemaDependencyImpact } from '../../../cms/schema-lifecycle'
import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { badRequest } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  if (!schemaKey) throw badRequest('Missing schema key')

  const db = await getDb(event)
  return await getSchemaDependencyImpact(db, schemaKey)
})
