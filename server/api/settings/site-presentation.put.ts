import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { badRequest, conflict } from '../../utils/http'
import {
  SitePresentationAppearanceMigratedError,
  SitePresentationNavigationMigratedError,
  SitePresentationValidationError,
  updateSitePresentation
} from '../../utils/site-presentation-settings'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)

  try {
    return await updateSitePresentation(event, body, actorId)
  } catch (error) {
    if (error instanceof SitePresentationAppearanceMigratedError) {
      throw conflict(error.message, { location: error.location })
    }
    if (error instanceof SitePresentationNavigationMigratedError) {
      throw conflict(error.message, { menuId: error.menuId, location: error.location })
    }
    if (error instanceof SitePresentationValidationError) throw badRequest(error.message)
    throw error
  }
})
