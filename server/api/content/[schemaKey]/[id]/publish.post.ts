import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { publishContentWorking } from '../../../../cms/content-publication'
import { parseContentJson } from '../../../../cms/content-json'
import { validateContentJson } from '../../../../cms/content-validation'
import { getActiveSchema } from '../../../../cms/repo'
import { getDb } from '../../../../db/db'
import { content as contentTable } from '../../../../db/schema'
import { getAuthSession } from '../../../../utils/auth'
import { badRequest, forbidden, notFound } from '../../../../utils/http'
import { requireSchemaPermission } from '../../../../utils/schema-permission'
import { queueWidgetCacheInvalidation } from '../../../../utils/widget-cache'
import { requireExpectedRevision } from '../../../../cms/document-revisions'
import { normalizePublicSeoOverrides, parsePublicSeoJson } from '../../../../../shared/public-seo'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  const permission = await requireSchemaPermission(event, schemaKey, 'publish')
  const session = await getAuthSession(event)
  const actorId = (session?.user as any)?.id ?? null
  const body = await readBody<{ revision?: number, content?: Record<string, unknown>, seo?: unknown }>(event)
  if ((body?.content !== undefined || body?.seo !== undefined) && !permission.canWrite && !permission.canAdmin) {
    throw forbidden('Write permission is required to change content while publishing')
  }
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const active = await getActiveSchema(db, schemaKey)
  if (!active?.registry) throw notFound('Active schema not found')
  const existing = await db.select().from(contentTable).where(and(
    eq(contentTable.schemaKey, schemaKey),
    eq(contentTable.id, id)
  )).get()
  if (!existing) throw notFound('Content not found')
  const input = body?.content ?? parseContentJson(existing.contentJson)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Invalid content')
  const content = validateContentJson(active.jsonSchema, input)
  let seo = parsePublicSeoJson(existing.seoJson)
  if (body?.seo !== undefined) {
    try {
      seo = normalizePublicSeoOverrides(body.seo)
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Invalid SEO metadata')
    }
  }
  const publication = await publishContentWorking({
    event,
    db,
    existing,
    schemaKey,
    active: active as any,
    content,
    seo,
    actorId,
    expectedRevision
  })
  queueWidgetCacheInvalidation(event, 'schema:' + schemaKey)
  return { ok: true, ...publication }
})
