import { createHash } from 'node:crypto'
import { getRequestHeader, getResponseHeader, setHeader, setResponseStatus, type H3Event } from 'h3'

export function createStrongEtag(value: string | Uint8Array) {
  const digest = createHash('sha256').update(value).digest('base64url')
  return `"sha256-${digest}"`
}

export function requestMatchesEtag(event: H3Event, etag: string) {
  const value = getRequestHeader(event, 'if-none-match')
  if (typeof value !== 'string') return false
  const normalizedEtag = etag.replace(/^W\//i, '')
  return value.split(',').map(candidate => candidate.trim()).some((candidate) => {
    if (candidate === '*') return true
    return candidate.replace(/^W\//i, '') === normalizedEtag
  })
}

export function applyPortablePublicResourceHeaders(event: H3Event) {
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Cross-Origin-Resource-Policy', 'cross-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
}

export function applyPortablePublicEnvelopeHeaders(event: H3Event, response: unknown) {
  applyPortablePublicResourceHeaders(event)
  const vary = String(getResponseHeader(event, 'Vary') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (!vary.some(value => value.toLowerCase() === 'x-forwarded-proto')) vary.push('X-Forwarded-Proto')
  setHeader(event, 'Vary', vary.join(', '))
  const etag = createStrongEtag(JSON.stringify(response))
  setHeader(event, 'ETag', etag)
  if (!requestMatchesEtag(event, etag)) return false
  setResponseStatus(event, 304)
  return true
}

export function applyPortableStylesheetHeaders(event: H3Event, stylesheet: string) {
  applyPortablePublicResourceHeaders(event)
  const etag = createStrongEtag(stylesheet)
  setHeader(event, 'Content-Type', 'text/css; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'ETag', etag)
  if (!requestMatchesEtag(event, etag)) return false
  setResponseStatus(event, 304)
  return true
}

export function applyPortableMutableAssetHeaders(
  event: H3Event,
  objectIdentity: string,
  contentType: string
) {
  applyPortablePublicResourceHeaders(event)
  setHeader(event, 'Cache-Control', 'public, max-age=0, must-revalidate')
  const etag = createStrongEtag(`${objectIdentity}\0${contentType}`)
  setHeader(event, 'ETag', etag)
  if (!requestMatchesEtag(event, etag)) return false
  setResponseStatus(event, 304)
  return true
}
