import { getRequestURL, sendRedirect } from 'h3'

import { getAuthSession } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  if (url.pathname !== '/account' && !url.pathname.startsWith('/account/')) return

  const session = await getAuthSession(event)
  if (!session?.user) {
    const callbackUrl = `${url.pathname}${url.search}`
    return await sendRedirect(event, `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, 302)
  }
})
