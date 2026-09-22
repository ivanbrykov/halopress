import { readBody } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { asset as assetTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest } from '../../utils/http'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ assetId?: string }>(event)
  if (!body?.assetId) throw badRequest('Missing assetId')
  const db = await getDb(event)

  await db
    .update(assetTable)
    .set({ status: 'ready' })
    .where(eq(assetTable.id, body.assetId))

  return { ok: true }
})
