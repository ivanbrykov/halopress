import { setHeader } from 'h3'

import { applyPortablePublicEnvelopeHeaders } from '../../utils/portable-content-delivery'
import { getPublicSiteThemeManifest } from '../../utils/site-theme-settings'

export default defineEventHandler(async (event) => {
  const manifest = await getPublicSiteThemeManifest(event)
  setHeader(event, 'Cache-Control', 'public, max-age=0, must-revalidate')
  if (applyPortablePublicEnvelopeHeaders(event, manifest)) return
  return manifest
})
