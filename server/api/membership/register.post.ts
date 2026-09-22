import { createError, getHeader, getRequestURL, readBody, setResponseHeader } from 'h3'

import { getDb } from '../../db/db'
import {
  consumeRegistrationRateLimit,
  getRegistrationRequestIp,
  registerPasswordMember,
  registrationInputSchema,
  registrationRateLimitKeys,
  RegistrationError
} from '../../utils/member-registration'
import { getTenantKey } from '../../utils/tenant'
import { resolveCredentialsEnabled } from '../../utils/oauth'

export default defineEventHandler(async (event) => {
  const origin = String(getHeader(event, 'origin') || '').trim()
  const fetchSite = String(getHeader(event, 'sec-fetch-site') || '').trim().toLowerCase()
  if ((origin && origin !== getRequestURL(event).origin) || fetchSite === 'cross-site') {
    throw createError({ statusCode: 403, statusMessage: 'Cross-site registration is not allowed' })
  }
  if (!(await resolveCredentialsEnabled(event))) {
    throw createError({ statusCode: 403, statusMessage: 'Password registration is not available' })
  }
  const body = await readBody(event)
  const parsed = registrationInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid email and a password of at least 12 characters' })
  }

  const db = await getDb(event)
  const now = new Date()
  const keys = await registrationRateLimitKeys({
    tenantKey: getTenantKey(event),
    ip: getRegistrationRequestIp(event),
    email: parsed.data.email,
    now
  })

  try {
    await consumeRegistrationRateLimit(db, keys, now)
    return await registerPasswordMember(event, parsed.data)
  } catch (error) {
    if (error instanceof RegistrationError) {
      if (error.retryAfterSeconds) setResponseHeader(event, 'retry-after', error.retryAfterSeconds)
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
