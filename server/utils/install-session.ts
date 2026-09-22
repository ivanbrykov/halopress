import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getHeader, getRequestURL, setCookie } from 'h3'

export const SETUP_SESSION_COOKIE = 'halopress_setup_session'
const SETUP_SESSION_BYTES = 32
const SETUP_SESSION_MAX_AGE_SECONDS = 15 * 60
export const SETUP_SESSION_TTL_MILLISECONDS = SETUP_SESSION_MAX_AGE_SECONDS * 1000

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function createSetupSessionToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(SETUP_SESSION_BYTES))
  return bytesToHex(bytes)
}

export async function hashSetupSessionToken(token: string, signingSecret: string) {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(token))
  return bytesToHex(new Uint8Array(digest))
}

export function readSetupSessionToken(event: H3Event) {
  return getCookie(event, SETUP_SESSION_COOKIE) || ''
}

export function writeSetupSessionCookie(event: H3Event, token: string, isCloudflareRuntime: boolean) {
  setCookie(event, SETUP_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isCloudflareRuntime,
    sameSite: 'lax',
    path: '/',
    maxAge: SETUP_SESSION_MAX_AGE_SECONDS
  })
}

export function clearSetupSessionCookie(event: H3Event, isCloudflareRuntime: boolean) {
  deleteCookie(event, SETUP_SESSION_COOKIE, {
    httpOnly: true,
    secure: isCloudflareRuntime,
    sameSite: 'lax',
    path: '/'
  })
}

export function isSameOriginSetupRequest(origin: string, requestOrigin: string, secFetchSite = '') {
  if (!origin || origin !== requestOrigin) return false
  return !secFetchSite || secFetchSite === 'same-origin'
}

export function requireSameOriginSetupRequest(event: H3Event) {
  const origin = getHeader(event, 'origin') || ''
  const secFetchSite = getHeader(event, 'sec-fetch-site') || ''
  const requestOrigin = getRequestURL(event).origin
  if (!isSameOriginSetupRequest(origin, requestOrigin, secFetchSite)) {
    throw createError({ statusCode: 403, statusMessage: 'Setup request must come from the same origin' })
  }
}

export function getMissingCloudflareBindings(event: H3Event) {
  const cloudflare = (event as any)?.context?.cloudflare
  if (!cloudflare) return [] as string[]

  const missingBindings: string[] = []
  if (!cloudflare.env?.DB) missingBindings.push('DB')
  if (!cloudflare.env?.CONTENT_ASSETS && !cloudflare.env?.R2) missingBindings.push('CONTENT_ASSETS')
  return missingBindings
}
