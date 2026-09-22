import { setResponseHeaders } from 'h3'

import {
  createPortablePageRendering,
  createPortableStandaloneDocument,
  type PortableThemeArtifact
} from '../../../shared/portable-content'
import { requireAdmin } from '../../utils/auth'
import { applyPreviewDeliveryHeaders } from '../../utils/delivery-policy'
import { requireTrustedRequestOrigin } from '../../utils/request-origin'
import { getPublicSiteThemeManifest } from '../../utils/site-theme-settings'

const previewDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'A portable HaloPress page' }]
    },
    {
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Body typography, semantic colors, spacing, and radii come from the published Theme artifact.'
      }]
    },
    {
      type: 'blockquote',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'This server-owned standalone fixture loads the current published Theme digest.'
        }]
      }]
    }
  ]
}

export default defineEventHandler(async (event) => {
  applyPreviewDeliveryHeaders(event)
  await requireAdmin(event)
  const origin = requireTrustedRequestOrigin(event)
  const manifest = await getPublicSiteThemeManifest(event)
  const theme = {
    revision: manifest.revision,
    stylesheetRevision: manifest.stylesheetRevision,
    stylesheetUrl: manifest.stylesheetUrl,
    colorMode: manifest.colorMode
  } satisfies PortableThemeArtifact
  const rendering = createPortablePageRendering(previewDocument, { origin, theme })
  setResponseHeaders(event, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': 'default-src \'none\'; img-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'self\'',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  return createPortableStandaloneDocument(rendering, { title: 'Published HaloPress Theme preview' })
})
