import { setHeader } from 'h3'

import { publicPathToHref } from '../../shared/public-routing'
import { listCanonicalPublicRoutes, type PublicRouteRow } from '../cms/public-routes'
import { getDb } from '../db/db'
import { getTrustedRequestOrigin } from '../utils/request-origin'

function xml(value: string) {
  return value.replace(/[<>&"']/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    '\'': '&apos;'
  })[character]!)
}

export default defineEventHandler(async (event) => {
  const origin = getTrustedRequestOrigin(event) || 'http://localhost'
  const routes = await listCanonicalPublicRoutes(await getDb(event))
  const urls = routes.map((route: PublicRouteRow) => [
    '  <url>',
    `    <loc>${xml(new URL(publicPathToHref(route.path), origin).href)}</loc>`,
    `    <lastmod>${new Date(route.updatedAt).toISOString()}</lastmod>`,
    '  </url>'
  ].join('\n')).join('\n')
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
