import { readBody } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { layoutHttpError, requireSiteLayoutsEnabled } from '../../../utils/site-layout-http'
import { createLayout } from '../../../utils/site-layouts'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  await requireSiteLayoutsEnabled(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)
  try {
    return await createLayout(event, body, actorId)
  } catch (error) {
    throw layoutHttpError(error)
  }
})
