import { and, eq } from 'drizzle-orm'

import { listDocumentRevisions } from '../../../../cms/document-revisions'
import { getDb } from '../../../../db/db'
import { content as contentTable } from '../../../../db/schema'
import { requireStaff } from '../../../../utils/auth'
import { notFound } from '../../../../utils/http'
import { requireSchemaPermission } from '../../../../utils/schema-permission'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  await requireStaff(event)
  await requireSchemaPermission(event, schemaKey, 'read')
  const db = await getDb(event)
  const existing = await db.select({ id: contentTable.id }).from(contentTable).where(and(
    eq(contentTable.schemaKey, schemaKey),
    eq(contentTable.id, id)
  )).get()
  if (!existing) throw notFound('Content not found')
  return await listDocumentRevisions(db, 'content', id)
})
