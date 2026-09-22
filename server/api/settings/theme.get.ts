import { requireAdmin } from '../../utils/auth'
import { getSiteThemeAdmin } from '../../utils/site-theme-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getSiteThemeAdmin(event)
})
