import { getDb } from '../../../db/db'
import { getInstallationSessionAccess, getRuntimeInstallStatus } from '../../../utils/install'
import {
  clearSetupSessionCookie,
  getMissingCloudflareBindings,
  hashSetupSessionToken,
  readSetupSessionToken
} from '../../../utils/install-session'
import { isAuthRuntimeReady, resolveAuthSigningSecret } from '../../../utils/install-token'
import { resolveOnboardingDeploymentFromEvent } from '../../../utils/onboarding'

export default defineEventHandler(async (event) => {
  const runtime = resolveOnboardingDeploymentFromEvent(event).runtime
  const isCloudflareRuntime = runtime === 'cloudflare'
  const missingBindings = getMissingCloudflareBindings(event)
  if (missingBindings.length) {
    return {
      ready: false,
      canStartSetup: false,
      canInstall: false,
      setupSessionOwned: false,
      phase: 'binding_missing' as const,
      runtime,
      missingBindings,
      missingTables: []
    }
  }

  const db = await getDb(event)
  const status = await getRuntimeInstallStatus(db)
  const signingSecret = resolveAuthSigningSecret(event)
  const runtimeSecretReady = isAuthRuntimeReady(isCloudflareRuntime, signingSecret)

  if (status.phase !== 'migration_required' && !runtimeSecretReady) {
    return {
      ...status,
      ready: false,
      canStartSetup: false,
      canInstall: false,
      setupSessionOwned: false,
      phase: 'configuration_required' as const,
      runtime,
      missingBindings
    }
  }

  if (status.ready) {
    clearSetupSessionCookie(event, isCloudflareRuntime)
    return {
      ...status,
      runtime,
      canStartSetup: false,
      canInstall: false,
      setupSessionOwned: false,
      missingBindings
    }
  }

  if (status.phase === 'migration_required') {
    return {
      ...status,
      runtime,
      canStartSetup: false,
      canInstall: false,
      setupSessionOwned: false,
      missingBindings
    }
  }

  const setupSessionToken = readSetupSessionToken(event)
  const setupSessionHash = setupSessionToken
    ? await hashSetupSessionToken(setupSessionToken, signingSecret)
    : null
  const access = await getInstallationSessionAccess(db, setupSessionHash)
  const setupLocked = access.locked && !access.owned

  return {
    ...status,
    runtime,
    phase: setupLocked ? 'setup_locked' as const : status.phase,
    canStartSetup: status.canInstall && !access.owned && !setupLocked,
    canInstall: status.canInstall && access.owned,
    setupSessionOwned: access.owned,
    retryAfterSeconds: setupLocked ? access.retryAfterSeconds : undefined,
    missingBindings
  }
})
