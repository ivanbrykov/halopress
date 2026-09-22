import { createError, getRequestHeader, getRequestProtocol, type H3Event } from 'h3'

type TrustedOriginInput = {
  host?: unknown
  forwardedHost?: unknown
  forwarded?: unknown
  forwardedProto?: unknown
  directProtocol?: unknown
  platformUrl?: unknown
  canonicalOrigin?: unknown
  isCloudflare?: boolean
  allowHostFallback?: boolean
}

function normalizeRequestHost(value: unknown) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate || candidate.length > 255 || /[\s,/@\\?#]/.test(candidate)) return null
  try {
    const parsed = new URL(`http://${candidate}`)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    if (!parsed.hostname || (parsed.port && !/^\d+$/.test(parsed.port))) return null
    return parsed.host.toLowerCase()
  } catch {
    return null
  }
}

function forwardedParameter(value: unknown, name: 'host' | 'proto') {
  if (typeof value !== 'string' || !value.trim()) return null
  const first = value.split(',')[0]?.trim() ?? ''
  const match = first.match(new RegExp(`(?:^|;)\\s*${name}=(?:"([^"]*)"|([^;\\s]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? '') : null
}

export function normalizeConfiguredCanonicalOrigin(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new TypeError('canonicalOrigin must be an absolute HTTP(S) origin')
  }
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
      throw new TypeError('canonicalOrigin must be an absolute HTTP(S) origin')
    }
    return parsed.origin
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('canonicalOrigin')) throw error
    throw new TypeError('canonicalOrigin must be an absolute HTTP(S) origin')
  }
}

export function resolveTrustedRequestOrigin(input: TrustedOriginInput) {
  const host = normalizeRequestHost(input.host)
  if (!host) return undefined

  if (input.forwardedHost !== undefined) {
    const forwardedHost = normalizeRequestHost(input.forwardedHost)
    if (!forwardedHost || forwardedHost !== host) return undefined
  }

  const standardForwardedHost = forwardedParameter(input.forwarded, 'host')
  if (standardForwardedHost !== null) {
    const forwardedHost = normalizeRequestHost(standardForwardedHost)
    if (!forwardedHost || forwardedHost !== host) return undefined
  }

  const forwardedProto = typeof input.forwardedProto === 'string' ? input.forwardedProto : undefined
  if (forwardedProto !== undefined && !['http', 'https'].includes(forwardedProto)) return undefined
  const protocol = forwardedProto || input.directProtocol
  if (protocol !== 'http' && protocol !== 'https') return undefined

  const standardForwardedProto = forwardedParameter(input.forwarded, 'proto')
  if (standardForwardedProto !== null && standardForwardedProto !== protocol) return undefined

  const requestOrigin = new URL(`${protocol}://${host}`).origin
  const canonicalOrigin = normalizeConfiguredCanonicalOrigin(input.canonicalOrigin)
  let platformOrigin: string | undefined
  if (typeof input.platformUrl === 'string') {
    try {
      const parsed = new URL(input.platformUrl)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
      platformOrigin = parsed.origin
    } catch {
      return undefined
    }
  }

  if (canonicalOrigin) {
    if (requestOrigin !== canonicalOrigin) return undefined
    if (platformOrigin && platformOrigin !== canonicalOrigin) return undefined
    return canonicalOrigin
  }

  if (input.isCloudflare) {
    return platformOrigin === requestOrigin ? platformOrigin : undefined
  }

  return input.allowHostFallback ? requestOrigin : undefined
}

function optionalRequestHeader(event: H3Event, name: string) {
  try {
    return getRequestHeader(event, name)
  } catch {
    return undefined
  }
}

function optionalRequestProtocol(event: H3Event) {
  try {
    return getRequestProtocol(event, { xForwardedProto: false })
  } catch {
    return undefined
  }
}

function configuredCanonicalOrigin(event: H3Event) {
  try {
    return useRuntimeConfig(event).canonicalOrigin
  } catch {
    return ''
  }
}

function platformRequestUrl(event: H3Event) {
  // Nitro's Cloudflare module serves the Worker Request through localFetch,
  // which retains the authoritative Request on the platform context rather
  // than H3's optional web adapter. Keep the web Request as a fallback for
  // other H3 runtimes without deriving authority from user-controlled headers.
  const cloudflare = (event as any).context?.cloudflare
  const cloudflareRequestUrl = cloudflare?.request?.url ?? cloudflare?.event?.request?.url
  return typeof cloudflareRequestUrl === 'string'
    ? cloudflareRequestUrl
    : (event as any).web?.request?.url
}

export function getTrustedRequestOrigin(event: H3Event) {
  try {
    return resolveTrustedRequestOrigin({
      host: optionalRequestHeader(event, 'host'),
      forwardedHost: optionalRequestHeader(event, 'x-forwarded-host'),
      forwarded: optionalRequestHeader(event, 'forwarded'),
      forwardedProto: optionalRequestHeader(event, 'x-forwarded-proto'),
      directProtocol: optionalRequestProtocol(event),
      platformUrl: platformRequestUrl(event),
      canonicalOrigin: configuredCanonicalOrigin(event),
      isCloudflare: Boolean((event as any).context?.cloudflare),
      allowHostFallback: import.meta.dev
    })
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('canonicalOrigin')) {
      throw createError({ statusCode: 500, statusMessage: 'Invalid canonical origin configuration' })
    }
    throw error
  }
}

export function requireTrustedRequestOrigin(event: H3Event) {
  const origin = getTrustedRequestOrigin(event)
  if (!origin) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid public request origin' })
  }
  return origin
}
