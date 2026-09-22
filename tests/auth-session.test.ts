import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { encode, getToken } from 'next-auth/jwt'

import { decodeAuthToken, encodeAuthToken } from '../server/utils/auth-jwt'
import { authSessionFromToken, hasSecureAuthSessionCookie } from '../server/utils/auth-session'
import { isAuthTenantAllowed } from '../server/utils/auth-user'

const secret = '1bccd7d3097bff829c970eb6a2c4a9232a3d65bfe74932a0c7317b1e9fef471e'

describe('protected API session verification', () => {
  it('rejects cross-tenant token refresh while permitting legacy claims to bind once', () => {
    expect(isAuthTenantAllowed('tenant-a.example', 'tenant-b.example')).toBe(false)
    expect(isAuthTenantAllowed('tenant-a.example', 'tenant-a.example')).toBe(true)
    expect(isAuthTenantAllowed(undefined, 'tenant-a.example')).toBe(true)
  })
  it('keeps session fetches in the browser instead of calling the same Worker during SSR', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [middlewareSource, configSource] = await Promise.all([
      readFile(resolve(root, 'app/middleware/desk-auth.global.ts'), 'utf8'),
      readFile(resolve(root, 'nuxt.config.ts'), 'utf8')
    ])
    const serverGuard = middlewareSource.indexOf('if (import.meta.server) return')
    const authClient = middlewareSource.indexOf('const { status, data, getSession } = useAuth()')

    expect(serverGuard).toBeGreaterThan(-1)
    expect(authClient).toBeGreaterThan(-1)
    expect(serverGuard).toBeLessThan(authClient)
    expect(configSource).toContain('disableServerSideAuth: true')
  })

  it('rebuilds the admin session claims used by requireAdmin', () => {
    expect(authSessionFromToken({
      id: 'user_1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      tenantKey: 'example.com',
      exp: 1_900_000_000
    })).toEqual({
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        accountType: undefined,
        tenantKey: 'example.com'
      },
      expires: new Date(1_900_000_000 * 1000).toISOString()
    })
  })

  it.each([
    ['publisher', 'staff'],
    ['user', 'member']
  ] as const)('preserves the custom %s role and %s account type', (role, accountType) => {
    expect(authSessionFromToken({
      id: `${accountType}_1`,
      role,
      accountType
    })).toMatchObject({
      user: {
        id: `${accountType}_1`,
        role,
        accountType
      }
    })
  })

  it('does not reconstruct identity claims from revoked or malformed token fields', () => {
    expect(authSessionFromToken(null)).toBeNull()

    const revoked = authSessionFromToken({ exp: 1_900_000_000 })
    expect(revoked).toEqual({
      user: {
        id: undefined,
        email: undefined,
        name: undefined,
        role: undefined,
        accountType: undefined,
        tenantKey: undefined
      },
      expires: new Date(1_900_000_000 * 1000).toISOString()
    })

    const malformed = authSessionFromToken({
      id: 123,
      role: false,
      accountType: 'external',
      tenantKey: ['example.com'],
      exp: 'never'
    } as any)
    expect(malformed).toEqual({
      user: {
        id: undefined,
        email: undefined,
        name: undefined,
        role: undefined,
        accountType: undefined,
        tenantKey: undefined
      },
      expires: undefined
    })
  })

  it('uses NextAuth token verification with chunked development cookies', async () => {
    const encoded = await encode({
      secret,
      token: { id: 'user_1', role: 'admin', tenantKey: 'localhost' }
    })
    const splitAt = Math.ceil(encoded.length / 2)
    const decoded = await getToken({
      secret,
      secureCookie: false,
      req: {
        cookies: {
          'next-auth.session-token.0': encoded.slice(0, splitAt),
          'next-auth.session-token.1': encoded.slice(splitAt)
        },
        headers: {}
      } as any
    })

    expect(decoded).toMatchObject({ id: 'user_1', role: 'admin', tenantKey: 'localhost' })
  })

  it('uses NextAuth token verification with chunked secure cookies', async () => {
    const encoded = await encode({
      secret,
      token: { id: 'user_2', role: 'admin', tenantKey: 'example.com' }
    })
    const splitAt = Math.ceil(encoded.length / 2)
    const decoded = await getToken({
      secret,
      secureCookie: true,
      req: {
        cookies: {
          '__Secure-next-auth.session-token.0': encoded.slice(0, splitAt),
          '__Secure-next-auth.session-token.1': encoded.slice(splitAt)
        },
        headers: {}
      } as any
    })

    expect(decoded).toMatchObject({ id: 'user_2', role: 'admin', tenantKey: 'example.com' })
  })

  it('shares the Cloudflare-safe JWT codec between login and protected APIs', async () => {
    const encoded = await encodeAuthToken({
      secret,
      token: { id: 'user_3', role: 'admin', tenantKey: 'example.com' }
    })
    const decoded = await getToken({
      secret,
      secureCookie: true,
      decode: decodeAuthToken,
      req: {
        cookies: {
          '__Secure-next-auth.session-token': encoded
        },
        headers: {}
      } as any
    })

    expect(decoded).toMatchObject({ id: 'user_3', role: 'admin', tenantKey: 'example.com' })
  })

  it('detects secure session cookies without relying on the internal request URL', () => {
    expect(hasSecureAuthSessionCookie({
      '__Secure-next-auth.session-token': 'token'
    })).toBe(true)
    expect(hasSecureAuthSessionCookie({
      '__Secure-next-auth.session-token.0': 'first',
      '__Secure-next-auth.session-token.1': 'second'
    })).toBe(true)
    expect(hasSecureAuthSessionCookie({
      'next-auth.session-token': 'token'
    })).toBe(false)
  })
})
