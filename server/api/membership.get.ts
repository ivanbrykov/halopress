import { getPublicMembershipSettings } from '../utils/membership'

export default defineEventHandler(async (event) => {
  return await getPublicMembershipSettings(event)
})
