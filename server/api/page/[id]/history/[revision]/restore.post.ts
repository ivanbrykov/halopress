import { eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { restorePageRevision } from '../../../../../cms/page-publication'
import { getDocumentRevision, requireExpectedRevision } from '../../../../../cms/document-revisions'
import { normalizePageContent } from '../../../../../cms/page-content'
import { getDb } from '../../../../../db/db'
import { page as pageTable } from '../../../../../db/schema'
import { requireAdmin } from '../../../../../utils/auth'
import { conflict, notFound } from '../../../../../utils/http'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = event.context.params?.id as string
  const targetRevision = requireExpectedRevision(Number(event.context.params?.revision))
  const body = await readBody<{ revision?: number }>(event)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await db.select().from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')
  if (existing.status === 'deleted') throw conflict('Recover the deleted page before restoring a revision')
  const target = await getDocumentRevision(db, 'page', id, targetRevision)
  const result = await restorePageRevision({
    event,
    db,
    existing,
    title: target.title,
    content: normalizePageContent(target.snapshot),
    actorId: (session.user as any)?.id ?? null,
    expectedRevision
  })
  return { ok: true, restoredFrom: targetRevision, ...result }
})
