import { getRouterParam } from 'h3'

import { requireAdmin } from '../../../utils/auth'
import { layoutHttpError } from '../../../utils/site-layout-http'
import { getLayout } from '../../../utils/site-layouts'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const layoutId = getRouterParam(event, 'layoutId')
  try {
    return await getLayout(event, layoutId)
  } catch (error) {
    throw layoutHttpError(error)
  }
})
