import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { enqueueFullTextReindex } from '../../../utils/full-text-operations'
import { queueFullTextReconcile } from '../../../utils/full-text-queue'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const result = await enqueueFullTextReindex(await getDb(event))
  queueFullTextReconcile(event)
  return result
})
