import { getRouterParam } from 'h3'

import { requireAdmin } from '../../../../utils/auth'
import { layoutHttpError } from '../../../../utils/site-layout-http'
import { getLayoutUsage } from '../../../../utils/site-layouts'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const layoutId = getRouterParam(event, 'layoutId')
  try {
    return await getLayoutUsage(event, layoutId)
  } catch (error) {
    throw layoutHttpError(error)
  }
})
