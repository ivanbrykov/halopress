import { and, eq } from 'drizzle-orm'
import { getQuery } from 'h3'

import { extractStructuredAuthoredOutline } from '../../../../../shared/authored-document'
import { parseContentJson } from '../../../../cms/content-json'
import { publicationMetadata } from '../../../../cms/publication'
import { getActiveSchema, getSchemaVersion } from '../../../../cms/repo'
import { getDb } from '../../../../db/db'
import { content as contentTable } from '../../../../db/schema'
import { getAuthSession, requireStaff } from '../../../../utils/auth'
import { applyPreviewDeliveryHeaders } from '../../../../utils/delivery-policy'
import { notFound, sendH3Error } from '../../../../utils/http'
import {
  resolvePreviewContentLayoutRendering,
  resolvePreviewLayoutCanonicalPath
} from '../../../../utils/layout-rendering'
import { requireSchemaPermission } from '../../../../utils/schema-permission'
import { createStandaloneStructuredRenderingForEvent } from '../../../../utils/standalone-document-renderer'

export default defineEventHandler(async (event) => {
  applyPreviewDeliveryHeaders(event)
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  const session = await getAuthSession(event)
  if (!session?.user) return sendH3Error(event, notFound('Content not found'))
  try {
    await requireStaff(event)
  } catch {
    return sendH3Error(event, notFound('Content not found'))
  }
  await requireSchemaPermission(event, schemaKey, 'read')
  const db = await getDb(event)
  if (!await getActiveSchema(db, schemaKey)) return sendH3Error(event, notFound('Content not found'))
  const row = await db.select().from(contentTable).where(and(
    eq(contentTable.schemaKey, schemaKey),
    eq(contentTable.id, id)
  )).get()
  if (!row || row.status === 'deleted') return sendH3Error(event, notFound('Content not found'))
  const sourceSchema = await getSchemaVersion(db, schemaKey, row.schemaVersion)
  if (!sourceSchema) return sendH3Error(event, notFound('Content not found'))
  const content = parseContentJson(row.contentJson)
  const fields = sourceSchema.registry?.fields ?? []
  const includeRendering = getQuery(event).rendering !== '0'
  return {
    id: row.id,
    schemaKey: row.schemaKey,
    schemaVersion: row.schemaVersion,
    status: row.status,
    content,
    schema: sourceSchema,
    ...(includeRendering
      ? { rendering: createStandaloneStructuredRenderingForEvent(event, content, fields) }
      : {}),
    layout: await resolvePreviewContentLayoutRendering(event, {
      visibility: 'preview',
      documentKind: 'content',
      documentId: row.id,
      schemaKey: row.schemaKey,
      schemaVersion: row.schemaVersion,
      canonicalPath: resolvePreviewLayoutCanonicalPath(row.publicPath)
    }, () => extractStructuredAuthoredOutline(content, fields)),
    updatedAt: row.updatedAt,
    ...publicationMetadata(row)
  }
})
