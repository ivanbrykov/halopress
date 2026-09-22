import { setHeader } from 'h3'

import { getPublicSitePresentation } from '../../utils/site-presentation-settings'

export default defineEventHandler(async (event) => {
  const presentation = await getPublicSitePresentation(event)
  setHeader(event, 'Cache-Control', 'public, max-age=0, must-revalidate')
  setHeader(event, 'ETag', `"${presentation.revision}"`)
  return presentation
})
