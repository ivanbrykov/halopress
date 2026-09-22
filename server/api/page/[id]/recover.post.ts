import { eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { recoverPage } from '../../../cms/page-publication'
import { requireExpectedRevision } from '../../../cms/document-revisions'
import { getDb } from '../../../db/db'
import { page as pageTable } from '../../../db/schema'
import { requireAdmin } from '../../../utils/auth'
import { notFound } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = event.context.params?.id as string
  if (!id) throw notFound('Page not found')
  const body = await readBody<{ revision?: number }>(event)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await db.select().from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')
  return {
    ok: true,
    ...(await recoverPage({
      event,
      db,
      existing,
      actorId: (session.user as any)?.id ?? null,
      expectedRevision
    }))
  }
})
