import { readBody } from 'h3'

import { requireAdmin } from '../../utils/auth'
import { badRequest, forbidden } from '../../utils/http'
import {
  LayoutAssignmentModeDisabledError,
  LayoutAssignmentValidationError,
  updateSiteLayoutAssignment
} from '../../utils/layout-assignments'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = String((session.user as { id?: string } | undefined)?.id || '').trim() || null
  const body = await readBody(event)
  try {
    return await updateSiteLayoutAssignment(event, body, actorId)
  } catch (error) {
    if (error instanceof LayoutAssignmentModeDisabledError) throw forbidden(error.message)
    if (error instanceof LayoutAssignmentValidationError) throw badRequest(error.message)
    throw error
  }
})
