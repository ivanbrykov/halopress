import { desc } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../db/db'
import { asset as assetTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const limit = Math.min(Number(q.limit ?? 50) || 50, 100)
  const db = await getDb(event)
  const items = await db
    .select({
      id: assetTable.id,
      kind: assetTable.kind,
      status: assetTable.status,
      mimeType: assetTable.mimeType,
      sizeBytes: assetTable.sizeBytes,
      createdAt: assetTable.createdAt
    })
    .from(assetTable)
    .orderBy(desc(assetTable.createdAt))
    .limit(limit)

  return { items }
})

