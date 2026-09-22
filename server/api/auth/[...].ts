import { AsyncLocalStorage } from 'node:async_hooks'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import { NuxtAuthHandler } from '#auth'
import { createError, defineEventHandler, getRequestURL } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { user as userTable } from '../../db/schema'
import { decodeAuthToken, encodeAuthToken } from '../../utils/auth-jwt'
import { verifyPassword } from '../../utils/password'
import { resolveCredentialsEnabled, resolveOAuthProviderConfig } from '../../utils/oauth'
import { getInstallStatus } from '../../utils/install'
import { fingerprintSecret, isAuthRuntimeReady, resolveAuthSigningSecret } from '../../utils/install-token'
import { getTenantKey } from '../../utils/tenant'
import {
  consumeGoogleLinkIntent,
  ExternalIdentityError,
  resolveGoogleIdentity
} from '../../utils/external-identities'
import { getActiveAuthUser, isAuthTenantAllowed } from '../../utils/auth-user'

type CredentialInput = {
  identifier?: string
  email?: string
  password?: string
}

type AuthHandler = ReturnType<typeof NuxtAuthHandler>
type AuthProviderConfig = {
  authSecret: string
  authSecretFingerprint: string
  credentialsEnabled: boolean
  googleConfig: {
    enabled: boolean
    clientId?: string | null
    clientSecret?: string | null
  }
}

const authEventStorage = new AsyncLocalStorage<any>()

function getAuthEvent() {
  return authEventStorage.getStore()
}

let cachedAuthHandler: AuthHandler | null = null
let cachedAuthHandlerKey: string | null = null

async function loadAuthProviderConfig(event: Parameters<AuthHandler>[0]): Promise<AuthProviderConfig> {
  const credentialsEnabled = await resolveCredentialsEnabled(event)
  const googleConfig = await resolveOAuthProviderConfig('google', event)
  const authSecret = resolveAuthSigningSecret(event)
  return {
    authSecret,
    authSecretFingerprint: await fingerprintSecret(authSecret),
    credentialsEnabled,
    googleConfig: {
      enabled: Boolean(googleConfig.enabled),
      clientId: googleConfig.clientId ?? null,
      clientSecret: googleConfig.clientSecret ?? null
    }
  }
}

function buildAuthHandlerKey(config: AuthProviderConfig) {
  return JSON.stringify({
    authSecretFingerprint: config.authSecretFingerprint,
    credentialsEnabled: config.credentialsEnabled,
    googleConfig: {
      enabled: config.googleConfig.enabled,
      clientId: config.googleConfig.clientId,
      clientSecret: config.googleConfig.clientSecret
    }
  })
}

function resolveProviderFactory<T extends (...args: any[]) => any>(provider: T | { default?: T }): T {
  return ('default' in provider && provider.default ? provider.default : provider) as T
}

function clearAuthClaims(token: Record<string, any>) {
  delete token.id
  delete token.email
  delete token.name
  delete token.role
  delete token.accountType
  delete token.tenantKey
  return token
}

