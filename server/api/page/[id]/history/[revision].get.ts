import { eq } from 'drizzle-orm'

import { getDocumentRevision, requireExpectedRevision } from '../../../../cms/document-revisions'
import { getDb } from '../../../../db/db'
import { page as pageTable } from '../../../../db/schema'
import { requireAdmin } from '../../../../utils/auth'
import { notFound } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = event.context.params?.id as string
  const revision = requireExpectedRevision(Number(event.context.params?.revision))
  const db = await getDb(event)
  const existing = await db.select({ id: pageTable.id }).from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')
  return await getDocumentRevision(db, 'page', id, revision)
})
