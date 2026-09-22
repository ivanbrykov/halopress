import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import {
  SiteModeValidationError,
  updateSiteMode
} from '../../utils/site-mode-settings'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)

  try {
    return await updateSiteMode(event, body, actorId)
  } catch (error) {
    if (error instanceof SiteModeValidationError) throw badRequest(error.message)
    throw error
  }
})
