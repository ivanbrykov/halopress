import { and, eq, inArray } from 'drizzle-orm'
import { readBody } from 'h3'

import { syncDocumentAssetRefs } from '../../../cms/asset-refs'
import { getDb } from '../../../db/db'
import { syncContentProjections } from '../../../cms/content-projections'
import { parseContentJson } from '../../../cms/content-json'
import { getSchemaVersion } from '../../../cms/repo'
import {
  asset as assetTable,
  content as contentTable,
  documentAssetRef,
  page as pageTable
} from '../../../db/schema'
import { executeDbStatement, withDbTransaction } from '../../../db/transaction'
import { deleteObject } from '../../../storage/assets'
import { requireAdmin } from '../../../utils/auth'
import { assertAssetIsNotPublished, assertAssetIsNotRetained } from '../../../utils/asset-delivery'
import { badRequest, conflict, notFound } from '../../../utils/http'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'
import { getTrustedRequestOrigin } from '../../../utils/request-origin'

function replaceAssetRefs(value: unknown, fromId: string, toId?: string | null): { value: unknown; changed: boolean } {
  const rawUrl = `/assets/${fromId}/raw`
  const nextUrl = toId ? `/assets/${toId}/raw` : null

  if (typeof value === 'string') {
    let next = value
    let changed = false

    if (toId) {
      if (next === fromId) {
        next = toId
        changed = true
      }
      if (next.includes(rawUrl)) {
        const replaced = next.split(rawUrl).join(nextUrl ?? '')
        if (replaced !== next) {
          next = replaced
          changed = true
        }
      }
      return { value: next, changed }
    }

    if (next === fromId) {
      return { value: null, changed: true }
    }
    if (next.includes(rawUrl)) {
      const replaced = next.split(rawUrl).join('')
      if (replaced !== next) {
        next = replaced.trim()
        changed = true
      }
    }
    if (!next) {
      return { value: null, changed: true }
    }
    return { value: next, changed }
  }

  if (Array.isArray(value)) {
    let changed = false
    const nextArray: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      const result = replaceAssetRefs(value[i], fromId, toId)
      if (result.changed) {
        changed = true
      }
      if (result.value !== null && result.value !== undefined && result.value !== '') {
        nextArray.push(result.value)
      } else if (!result.changed) {
        nextArray.push(result.value)
      }
    }
    return { value: nextArray, changed }
  }

  if (value && typeof value === 'object') {
    if (typeof (value as Record<string, unknown>).assetId === 'string'
      && (value as Record<string, unknown>).assetId === fromId) {
      if (!toId) return { value: null, changed: true }
      return {
        value: { ...(value as Record<string, unknown>), assetId: toId },
        changed: true
      }
    }
    let changed = false
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key === 'alt' || key === 'caption') continue
      const result = replaceAssetRefs((value as Record<string, unknown>)[key], fromId, toId)
      if (result.changed) {
        ;(value as Record<string, unknown>)[key] = result.value
        changed = true
      }
    }
    return { value, changed }
  }

  return { value, changed: false }
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const assetId = event.context.params?.assetId as string
  if (!assetId) throw badRequest('Missing assetId')

  const body = await readBody<{ replacementId?: string }>(event)
  const replacementId = body?.replacementId?.trim()
  const hasReplacement = typeof replacementId === 'string' && replacementId.length > 0
  if (replacementId === assetId) throw badRequest('Replacement asset must be different')

  const db = await getDb(event)

  const current = await db
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(eq(assetTable.id, assetId))
    .limit(1)
  if (!current[0]) throw notFound('Asset not found')

  if (hasReplacement) {
    const replacement = await db
      .select({ id: assetTable.id })
      .from(assetTable)
      .where(eq(assetTable.id, replacementId))
      .limit(1)
    if (!replacement[0]) throw badRequest('Replacement asset not found')
  }
  await assertAssetIsNotPublished(db, assetId)

  const workingRefs: Array<{ documentKind: string, documentId: string }> = await db
    .select({ documentKind: documentAssetRef.documentKind, documentId: documentAssetRef.documentId })
    .from(documentAssetRef)
    .where(and(
      eq(documentAssetRef.assetId, assetId),
      eq(documentAssetRef.projectionScope, 'working')
    ))
  const contentIds = [...new Set(workingRefs
    .filter(ref => ref.documentKind === 'content')
    .map(ref => ref.documentId))]
  const pageIds = [...new Set(workingRefs
    .filter(ref => ref.documentKind === 'page')
    .map(ref => ref.documentId))]

  const changedSchemas = new Set<string>()
  const contentUpdates: Array<{
    row: typeof contentTable.$inferSelect
    content: Record<string, unknown>
    registry: NonNullable<Awaited<ReturnType<typeof getSchemaVersion>>>['registry']
    updatedAt: Date
  }> = []
  if (contentIds.length) {
    const contents = await db
      .select()
      .from(contentTable)
      .where(inArray(contentTable.id, contentIds))

    for (const row of contents) {
      try {
        const content = parseContentJson(row.contentJson)
        const result = replaceAssetRefs(content, assetId, hasReplacement ? replacementId : null)
        if (!result.changed) throw conflict('Asset reference could not be replaced')
        const version = await getSchemaVersion(db, row.schemaKey, row.schemaVersion)
        if (!version?.registry) throw conflict('Referenced content schema is unavailable')
        changedSchemas.add(row.schemaKey)
        contentUpdates.push({
          row,
          content: result.value as Record<string, unknown>,
          registry: version.registry,
          updatedAt: new Date()
        })
      } catch {
        throw conflict('Asset reference could not be replaced')
      }
    }
  }

  const pageUpdates: Array<{
    row: typeof pageTable.$inferSelect
    content: Record<string, unknown>
    updatedAt: Date
  }> = []
  if (pageIds.length) {
    const pages = await db.select().from(pageTable).where(inArray(pageTable.id, pageIds))
    for (const row of pages) {
      try {
        const result = replaceAssetRefs(JSON.parse(row.contentJson), assetId, replacementId)
        if (!result.changed) throw conflict('Asset reference could not be replaced')
        pageUpdates.push({
          row,
          content: result.value as Record<string, unknown>,
          updatedAt: new Date()
        })
      } catch {
        throw conflict('Asset reference could not be replaced')
      }
    }
  }

  if (contentUpdates.length !== contentIds.length || pageUpdates.length !== pageIds.length) {
    throw conflict('Asset reference could not be replaced')
  }

  if (workingRefs.length) {
    await withDbTransaction(event, db, async (tx, statements) => {
      for (const update of contentUpdates) {
        await executeDbStatement(tx.update(contentTable).set({
          contentJson: JSON.stringify(update.content),
          updatedAt: update.updatedAt
        }).where(eq(contentTable.id, update.row.id)), statements)
        await syncContentProjections({
          db: tx,
          registry: update.registry!,
          content: update.content,
          contentId: update.row.id,
          schemaKey: update.row.schemaKey,
          schemaVersion: update.row.schemaVersion,
          status: update.row.status,
          createdAt: update.row.createdAt,
          updatedAt: update.updatedAt,
          projectionScope: 'working',
          trustedOrigin: getTrustedRequestOrigin(event),
          statements
        })
      }
      for (const update of pageUpdates) {
        await executeDbStatement(tx.update(pageTable).set({
          contentJson: JSON.stringify(update.content),
          updatedAt: update.updatedAt
        }).where(eq(pageTable.id, update.row.id)), statements)
        await syncDocumentAssetRefs({
          db: tx,
          documentKind: 'page',
          documentId: update.row.id,
          projectionScope: 'working',
          content: update.content,
          trustedOrigin: getTrustedRequestOrigin(event),
          statements
        })
      }
    })
  }
  await assertAssetIsNotRetained(db, assetId)

  for (const schemaKey of changedSchemas) {
    queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  }

  await db.delete(assetTable).where(eq(assetTable.id, assetId))
  await deleteObject(event, current[0].objectKey)

  return { ok: true, replacedCount: contentUpdates.length + pageUpdates.length }
})
