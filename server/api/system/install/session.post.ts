import { createError } from 'h3'

import { getDb } from '../../../db/db'
import {
  getInstallationSessionAccess,
  getRuntimeInstallStatus,
  refreshInstallationSession,
  reserveInstallationSession
} from '../../../utils/install'
import {
  SETUP_SESSION_TTL_MILLISECONDS,
  createSetupSessionToken,
  getMissingCloudflareBindings,
  hashSetupSessionToken,
  readSetupSessionToken,
  requireSameOriginSetupRequest,
  writeSetupSessionCookie
} from '../../../utils/install-session'
import { isAuthRuntimeReady, resolveAuthSigningSecret } from '../../../utils/install-token'
import { resolveOnboardingDeploymentFromEvent } from '../../../utils/onboarding'

export default defineEventHandler(async (event) => {
  requireSameOriginSetupRequest(event)

  const isCloudflareRuntime = resolveOnboardingDeploymentFromEvent(event).runtime === 'cloudflare'
  const missingBindings = getMissingCloudflareBindings(event)
  if (missingBindings.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Cloudflare bindings are incomplete',
      data: { phase: 'binding_missing', missingBindings }
    })
  }

  const signingSecret = resolveAuthSigningSecret(event)
  if (!isAuthRuntimeReady(isCloudflareRuntime, signingSecret)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Cloudflare setup requires a strong runtime secret',
      data: { phase: 'configuration_required' }
    })
  }

  const db = await getDb(event)
  const status = await getRuntimeInstallStatus(db)
  if (status.ready) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (status.phase === 'migration_required') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database migrations are incomplete',
      data: { phase: status.phase, missingTables: status.missingTables }
    })
  }

  const existingToken = readSetupSessionToken(event)
  if (existingToken) {
    const existingHash = await hashSetupSessionToken(existingToken, signingSecret)
    if (await refreshInstallationSession(db, existingHash)) {
      writeSetupSessionCookie(event, existingToken, isCloudflareRuntime)
      return {
        ok: true,
        phase: status.phase,
        setupSessionOwned: true,
        expiresInSeconds: SETUP_SESSION_TTL_MILLISECONDS / 1000
      }
    }
  }

  const setupSessionToken = createSetupSessionToken()
  const setupSessionHash = await hashSetupSessionToken(setupSessionToken, signingSecret)
  if (await reserveInstallationSession(db, setupSessionHash)) {
    writeSetupSessionCookie(event, setupSessionToken, isCloudflareRuntime)
    return {
      ok: true,
      phase: status.phase,
      setupSessionOwned: true,
      expiresInSeconds: SETUP_SESSION_TTL_MILLISECONDS / 1000
    }
  }

  const access = await getInstallationSessionAccess(db, null)
  throw createError({
    statusCode: 409,
    statusMessage: 'Setup is reserved by another browser',
    data: {
      phase: 'setup_locked',
      retryAfterSeconds: access.retryAfterSeconds
    }
  })
})
