import { requireAdmin } from '../../utils/auth'
import { getSitePresentationAdmin } from '../../utils/site-presentation-settings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await getSitePresentationAdmin(event)
})
