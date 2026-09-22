import { createError } from 'h3'

import { getDb } from '../../../db/db'
import { getInstallStatus, runCloudflareMigrations } from '../../../utils/install'
import { getMissingCloudflareBindings, requireSameOriginSetupRequest } from '../../../utils/install-session'

export default defineEventHandler(async (event) => {
  requireSameOriginSetupRequest(event)

  const cloudflare = (event as any)?.context?.cloudflare
  if (import.meta.dev || !cloudflare) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const missingBindings = getMissingCloudflareBindings(event)
  if (missingBindings.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Cloudflare bindings are incomplete',
      data: { phase: 'binding_missing', missingBindings }
    })
  }

  const db = await getDb(event)
  const before = await getInstallStatus(db)
  if (before.ready) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (before.phase !== 'migration_required') {
    throw createError({ statusCode: 409, statusMessage: 'Database migrations are not required' })
  }

  await runCloudflareMigrations(db)
  const after = await getInstallStatus(db)
  if (after.phase === 'migration_required') {
    throw createError({
      statusCode: 500,
      statusMessage: 'Database migrations did not complete',
      data: { phase: after.phase, missingTables: after.missingTables }
    })
  }

  return { ok: true, phase: after.phase }
})
