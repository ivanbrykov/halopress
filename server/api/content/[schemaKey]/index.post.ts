import { readBody } from 'h3'

import { syncContentProjections } from '../../../cms/content-projections'
import { validateContentJson } from '../../../cms/content-validation'
import { getActiveSchema } from '../../../cms/repo'
import { getDb } from '../../../db/db'
import { content as contentTable } from '../../../db/schema'
import { executeDbStatement, withDbTransaction } from '../../../db/transaction'
import { createInitialDocumentRevision } from '../../../cms/document-revisions'
import { assertDraftWriteStatus } from '../../../cms/publication-transitions'
import { getAuthSession } from '../../../utils/auth'
import { replaceBase64ImagesInContent } from '../../../utils/asset-data-url'
import { badRequest, notFound } from '../../../utils/http'
import { newId } from '../../../utils/ids'
import { getTrustedRequestOrigin } from '../../../utils/request-origin'
import { requireSchemaPermission } from '../../../utils/schema-permission'
import { normalizePublicSeoOverrides } from '../../../../shared/public-seo'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  await requireSchemaPermission(event, schemaKey, 'write')
  const session = await getAuthSession(event)
  const actorId = (session?.user as any)?.id ?? null
  const body = await readBody<{ status?: string, content?: Record<string, unknown>, seo?: unknown }>(event)
  assertDraftWriteStatus(body?.status)
  const db = await getDb(event)
  const active = await getActiveSchema(db, schemaKey)
  if (!active?.registry) throw notFound('Active schema not found')

  const input = body?.content ?? {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Invalid content')
  const content = validateContentJson(active.jsonSchema, input)
  let seo = null
  try {
    seo = normalizePublicSeoOverrides(body?.seo)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid SEO metadata')
  }
  const id = newId()
  const now = new Date()
  const status = 'draft'

  await withDbTransaction(event, db, async (tx: any, statements) => {
    await replaceBase64ImagesInContent({ event, db: tx, createdBy: actorId, content, statements })
    await executeDbStatement(tx.insert(contentTable).values({
      id,
      schemaKey,
      schemaVersion: active.version,
      status,
      contentJson: JSON.stringify(content),
      seoJson: seo ? JSON.stringify(seo) : null,
      currentRevision: 1,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now
    }), statements)
    await createInitialDocumentRevision({
      tx,
      statements,
      documentKind: 'content',
      documentId: id,
      schemaKey,
      state: { snapshot: content, status, schemaVersion: active.version },
      actorId,
      createdAt: now
    })
    await syncContentProjections({
      db: tx,
      registry: active.registry!,
      content,
      contentId: id,
      schemaKey,
      schemaVersion: active.version,
      status,
      createdAt: now,
      updatedAt: now,
      projectionScope: 'working',
      trustedOrigin: getTrustedRequestOrigin(event),
      additionalAssetIds: seo?.imageAssetId ? [seo.imageAssetId] : [],
      statements
    })
  })

  return {
    ok: true,
    id,
    revision: 1,
    publicationState: 'never-published',
    hasPublishedRevision: false,
    hasDraftChanges: false,
    publishedAt: null
  }
})
