import { getRequestURL, sendRedirect } from 'h3'

import { getAuthSession } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/_desk')) return
  if (url.pathname === '/_desk/login') return await sendRedirect(event, '/login?callbackUrl=/_desk', 302)

  const session = await getAuthSession(event)
  if (!session?.user) {
    const callbackUrl = `${url.pathname}${url.search}`
    return await sendRedirect(event, `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, 302)
  }
  if (session.user.role !== 'admin' || session.user.accountType !== 'staff') {
    return await sendRedirect(event, '/', 302)
  }
})
