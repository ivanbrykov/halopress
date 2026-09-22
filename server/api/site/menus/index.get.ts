import { requireAdmin } from '../../../utils/auth'
import { siteMenuHttpError } from '../../../utils/site-menu-http'
import { listSiteMenus } from '../../../utils/site-menus'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  try {
    return await listSiteMenus(event)
  } catch (error) {
    throw siteMenuHttpError(error)
  }
})
