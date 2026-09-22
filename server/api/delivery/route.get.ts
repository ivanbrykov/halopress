import { getQuery } from 'h3'

import { resolvePublicRoute } from '../../cms/public-routes'
import { resolvePublicSeo } from '../../cms/public-seo'
import { getDb } from '../../db/db'
import { applyPreviewDeliveryHeaders, applyPublicDeliveryHeaders } from '../../utils/delivery-policy'
import { badRequest, notFound } from '../../utils/http'
import { resolvePublicLayoutRendering } from '../../utils/layout-rendering'
import { applyPortablePublicEnvelopeHeaders } from '../../utils/portable-content-delivery'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const path = query.path
  if (typeof path !== 'string' || !path) throw badRequest('Public path is required')
  const db = await getDb(event)
  const route = await resolvePublicRoute(db, path)
  if (!route) {
    event.context.publicDeliveryPrivateNoindex = true
    applyPreviewDeliveryHeaders(event)
    throw notFound('Public route not found')
  }
  const seo = await resolvePublicSeo({
    event,
    db,
    documentKind: route.documentKind,
    documentId: route.documentId,
    schemaKey: route.schemaKey,
    canonicalPath: route.canonicalPath,
    overrides: route.seo
  })
  // Public route visibility/canonical authorization and SEO resolution must
  // complete before any persisted Layout, Theme, or Menu resource is read.
  const layout = query.includeLayout === '1' && route.routeKind === 'canonical'
    ? await resolvePublicLayoutRendering(event, {
        visibility: 'public',
        documentKind: route.documentKind,
        documentId: route.documentId,
        schemaKey: route.schemaKey,
        schemaVersion: null,
        canonicalPath: route.canonicalPath
      })
    : undefined
  const response = { ...route, seo, ...(layout ? { layout } : {}) }
  applyPublicDeliveryHeaders(event)
  if (layout && applyPortablePublicEnvelopeHeaders(event, response)) return
  return response
})
