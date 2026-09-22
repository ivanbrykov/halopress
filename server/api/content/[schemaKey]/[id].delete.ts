import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { deleteContent } from '../../../cms/content-publication'
import { requireExpectedRevision } from '../../../cms/document-revisions'
import { getDb } from '../../../db/db'
import { content as contentTable } from '../../../db/schema'
import { getAuthSession } from '../../../utils/auth'
import { notFound } from '../../../utils/http'
import { requireSchemaPermission } from '../../../utils/schema-permission'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  await requireSchemaPermission(event, schemaKey, 'delete')
  const session = await getAuthSession(event)
  const actorId = (session?.user as any)?.id ?? null
  const body = await readBody<{ revision?: number }>(event)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await db.select().from(contentTable).where(and(
    eq(contentTable.schemaKey, schemaKey),
    eq(contentTable.id, id)
  )).get()
  if (!existing) throw notFound('Content not found')

  const result = await deleteContent({ event, db, existing, actorId, expectedRevision })
  queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  return { ok: true, ...result }
})
