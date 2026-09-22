import { requireAdmin } from '../../utils/auth'
import { getSiteLayoutAssignmentAdmin } from '../../utils/layout-assignments'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getSiteLayoutAssignmentAdmin(event)
})
