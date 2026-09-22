import { getRouterParam } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { requireSiteMenusEnabled, siteMenuHttpError } from '../../../utils/site-menu-http'
import { deleteSiteMenu } from '../../../utils/site-menus'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await requireSiteMenusEnabled(event)
  const menuId = getRouterParam(event, 'menuId')
  try {
    return await deleteSiteMenu(event, menuId)
  } catch (error) {
    throw siteMenuHttpError(error)
  }
})
