import { readMultipartFormData } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../../../db/db'
import { asset as assetTable } from '../../../db/schema'
import { assetObjectKey, putObject } from '../../../storage/assets'
import { requireAdmin } from '../../../utils/auth'
import { assertAssetIsNotPublished } from '../../../utils/asset-delivery'
import { badRequest, notFound } from '../../../utils/http'

function kindFromMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const assetId = event.context.params?.assetId as string
  if (!assetId) throw badRequest('Missing assetId')

  const db = await getDb(event)
  const existing = await db
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(eq(assetTable.id, assetId))
    .limit(1)

  if (!existing[0]) throw notFound('Asset not found')
  await assertAssetIsNotPublished(db, assetId)

  const form = await readMultipartFormData(event)
  const file = form?.find(p => p.name === 'file')
  if (!file || !file.data) throw badRequest('Missing file')

  const mimeType = file.type || 'application/octet-stream'
  const bytes = new Uint8Array(file.data)
  const sizeBytes = bytes.byteLength
  const objectKey = assetObjectKey(event, assetId)

  await putObject(event, objectKey, bytes, mimeType)

  await db
    .update(assetTable)
    .set({
      kind: kindFromMime(mimeType),
      status: 'ready',
      objectKey,
      mimeType,
      sizeBytes,
      sha256: null,
      width: null,
      height: null,
      durationMs: null
    })
    .where(eq(assetTable.id, assetId))

  return { ok: true, assetId, mimeType, sizeBytes }
})
