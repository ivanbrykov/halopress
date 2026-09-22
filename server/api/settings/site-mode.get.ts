import { requireAdmin } from '../../utils/auth'
import { getSiteModeAdmin } from '../../utils/site-mode-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getSiteModeAdmin(event)
})
