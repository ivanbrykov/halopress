import { getQuery } from 'h3'
import { getPublishedPage } from '../../../cms/page-delivery'
import { getDb } from '../../../db/db'
import { applyPublicDeliveryHeaders } from '../../../utils/delivery-policy'
import { notFound } from '../../../utils/http'
import {
  applyPortablePublicEnvelopeHeaders
} from '../../../utils/portable-content-delivery'
import { createStandalonePageRenderingForEvent } from '../../../utils/standalone-document-renderer'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id as string
  if (!id) throw notFound('Page not found')
  const result = await getPublishedPage(await getDb(event), id)
  const includeRendering = getQuery(event).rendering !== '0'
  const response = {
    ...result,
    ...(includeRendering
      ? { rendering: createStandalonePageRenderingForEvent(event, result.content) }
      : {})
  }
  applyPublicDeliveryHeaders(event)
  if (applyPortablePublicEnvelopeHeaders(event, response)) return
  return response
})
