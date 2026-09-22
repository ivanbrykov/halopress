import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getTrustedRequestOrigin,
  normalizeConfiguredCanonicalOrigin,
  resolveTrustedRequestOrigin
} from '../server/utils/request-origin'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('trusted public request origin', () => {
  it('binds absolute output to the configured canonical origin', () => {
    expect(resolveTrustedRequestOrigin({
      host: 'PRESS.EXAMPLE.COM:443',
      forwardedProto: 'https',
      directProtocol: 'http',
      canonicalOrigin: 'https://press.example.com'
    })).toBe('https://press.example.com')
  })

  it('rejects a syntactically valid hostile Host instead of publishing it', () => {
    expect(resolveTrustedRequestOrigin({
      host: 'evil.example',
      forwardedProto: 'https',
      directProtocol: 'http',
      canonicalOrigin: 'https://press.example.com',
      allowHostFallback: true
    })).toBeUndefined()
  })

  it('rejects conflicting proxy and platform authorities', () => {
    expect(resolveTrustedRequestOrigin({
      host: 'press.example.com',
      forwardedHost: 'evil.example',
      forwardedProto: 'https',
      directProtocol: 'http',
      canonicalOrigin: 'https://press.example.com'
    })).toBeUndefined()
    expect(resolveTrustedRequestOrigin({
      host: 'press.example.com',
      forwardedProto: 'https',
      directProtocol: 'http',
      platformUrl: 'https://evil.example/api/delivery/page/a',
      canonicalOrigin: 'https://press.example.com'
    })).toBeUndefined()
  })

  it('trusts the matching Cloudflare Request authority without configuration', () => {
    expect(resolveTrustedRequestOrigin({
      host: 'press.example.com',
      forwardedProto: 'https',
      directProtocol: 'http',
      platformUrl: 'https://press.example.com/api/delivery/page/a',
      isCloudflare: true
    })).toBe('https://press.example.com')
  })

  it('reads the original Worker Request from Nitro Cloudflare context', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: '' }))
    const event = {
      context: {
        cloudflare: {
          request: {
            url: 'https://press.example.com/api/delivery/site-theme'
          }
        }
      },
      node: {
        req: {
          headers: {
            host: 'press.example.com',
            'x-forwarded-proto': 'https'
          }
        }
      }
    }

    expect(getTrustedRequestOrigin(event as never)).toBe('https://press.example.com')

    event.context.cloudflare = {
      event: {
        request: {
          url: 'https://press.example.com/api/delivery/site-theme'
        }
      }
    } as never
    expect(getTrustedRequestOrigin(event as never)).toBe('https://press.example.com')
  })

  it('fails closed on production Node and permits an explicit development fallback', () => {
    const input = {
      host: 'localhost:3000',
      directProtocol: 'http'
    }
    expect(resolveTrustedRequestOrigin(input)).toBeUndefined()
    expect(resolveTrustedRequestOrigin({ ...input, allowHostFallback: true })).toBe('http://localhost:3000')
  })

  it.each([
    'ftp://press.example.com',
    'https://user:pass@press.example.com',
    'https://press.example.com/path',
    'https://press.example.com?query=1',
    'https://press.example.com/#fragment'
  ])('rejects invalid canonical origin configuration: %s', (value) => {
    expect(() => normalizeConfiguredCanonicalOrigin(value)).toThrow('canonicalOrigin')
  })
})
