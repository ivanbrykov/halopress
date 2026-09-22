import { readBody } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { requireSiteMenusEnabled, siteMenuHttpError } from '../../../utils/site-menu-http'
import { createSiteMenu } from '../../../utils/site-menus'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  await requireSiteMenusEnabled(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)
  try {
    return await createSiteMenu(event, body, actorId)
  } catch (error) {
    throw siteMenuHttpError(error)
  }
})
