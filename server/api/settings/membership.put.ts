import { createError, readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { updateMembershipSettings } from '../../utils/membership'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String(session.user?.id || '').trim() || null
  try {
    return await updateMembershipSettings(event, await readBody(event), actorId)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid membership settings'
    })
  }
})
