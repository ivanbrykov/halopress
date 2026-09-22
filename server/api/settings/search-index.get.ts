import { getDb } from '../../db/db'
import { requireAdmin } from '../../utils/auth'
import { getFullTextOperationsStatus } from '../../utils/full-text-operations'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getFullTextOperationsStatus(await getDb(event))
})
