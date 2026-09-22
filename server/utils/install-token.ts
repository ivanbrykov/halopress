import type { H3Event } from 'h3'

export const DEVELOPMENT_AUTH_SECRET = 'dev-secret-change-me'
const MINIMUM_PRODUCTION_TOKEN_BYTES = 24

function encodedLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
}

export function hasStrongInstallToken(token: string) {
  return encodedLength(token) >= MINIMUM_PRODUCTION_TOKEN_BYTES
    && token !== DEVELOPMENT_AUTH_SECRET
}

export function isAuthRuntimeReady(isCloudflareRuntime: boolean, signingSecret: string) {
  return !isCloudflareRuntime || hasStrongInstallToken(signingSecret)
}

export function selectAuthSigningSecret(authSecretInput: string, installTokenInput: string) {
  const authSecret = authSecretInput.trim()
  const installToken = installTokenInput.trim()
  if (hasStrongInstallToken(authSecret)) return authSecret
  if (hasStrongInstallToken(installToken)) return installToken
  return authSecret || installToken || DEVELOPMENT_AUTH_SECRET
}

export function resolveAuthSigningSecret(event?: H3Event) {
  const config = useRuntimeConfig(event)
  return selectAuthSigningSecret(
    String(config.authSecret || ''),
    String(config.installToken || '')
  )
}

export async function fingerprintSecret(secret: string) {
  const digest = await sha256(secret)
  return Array.from(digest.slice(0, 12))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
