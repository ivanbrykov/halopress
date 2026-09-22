import { eq } from 'drizzle-orm'
import { getQuery } from 'h3'

import { diffDocumentSnapshots, getDocumentRevision, requireExpectedRevision } from '../../../../../cms/document-revisions'
import { getDb } from '../../../../../db/db'
import { page as pageTable } from '../../../../../db/schema'
import { requireAdmin } from '../../../../../utils/auth'
import { notFound } from '../../../../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = event.context.params?.id as string
  const revision = requireExpectedRevision(Number(event.context.params?.revision))
  const query = getQuery(event)
  const against = query.against === undefined
    ? revision - 1
    : requireExpectedRevision(Number(query.against))
  const db = await getDb(event)
  const existing = await db.select({ id: pageTable.id }).from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')
  const target = await getDocumentRevision(db, 'page', id, revision)
  const base = against >= 1 ? await getDocumentRevision(db, 'page', id, against) : null
  return {
    revision,
    against: base?.revision ?? null,
    changes: diffDocumentSnapshots(base?.snapshot, target.snapshot)
  }
})
