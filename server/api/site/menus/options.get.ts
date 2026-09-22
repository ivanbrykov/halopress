import { requireAdmin } from '../../../utils/auth'
import { applyPrivateDeliveryHeaders } from '../../../utils/delivery-policy'
import { getSiteMenuSourceOptions } from '../../../utils/site-menu-sources'

export default defineEventHandler(async (event) => {
  applyPrivateDeliveryHeaders(event)
  await requireAdmin(event)
  return await getSiteMenuSourceOptions(event)
})
