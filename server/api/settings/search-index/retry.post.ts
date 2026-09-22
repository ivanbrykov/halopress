import { getDb } from '../../../db/db'
import { requireAdmin } from '../../../utils/auth'
import { retryFailedFullTextJobs } from '../../../utils/full-text-operations'
import { queueFullTextReconcile } from '../../../utils/full-text-queue'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const result = await retryFailedFullTextJobs(await getDb(event))
  queueFullTextReconcile(event)
  return result
})
