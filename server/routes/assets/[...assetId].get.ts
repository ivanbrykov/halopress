import { eq } from 'drizzle-orm'
import { setHeader } from 'h3'

import { getDb } from '../../db/db'
import { asset as assetTable } from '../../db/schema'
import { getObject } from '../../storage/assets'
import { notFound } from '../../utils/http'
import { requireAssetDelivery } from '../../utils/asset-delivery'
import { applyPortableMutableAssetHeaders } from '../../utils/portable-content-delivery'

function normalizeSegments(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split('/').filter(Boolean)
  return []
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/"/g, '').trim()
}

export default defineEventHandler(async (event) => {
  const rawParam = event.context.params?.assetId
  const parts = normalizeSegments(rawParam)
  const assetId = parts[0]
  if (!assetId) throw notFound('Asset not found')
  const delivery = await requireAssetDelivery(event, assetId)

  const filename = parts.length > 1 ? parts[parts.length - 1] : null

  const db = await getDb(event)
  const row = await db
    .select({
      objectKey: assetTable.objectKey,
      mimeType: assetTable.mimeType
    })
    .from(assetTable)
    .where(eq(assetTable.id, assetId))
    .get()

  if (!row) throw notFound('Asset not found')
  const obj = await getObject(event, row.objectKey)
  if (!obj) throw notFound('Asset object not found')

  const contentType = row.mimeType || obj.contentType || 'application/octet-stream'
  setHeader(event, 'content-type', contentType)

  if (filename) {
    const safeName = sanitizeFilename(filename)
    if (safeName) {
      setHeader(event, 'content-disposition', `inline; filename="${safeName}"`)
      setHeader(event, 'x-asset-filename', safeName)
    }
  }

  if (delivery.isPublic && applyPortableMutableAssetHeaders(event, obj.identity, contentType)) return

  return obj.bytes
})
