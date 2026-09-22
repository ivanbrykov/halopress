import { createError } from 'h3'

import {
  SiteMenuInUseError,
  SiteMenuNameConflictError,
  SiteMenuNotFoundError,
  SiteMenuStorageUnavailableError,
  SiteMenuValidationError
} from './site-menus'
import { badRequest, conflict, forbidden, notFound } from './http'
import { getSiteMode } from './site-mode-settings'

export async function requireSiteMenusEnabled(event: Parameters<typeof getSiteMode>[0]) {
  const mode = await getSiteMode(event)
  if (!mode.enabled) throw forbidden('Enable Site features before changing menu sets')
}

export function siteMenuHttpError(error: unknown) {
  if (error instanceof SiteMenuValidationError) return badRequest(error.message, { issues: error.issues })
  if (error instanceof SiteMenuNotFoundError) return notFound(error.message)
  if (error instanceof SiteMenuNameConflictError) return conflict(error.message)
  if (error instanceof SiteMenuInUseError) return conflict(error.message, { usage: error.usage })
  if (error instanceof SiteMenuStorageUnavailableError) {
    return createError({ statusCode: 503, statusMessage: error.message })
  }
  return error
}
