import { getRouterParam, readBody } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { requireSiteMenusEnabled, siteMenuHttpError } from '../../../utils/site-menu-http'
import { updateSiteMenu } from '../../../utils/site-menus'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  await requireSiteMenusEnabled(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const menuId = getRouterParam(event, 'menuId')
  const body = await readBody(event)
  try {
    return await updateSiteMenu(event, menuId, body, actorId)
  } catch (error) {
    throw siteMenuHttpError(error)
  }
})
