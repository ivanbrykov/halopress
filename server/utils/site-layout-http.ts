import { createError } from 'h3'

import {
  LayoutInUseError,
  LayoutNameConflictError,
  LayoutNotFoundError,
  LayoutStorageUnavailableError,
  LayoutValidationError
} from './site-layouts'
import { badRequest, conflict, forbidden, notFound } from './http'
import { getSiteMode } from './site-mode-settings'

export async function requireSiteLayoutsEnabled(event: Parameters<typeof getSiteMode>[0]) {
  const mode = await getSiteMode(event)
  if (!mode.enabled) throw forbidden('Enable Site features before changing Layouts')
}

export function parseLayoutRevisionQuery(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new LayoutValidationError('revision must be exactly one positive integer query value')
  }
  const revision = Number(value)
  if (!Number.isSafeInteger(revision)) {
    throw new LayoutValidationError('revision must be exactly one positive integer query value')
  }
  return revision
}

export function layoutHttpError(error: unknown) {
  if (error instanceof LayoutValidationError) return badRequest(error.message, { issues: error.issues })
  if (error instanceof LayoutNotFoundError) return notFound(error.message)
  if (error instanceof LayoutNameConflictError) return conflict(error.message)
  if (error instanceof LayoutInUseError) return conflict(error.message, { usage: error.usage })
  if (error instanceof LayoutStorageUnavailableError) {
    return createError({ statusCode: 503, statusMessage: error.message })
  }
  return error
}
