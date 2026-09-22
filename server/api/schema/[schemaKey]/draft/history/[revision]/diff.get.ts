import { getQuery } from 'h3'

import { diffDocumentSnapshots, getDocumentRevision } from '../../../../../../cms/document-revisions'
import { getDb } from '../../../../../../db/db'
import { requireAdmin } from '../../../../../../utils/auth'
import { badRequest } from '../../../../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  const revision = Number(event.context.params?.revision)
  const q = getQuery(event)
  const against = q.against === undefined ? revision - 1 : Number(q.against)
  if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(against) || against < 1) {
    throw badRequest('Invalid revision')
  }
  const db = await getDb(event)
  const [before, after] = await Promise.all([
    getDocumentRevision(db, 'schema-draft', schemaKey, against),
    getDocumentRevision(db, 'schema-draft', schemaKey, revision)
  ])
  return { against, revision, changes: diffDocumentSnapshots(before.snapshot, after.snapshot) }
})
