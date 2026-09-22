import { eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { unpublishPage } from '../../../cms/page-publication'
import { getDb } from '../../../db/db'
import { page as pageTable } from '../../../db/schema'
import { requireAdmin } from '../../../utils/auth'
import { notFound } from '../../../utils/http'
import { requireExpectedRevision } from '../../../cms/document-revisions'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = event.context.params?.id as string
  if (!id) throw notFound('Page not found')
  const body = await readBody<{ revision?: number }>(event)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await db.select().from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')
  const result = {
    ok: true,
    ...(await unpublishPage({
      event,
      db,
      existing,
      actorId: (session.user as any)?.id ?? null,
      expectedRevision
    }))
  }
  queueWidgetCacheInvalidation(event, 'public-routes:page')
  return result
})
