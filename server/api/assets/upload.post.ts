import { readMultipartFormData } from 'h3'

import { getDb } from '../../db/db'
import { asset as assetTable } from '../../db/schema'
import { assetObjectKey, putObject } from '../../storage/assets'
import { requireAdmin } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { newId } from '../../utils/ids'

function kindFromMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const form = await readMultipartFormData(event)
  const file = form?.find(p => p.name === 'file')
  if (!file || !file.data) throw badRequest('Missing file')

  const assetId = newId()
  const mimeType = file.type || 'application/octet-stream'
  const bytes = new Uint8Array(file.data)
  const sizeBytes = bytes.byteLength
  const objectKey = assetObjectKey(event, assetId)

  await putObject(event, objectKey, bytes, mimeType)

  const db = await getDb(event)
  const now = new Date()
  await db.insert(assetTable).values({
    id: assetId,
    kind: kindFromMime(mimeType),
    status: 'ready',
    objectKey,
    mimeType,
    sizeBytes,
    sha256: null,
    width: null,
    height: null,
    durationMs: null,
    createdBy: actorId,
    createdAt: now
  })

  return { ok: true, assetId, objectKey, mimeType, sizeBytes }
})
