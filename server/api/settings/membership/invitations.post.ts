import { createError, readBody } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { createMembershipInvitation, RegistrationError } from '../../../utils/member-registration'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String(session.user?.id || '').trim()
  try {
    return await createMembershipInvitation(event, await readBody(event), actorId)
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid invitation'
    })
  }
})
