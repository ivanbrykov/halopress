import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { AuthenticationSettingsValidationError } from '../../utils/authentication-settings'
import { updateGoogleAuthenticationSettings } from '../../utils/google-authentication-settings'
import { badRequest } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)

  try {
    return await updateGoogleAuthenticationSettings(event, body, actorId)
  } catch (error) {
    if (error instanceof AuthenticationSettingsValidationError) {
      throw badRequest(error.message)
    }
    throw error
  }
})
