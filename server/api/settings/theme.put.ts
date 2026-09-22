import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { badRequest, conflict, forbidden } from '../../utils/http'
import { getSiteMode } from '../../utils/site-mode-settings'
import {
  SiteThemeRevisionConflictError,
  SiteThemeValidationError,
  updateSiteTheme
} from '../../utils/site-theme-settings'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  if (!(await getSiteMode(event)).enabled) {
    throw forbidden('Enable Site features before publishing the active Theme')
  }
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)
  try {
    return await updateSiteTheme(event, body, actorId)
  } catch (error) {
    if (error instanceof SiteThemeRevisionConflictError) {
      throw conflict(error.message, { currentRevision: error.currentRevision })
    }
    if (error instanceof SiteThemeValidationError) throw badRequest(error.message)
    throw error
  }
})
