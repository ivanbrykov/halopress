import { eq } from 'drizzle-orm'
import { setHeader } from 'h3'

import { getDb } from '../../../db/db'
import { asset as assetTable } from '../../../db/schema'
import { getObject } from '../../../storage/assets'
import { notFound } from '../../../utils/http'
import { requireAssetDelivery } from '../../../utils/asset-delivery'
import { applyPortableMutableAssetHeaders } from '../../../utils/portable-content-delivery'

export default defineEventHandler(async (event) => {
  const assetId = event.context.params?.assetId as string
  const delivery = await requireAssetDelivery(event, assetId)
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
  if (delivery.isPublic && applyPortableMutableAssetHeaders(event, obj.identity, contentType)) return
  return obj.bytes
})
