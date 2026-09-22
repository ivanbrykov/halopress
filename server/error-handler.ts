import { getRequestHeader, send, setResponseHeaders, setResponseStatus } from 'h3'
import { defineNitroErrorHandler } from 'nitropack/runtime'

export default defineNitroErrorHandler((error, event) => {
  if (event.context.portablePublicResourceNoStore === true) {
    const statusMessage = 'Theme stylesheet not found'
    setResponseStatus(event, 404, statusMessage)
    setResponseHeaders(event, {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/json'
    })
    return send(event, JSON.stringify({
      error: true,
      url: event.path,
      statusCode: 404,
      statusMessage,
      message: statusMessage
    }))
  }
  if (event.context.publicDeliveryPrivateNoindex !== true) return

  const statusCode = Number(error.statusCode) === 404 ? 404 : 500
  const statusMessage = statusCode === 404 ? 'Not Found' : 'Server Error'
  const wantsHtml = String(getRequestHeader(event, 'Accept') || '').includes('text/html')

  setResponseStatus(event, statusCode, statusMessage)
  setResponseHeaders(event, {
    'Cache-Control': 'private, no-store',
    'Vary': 'Cookie',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': 'script-src \'none\'; frame-ancestors \'none\';',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Type': wantsHtml ? 'text/html; charset=utf-8' : 'application/json'
  })

  if (wantsHtml) {
    return send(event, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${statusCode} ${statusMessage}</title></head><body><main><h1>${statusMessage}</h1></main></body></html>`)
  }

  return send(event, JSON.stringify({
    error: true,
    url: event.path,
    statusCode,
    statusMessage,
    message: statusMessage
  }))
})
