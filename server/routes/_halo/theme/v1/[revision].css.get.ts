import { getRouterParam, setHeader } from 'h3'

import {
  applyPortablePublicResourceHeaders,
  applyPortableStylesheetHeaders
} from '../../../../utils/portable-content-delivery'
import { getSiteThemeArtifactCss } from '../../../../utils/site-theme-settings'

export default defineEventHandler(async (event) => {
  // Nitro's radix3 route for `[revision].css` exposes `revision.css` as the
  // parameter name, including the suffix in the value.
  const routeValue = getRouterParam(event, 'revision.css')
  const routeRevision = typeof routeValue === 'string'
    ? routeValue.match(/^([0-9a-f]{64})(?:\.css)?$/)?.[1]
    : undefined
  const pathRevision = event.path.match(/^\/_halo\/theme\/v1\/([0-9a-f]{64})\.css(?:\?.*)?$/)?.[1]
  const requestedRevision = pathRevision && (!routeRevision || routeRevision === pathRevision)
    ? pathRevision
    : undefined
  const stylesheet = await getSiteThemeArtifactCss(event, requestedRevision)
  if (stylesheet === null) {
    applyPortablePublicResourceHeaders(event)
    setHeader(event, 'Cache-Control', 'no-store')
    event.context.portablePublicResourceNoStore = true
    throw createError({ statusCode: 404, statusMessage: 'Theme stylesheet not found' })
  }
  if (applyPortableStylesheetHeaders(event, stylesheet)) return
  return stylesheet
})
