import { getDb } from '../../../../db/db'
import { listDocumentRevisions } from '../../../../cms/document-revisions'
import { requireAdmin } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  return await listDocumentRevisions(await getDb(event), 'schema-draft', schemaKey)
})
