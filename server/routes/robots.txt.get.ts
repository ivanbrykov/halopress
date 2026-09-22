import { setHeader } from 'h3'

import { getTrustedRequestOrigin } from '../utils/request-origin'

export default defineEventHandler((event) => {
  const origin = getTrustedRequestOrigin(event) || 'http://localhost'
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /_desk',
    'Disallow: /_install',
    'Disallow: /_preview',
    'Disallow: /account',
    'Disallow: /api',
    'Disallow: /auth',
    'Disallow: /login',
    'Disallow: /signup',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    ''
  ].join('\n')
})
