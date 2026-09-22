import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'

import type { OnboardingDeployment, OnboardingStatus } from '../../shared/types/onboarding'

const PLATFORM_HOST_SUFFIXES = ['.workers.dev', '.pages.dev']
const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1'])
const PRIVATE_HOST_SUFFIXES = [
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localdomain',
  '.test'
]

type OnboardingDeploymentEvidence = {
  cloudflareContext?: unknown
  development: boolean
}

type OnboardingStatusInput = {
  deployment: OnboardingDeployment
  schemasComplete: boolean
  firstSchemaKey: string | null
  contentComplete: boolean
  siteComplete: boolean
  domainComplete: boolean
  imageTransformationsComplete: boolean
  googleOAuthComplete: boolean
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1')
}

function isLoopbackHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  return !normalized
    || LOOPBACK_HOSTNAMES.has(normalized)
    || normalized.endsWith('.localhost')
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function getIPv4Parts(hostname: string) {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null

  const numbers = parts.map(Number)
  return numbers.every(part => part <= 255) ? numbers : null
}

function isPrivateOrReservedIPv4(parts: number[]) {
  const [first = 0, second = 0, third = 0] = parts
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
}

function isPublicHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  if (isLoopbackHostname(normalized)) return false

  const ipv4 = getIPv4Parts(normalized)
  if (ipv4) return !isPrivateOrReservedIPv4(ipv4)

  if (normalized.includes(':')) {
    return !/^f/i.test(normalized)
      && !/^::ffff:(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./i.test(normalized)
  }

  if (!normalized.includes('.') || PRIVATE_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))) {
    return false
  }

  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)
}

export function hasCustomDomain(hostname: string) {
  const normalized = normalizeHostname(hostname)
  if (!isPublicHostname(normalized)) return false
  return !PLATFORM_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

export function hasPublicOrigin(hostname: string) {
  return isPublicHostname(hostname)
}

export function resolveOnboardingDeployment(
  evidence: OnboardingDeploymentEvidence
): OnboardingDeployment {
  // Nitro's cloudflare-module preset supplies emulated Worker context to `nuxt dev`.
  // Development mode is still local onboarding; production Workers are identified
  // by their context after this build-mode boundary.
  if (evidence.development) {
    return {
      runtime: 'local',
      capabilities: {
        domainGuidance: 'none',
        imageTransformations: false
      }
    }
  }

  if (evidence.cloudflareContext) {
    return {
      runtime: 'cloudflare',
      capabilities: {
        domainGuidance: 'cloudflare-custom-domain',
        imageTransformations: true
      }
    }
  }

  return {
    runtime: 'node',
    capabilities: {
      domainGuidance: 'public-origin',
      imageTransformations: false
    }
  }
}

export function resolveOnboardingDeploymentFromEvent(
  event: H3Event,
  development = import.meta.dev
) {
  return resolveOnboardingDeployment({
    development,
    cloudflareContext: (event as any)?.context?.cloudflare
  })
}

export function hasCompletedDomainGuidance(
  deployment: OnboardingDeployment,
  hostname: string
) {
  if (deployment.capabilities.domainGuidance === 'cloudflare-custom-domain') {
    return hasCustomDomain(hostname)
  }
  if (deployment.capabilities.domainGuidance === 'public-origin') {
    return hasPublicOrigin(hostname)
  }
  return false
}

export function buildOnboardingStatus(input: OnboardingStatusInput): OnboardingStatus {
  return {
    deployment: input.deployment,
    schemas: {
      complete: input.schemasComplete,
      firstSchemaKey: input.firstSchemaKey
    },
    content: {
      complete: input.contentComplete
    },
    site: {
      complete: input.siteComplete
    },
    domain: {
      complete: input.domainComplete
    },
    imageTransformations: {
      complete: input.imageTransformationsComplete
    },
    googleOAuth: {
      complete: input.googleOAuthComplete
    }
  }
}

export async function getImageTransformationsStatus(
  deployment: OnboardingDeployment,
  event: H3Event,
  fetcher: typeof fetch = globalThis.fetch
) {
  if (!deployment.capabilities.imageTransformations) return false
  return await hasImageTransformations(event, fetcher)
}

export async function hasImageTransformations(
  event: H3Event,
  fetcher: typeof fetch = globalThis.fetch
) {
  if (!(event as any).context?.cloudflare) return false

  const probeUrl = new URL(
    '/cdn-cgi/image/w=32,h=32,fit=cover,f=webp/branding/halopress-mark-256.png',
    getRequestURL(event).origin
  )
  try {
    const response = await fetcher(probeUrl, {
      headers: { accept: 'image/webp,image/*' },
      signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }

    const contentType = response.headers.get('content-type') || ''
    const cfResized = response.headers.get('cf-resized') || ''
    if (!contentType.startsWith('image/webp') || !cfResized || /\berr=/.test(cfResized)) {
      await response.body?.cancel()
      return false
    }

    const bytes = await response.arrayBuffer()
    return bytes.byteLength > 0
  } catch {
    return false
  }
}
