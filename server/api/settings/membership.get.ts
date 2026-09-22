import { requireAdmin } from '../../utils/auth'
import { getMembershipSettings, listEligibleMemberRoles } from '../../utils/membership'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [settings, roles] = await Promise.all([
    getMembershipSettings(event),
    listEligibleMemberRoles(event)
  ])
  return { ...settings, roles }
})
