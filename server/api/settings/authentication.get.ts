import { requireAdmin } from '../../utils/auth'
import { getGoogleAuthenticationSettings } from '../../utils/google-authentication-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getGoogleAuthenticationSettings(event)
})
