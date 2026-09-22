import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { assetObjectKey } from '../../storage/assets'
import { newId } from '../../utils/ids'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ mimeType?: string; filename?: string; sizeBytes?: number }>(event)
  const assetId = newId()
  const objectKey = assetObjectKey(event, assetId)
  return {
    assetId,
    objectKey,
    uploadUrl: '/api/assets/upload',
    headers: null,
    hint: {
      mimeType: body?.mimeType ?? null,
      filename: body?.filename ?? null,
      sizeBytes: body?.sizeBytes ?? null
    }
  }
})

