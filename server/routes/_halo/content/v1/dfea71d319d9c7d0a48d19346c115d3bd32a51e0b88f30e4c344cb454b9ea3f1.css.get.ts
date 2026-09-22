import { applyPortableStylesheetHeaders } from '../../../../utils/portable-content-delivery'

export default defineEventHandler(async (event) => {
  const stylesheet = await useStorage('assets:server').getItem<string>('portable-content-v1.css')
  if (typeof stylesheet !== 'string') {
    throw createError({ statusCode: 500, statusMessage: 'Portable stylesheet unavailable' })
  }
  if (applyPortableStylesheetHeaders(event, stylesheet)) return
  return stylesheet
})
