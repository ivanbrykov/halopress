import { and, eq } from 'drizzle-orm'
import { getQuery } from 'h3'

import { diffDocumentSnapshots, getDocumentRevision, requireExpectedRevision } from '../../../../../../cms/document-revisions'
import { getDb } from '../../../../../../db/db'
import { content as contentTable } from '../../../../../../db/schema'
import { requireStaff } from '../../../../../../utils/auth'
import { notFound } from '../../../../../../utils/http'
import { requireSchemaPermission } from '../../../../../../utils/schema-permission'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  const revision = requireExpectedRevision(Number(event.context.params?.revision))
  const query = getQuery(event)
  const against = query.against === undefined
    ? revision - 1
    : requireExpectedRevision(Number(query.against))
  await requireStaff(event)
  await requireSchemaPermission(event, schemaKey, 'read')
  const db = await getDb(event)
  const existing = await db.select({ id: contentTable.id }).from(contentTable).where(and(
    eq(contentTable.schemaKey, schemaKey),
    eq(contentTable.id, id)
  )).get()
  if (!existing) throw notFound('Content not found')
  const target = await getDocumentRevision(db, 'content', id, revision)
  const base = against >= 1 ? await getDocumentRevision(db, 'content', id, against) : null
  return {
    revision,
    against: base?.revision ?? null,
    changes: diffDocumentSnapshots(base?.snapshot, target.snapshot)
  }
})
