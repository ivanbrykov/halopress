import { createError, readBody } from 'h3'

import { getDb } from '../../db/db'
import { getAdminUserByIdentifier, isAdminLoginAllowedDb } from '../../utils/auth'
import { badRequest, notFound, unauthorized } from '../../utils/http'
import {
  beginInstallation,
  completeInstallation,
  ensureAdminUser,
  ensureBootstrapSchema,
  failInstallation,
  getInstallationSessionAccess,
  getRuntimeInstallStatus,
  seedRoles
} from '../../utils/install'
import { installInputSchema } from '../../utils/install-input'
import {
  clearSetupSessionCookie,
  getMissingCloudflareBindings,
  hashSetupSessionToken,
  readSetupSessionToken,
  requireSameOriginSetupRequest
} from '../../utils/install-session'
import { isAuthRuntimeReady, resolveAuthSigningSecret } from '../../utils/install-token'
import { resolveOnboardingDeploymentFromEvent } from '../../utils/onboarding'
import { upsertSetting } from '../../utils/settings'

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

  const setupSessionToken = readSetupSessionToken(event)
  if (!setupSessionToken) throw unauthorized('Setup session is required')
  const setupSessionHash = await hashSetupSessionToken(setupSessionToken, signingSecret)

  const db = await getDb(event)
  const status = await getRuntimeInstallStatus(db)
  if (status.ready) throw notFound()
  if (status.phase === 'migration_required') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database migrations are incomplete',
      data: { phase: status.phase, missingTables: status.missingTables }
    })
  }

  const access = await getInstallationSessionAccess(db, setupSessionHash)
  if (!access.owned) throw unauthorized('Setup session is invalid or expired')

  const parsed = installInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw badRequest('Invalid setup input', {
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }
  const { email, name, password, sampleData } = parsed.data

  const claim = await beginInstallation(db, setupSessionHash)
  if (!claim) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Installation is already in progress',
      data: { phase: 'installing' }
    })
  }

  try {
    let sub = 'system:install'
    if ((status.userCount ?? 0) > 0) {
      const allowed = await isAdminLoginAllowedDb(event, email, password)
      if (!allowed) throw unauthorized('Invalid admin credentials')
      const adminUser = await getAdminUserByIdentifier(event, email)
      if (!adminUser) throw unauthorized('Invalid admin credentials')
      sub = `user:${adminUser.id}`
    }

    await seedRoles(db)
    await upsertSetting({
      key: 'auth.oauth.credentials.enabled',
      value: 'true',
      valueType: 'boolean',
      groupKey: 'auth.oauth',
      updatedBy: sub
    }, event)

    if (sampleData) {
      const schemaKey = await ensureBootstrapSchema(db, sub, event)
      if (!schemaKey) throw new Error('Starter schema could not be created safely')
    }

    if ((status.userCount ?? 0) === 0) {
      const adminId = await ensureAdminUser(db, { email, name, password })
      if (!adminId) throw createError({ statusCode: 409, statusMessage: 'Admin user already exists' })
      sub = `user:${adminId}`
    }

    await completeInstallation(db, claim.leaseToken, sub, event)
    clearSetupSessionCookie(event, isCloudflareRuntime)
    return { ok: true }
  } catch (error) {
    try {
      await failInstallation(db, claim.leaseToken, error)
    } catch (leaseError) {
      console.error('[install] Failed to release installation lease', leaseError)
    }
    throw error
  }
})
