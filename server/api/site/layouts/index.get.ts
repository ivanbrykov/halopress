import { requireAdmin } from '../../../utils/auth'
import { layoutHttpError } from '../../../utils/site-layout-http'
import { listLayouts } from '../../../utils/site-layouts'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  try {
    return await listLayouts(event)
  } catch (error) {
    throw layoutHttpError(error)
  }
})