async function buildAuthHandler(config: AuthProviderConfig) {
  const { authSecret, credentialsEnabled, googleConfig } = config
  const oauthProviders: any[] = []

  if (googleConfig.enabled) {
    if (googleConfig.clientId && googleConfig.clientSecret) {
      const createGoogleProvider = resolveProviderFactory(GoogleProvider)
      oauthProviders.push(
        createGoogleProvider({
          clientId: googleConfig.clientId,
          clientSecret: googleConfig.clientSecret
        })
      )
    } else {
      console.warn('[auth] Google OAuth enabled but missing clientId/clientSecret; skipping provider')
    }
  }

  const providers: any[] = []

  if (credentialsEnabled) {
    const createCredentialsProvider = resolveProviderFactory(CredentialsProvider)
    providers.push(
      createCredentialsProvider({
        name: 'Credentials',
        credentials: {
          identifier: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' }
        },
        async authorize(credentials: Record<string, string> | undefined, req: { headers?: Record<string, string | string[] | undefined> }) {
          const authEvent = getAuthEvent()
          const input = credentials as CredentialInput | null
          const identifier = (input?.identifier || input?.email || '').trim().toLowerCase()
          const password = input?.password ?? ''

          if (!identifier || !password) return null

          const rawHost = req?.headers?.host
          const host = Array.isArray(rawHost) ? (rawHost[0] ?? 'local') : rawHost || 'local'
          const tenantKey = host.split(':')[0] || 'local'

          let row: {
            id: string
            email: string
            name: string | null
            roleKey: string
            accountType: string
            status: string
            passwordHash: string | null
            passwordSalt: string | null
          } | undefined

          try {
            const db = await getDb(authEvent)
            const user = await db
              .select({
                id: userTable.id,
                email: userTable.email,
                name: userTable.name,
                roleKey: userTable.roleKey,
                accountType: userTable.accountType,
                status: userTable.status,
                passwordHash: userTable.passwordHash,
                passwordSalt: userTable.passwordSalt
              })
              .from(userTable)
              .where(eq(userTable.email, identifier))
              .limit(1)

            row = user?.[0]
          } catch (error) {
            if (isMissingUserTableError(error)) return null
            throw error
          }

          if (!row || row.status !== 'active') return null
          if (!row.passwordHash || !row.passwordSalt) return null
          const ok = await verifyPassword(password, row.passwordHash, row.passwordSalt)
          if (!ok) return null

          return {
            id: row.id,
            email: row.email,
            name: row.name || row.email,
            role: row.roleKey,
            accountType: row.accountType === 'member' ? 'member' : 'staff',
            tenantKey
          }
        }
      })
    )
  }

  providers.push(...oauthProviders)

  return NuxtAuthHandler({
    secret: authSecret,
    session: {
      strategy: 'jwt'
    },
    jwt: {
      encode: encodeAuthToken,
      decode: decodeAuthToken
    },
    pages: {
      signIn: '/login'
    },
    providers,
    callbacks: {
      async signIn({ user, account, profile }) {
        const authEvent = getAuthEvent()
        if (account?.provider === 'credentials') return true
        if (account?.provider !== 'google' || !authEvent) return false
        try {
          const profileData = (profile || {}) as Record<string, unknown>
          const linked = await resolveGoogleIdentity(authEvent, {
            subject: String(account.providerAccountId || profileData.sub || ''),
            email: String(user?.email || profileData.email || ''),
            emailVerified: profileData.email_verified === true,
            linkUserId: await consumeGoogleLinkIntent(authEvent)
          })
          if (linked.status !== 'active') return '/signup?status=pending'
          user.id = linked.id
          user.email = linked.email
          user.name = linked.name
          ;(user as any).role = linked.role
          ;(user as any).accountType = linked.accountType
          ;(user as any).tenantKey = getTenantKey(authEvent)
        } catch (error) {
          if (isMissingUserTableError(error)) return false
          if (error instanceof ExternalIdentityError) {
            console.warn('[auth] Google sign-in rejected', error.code)
            return false
          }
          throw error
        }
        return true
      },
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id
          token.role = (user as any).role
          token.accountType = (user as any).accountType
          token.tenantKey = (user as any).tenantKey
          token.email = user.email
          token.name = user.name
        }
        const authEvent = getAuthEvent()
        const userId = typeof token.id === 'string' ? token.id : ''
        if (!authEvent || !userId) return token
        try {
          const db = await getDb(authEvent)
          const currentTenantKey = getTenantKey(authEvent)
          if (!isAuthTenantAllowed(token.tenantKey, currentTenantKey)) {
            return clearAuthClaims(token)
          }
          const current = await getActiveAuthUser(db, userId)
          if (!current) {
            return clearAuthClaims(token)
          }
          token.id = current.id
          token.email = current.email
          token.name = current.name || current.email
          token.role = current.role
          token.accountType = current.accountType
          token.tenantKey = currentTenantKey
        } catch (error) {
          if (!isMissingUserTableError(error)) throw error
        }
        return token
      },
      session({ session, token }) {
        if (typeof token.id !== 'string') return { ...session, user: undefined } as any
        return {
          ...session,
          user: {
            ...session.user,
            id: token.id as string | undefined,
            email: token.email as string | undefined,
            name: token.name as string | undefined,
            role: token.role as string | undefined,
            accountType: token.accountType as 'staff' | 'member' | undefined,
            tenantKey: token.tenantKey as string | undefined
          }
        }
      }
    }
  })
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  const isCloudflareRuntime = Boolean((event as any)?.context?.cloudflare)
  const authSigningSecret = resolveAuthSigningSecret(event)

  if (!isAuthRuntimeReady(isCloudflareRuntime, authSigningSecret)) {
    if (path.endsWith('/session')) return { user: null }
    if (path.endsWith('/providers')) return {}
    if (path.endsWith('/csrf')) return { csrfToken: '' }
    throw createError({
      statusCode: 503,
      statusMessage: 'Authentication is unavailable until a strong runtime secret is configured',
      data: { phase: 'configuration_required' }
    })
  }

  const installDb = await getDb(event)
  const installStatus = await getInstallStatus(installDb)
  if (!installStatus.ready) {
    if (path.endsWith('/session')) return { user: null }
    if (path.endsWith('/providers')) return {}
    if (path.endsWith('/csrf')) return { csrfToken: '' }
    throw createError({ statusCode: 503, statusMessage: 'Auth not ready' })
  }

  const config = await loadAuthProviderConfig(event)
  const configKey = buildAuthHandlerKey(config)
  if (!cachedAuthHandler || cachedAuthHandlerKey !== configKey) {
    cachedAuthHandler = await buildAuthHandler(config)
    cachedAuthHandlerKey = configKey
  }
  return authEventStorage.run(event, () => cachedAuthHandler!(event))
})

function isMissingUserTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no such table: user')
    || message.includes('relation "user" does not exist')
}
