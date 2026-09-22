import { getQuery, getRouterParam } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import {
  layoutHttpError,
  parseLayoutRevisionQuery,
  requireSiteLayoutsEnabled
} from '../../../utils/site-layout-http'
import { deleteLayout } from '../../../utils/site-layouts'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  await requireSiteLayoutsEnabled(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const layoutId = getRouterParam(event, 'layoutId')
  try {
    // Nitro's Cloudflare preset forwards bodies only for POST, PUT, and PATCH.
    // Keep the optimistic precondition in a strictly parsed query value so a
    // DELETE never waits on the unavailable request stream.
    const revision = parseLayoutRevisionQuery(getQuery(event).revision)
    return await deleteLayout(event, layoutId, { revision }, actorId)
  } catch (error) {
    throw layoutHttpError(error)
  }
})
