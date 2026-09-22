import { getDb } from '../../../../db/db'
import { getSchemaVersion } from '../../../../cms/repo'
import { notFound } from '../../../../utils/http'
import { requireStaff } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireStaff(event)
  const schemaKey = event.context.params?.schemaKey as string
  const v = Number(event.context.params?.v)
  const db = await getDb(event)
  const result = await getSchemaVersion(db, schemaKey, v)
  if (!result) throw notFound('Schema version not found')
  return result
})
