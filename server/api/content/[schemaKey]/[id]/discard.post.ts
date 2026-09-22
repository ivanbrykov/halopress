import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { discardContentWorking } from '../../../../cms/content-publication'
import { getDb } from '../../../../db/db'
import { content as contentTable } from '../../../../db/schema'
import { notFound } from '../../../../utils/http'
import { requireSchemaPermission } from '../../../../utils/schema-permission'
import { getAuthSession } from '../../../../utils/auth'
import { requireExpectedRevision } from '../../../../cms/document-revisions'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  await requireSchemaPermission(event, schemaKey, 'write')
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
  return {
    ok: true,
    ...(await discardContentWorking({ event, db, existing, schemaKey, actorId, expectedRevision }))
  }
})
