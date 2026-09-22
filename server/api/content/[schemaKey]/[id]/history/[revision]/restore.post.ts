import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { restoreContentRevision } from '../../../../../../cms/content-publication'
import { getDocumentRevision, requireExpectedRevision } from '../../../../../../cms/document-revisions'
import { getSchemaVersion } from '../../../../../../cms/repo'
import { getDb } from '../../../../../../db/db'
import { content as contentTable } from '../../../../../../db/schema'
import { getAuthSession, requireStaff } from '../../../../../../utils/auth'
import { badRequest, conflict, notFound } from '../../../../../../utils/http'
import { requireSchemaPermission } from '../../../../../../utils/schema-permission'
import { queueWidgetCacheInvalidation } from '../../../../../../utils/widget-cache'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  const targetRevision = requireExpectedRevision(Number(event.context.params?.revision))
  await requireStaff(event)
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
  if (existing.status === 'deleted') throw conflict('Recover deleted content before restoring a revision')
  const target = await getDocumentRevision(db, 'content', id, targetRevision)
  if (!target.schemaVersion) throw conflict('Revision schema version is unavailable')
  if (!target.snapshot || typeof target.snapshot !== 'object' || Array.isArray(target.snapshot)) {
    throw badRequest('Invalid revision snapshot')
  }
  const version = await getSchemaVersion(db, schemaKey, target.schemaVersion)
  if (!version?.registry) throw conflict('Revision schema version is unavailable')
  const result = await restoreContentRevision({
    event,
    db,
    existing,
    schemaKey,
    schemaVersion: target.schemaVersion,
    registry: version.registry,
    content: target.snapshot as Record<string, unknown>,
    actorId,
    expectedRevision
  })
  queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  return { ok: true, restoredFrom: targetRevision, ...result }
})
