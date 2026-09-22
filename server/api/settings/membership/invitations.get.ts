import { requireAdmin } from '../../../utils/auth'
import { listMembershipInvitations } from '../../../utils/member-registration'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { items: await listMembershipInvitations(event) }
})
