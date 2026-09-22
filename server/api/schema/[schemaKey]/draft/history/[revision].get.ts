import { getDocumentRevision, listDocumentRevisions } from '../../../../../cms/document-revisions'
import { getDb } from '../../../../../db/db'
import { requireAdmin } from '../../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  const revision = Number(event.context.params?.revision)
  const db = await getDb(event)
  const target = await getDocumentRevision(db, 'schema-draft', schemaKey, revision)
  const history = await listDocumentRevisions(db, 'schema-draft', schemaKey)
  return {
    ...target,
    changes: history.items.find((item: { revision: number }) => item.revision === revision)?.changes ?? []
  }
})
