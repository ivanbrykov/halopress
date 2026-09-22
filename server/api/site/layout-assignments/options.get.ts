import { requireAdmin } from '../../../utils/auth'
import { getLayoutAssignmentOptions } from '../../../utils/layout-assignments'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getLayoutAssignmentOptions(event)
})
