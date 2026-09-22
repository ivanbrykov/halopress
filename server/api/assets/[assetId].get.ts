import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { asset as assetTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { notFound } from '../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const assetId = event.context.params?.assetId as string

  if (!assetId) throw notFound('Asset not found')

  const db = await getDb(event)
  const rows = await db
    .select({
      id: assetTable.id,
      kind: assetTable.kind,
      status: assetTable.status,
      mimeType: assetTable.mimeType,
      sizeBytes: assetTable.sizeBytes,
      width: assetTable.width,
      height: assetTable.height,
      durationMs: assetTable.durationMs,
      createdBy: assetTable.createdBy,
      createdAt: assetTable.createdAt
    })
    .from(assetTable)
    .where(eq(assetTable.id, assetId))
    .limit(1)

  const asset = rows[0]
  if (!asset) throw notFound('Asset not found')

  return { asset }
})
