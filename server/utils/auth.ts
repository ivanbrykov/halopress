import type { H3Event } from 'h3'
import { parseCookies } from 'h3'
import { eq, or } from 'drizzle-orm'
import { getToken } from '#auth'

import { decodeAuthToken } from './auth-jwt'
import { authSessionFromToken, hasSecureAuthSessionCookie, type AuthSession } from './auth-session'
import { unauthorized } from './http'
import { resolveAuthSigningSecret } from './install-token'
import { getTenantKey } from './tenant'
import { getDb } from '../db/db'
import { user as userTable } from '../db/schema'
import { verifyPassword } from './password'
import { getActiveAuthUser } from './auth-user'

export async function getAuthSession(event: H3Event): Promise<AuthSession> {
  const secureCookie = hasSecureAuthSessionCookie(parseCookies(event))
  const token = await getToken({
    event,
    secureCookie,
    decode: decodeAuthToken,
    secret: resolveAuthSigningSecret(event)
  })
  const session = authSessionFromToken(token)
  const tokenUser = session?.user
  if (!tokenUser?.id) return null

  const tenantKey = getTenantKey(event)
  if (tokenUser.tenantKey && tokenUser.tenantKey !== tenantKey) return null

  const db = await getDb(event)
  const row = await getActiveAuthUser(db, tokenUser.id)
  if (!row) return null

  return {
    ...session,
    user: {
      id: row.id,
      email: row.email,
      name: row.name || row.email,
      role: row.role,
      accountType: row.accountType,
      tenantKey
    }
  }
}

export async function requireAdmin(event: H3Event): Promise<NonNullable<AuthSession>> {
  const session = await getAuthSession(event)
  const user = session?.user as {
    id?: string
    email?: string
    name?: string
    role?: string
    accountType?: 'staff' | 'member'
    tenantKey?: string
  } | undefined

  if (!user) throw unauthorized()
  if (user.role !== 'admin' || user.accountType !== 'staff') throw unauthorized()

  const tenantKey = getTenantKey(event)
  if (user.tenantKey && user.tenantKey !== tenantKey) {
    throw unauthorized('Tenant mismatch')
  }

  const userId = user.id
  if (!userId) throw unauthorized()

  const db = await getDb(event)
  const row = await db
    .select({ id: userTable.id, roleKey: userTable.roleKey, status: userTable.status })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .get()
  if (!row || row.roleKey !== 'admin' || row.status !== 'active') throw unauthorized()

  return session as NonNullable<AuthSession>
}

export async function requireStaff(event: H3Event): Promise<NonNullable<AuthSession>> {
  const session = await getAuthSession(event)
  if (!session?.user || session.user.accountType !== 'staff') throw unauthorized()
  return session
}

export async function getAdminUserByIdentifier(event: H3Event, identifier: string) {
  const db = await getDb(event)
  try {
    const rows = await db
      .select({
        id: userTable.id,
        email: userTable.email,
        name: userTable.name,
        roleKey: userTable.roleKey,
        status: userTable.status,
        passwordHash: userTable.passwordHash,
        passwordSalt: userTable.passwordSalt
      })
      .from(userTable)
      .where(or(eq(userTable.email, identifier), eq(userTable.name, identifier)))
      .limit(1)
    const user = rows?.[0]
    if (!user || user.roleKey !== 'admin' || user.status !== 'active') return null
    return user
  } catch (error) {
    if (isMissingUserTableError(error)) return null
    throw error
  }
}

export async function isAdminLoginAllowedDb(event: H3Event, identifier: string, password: string) {
  const user = await getAdminUserByIdentifier(event, identifier)
  if (!user?.passwordHash || !user?.passwordSalt) return false
  return await verifyPassword(password, user.passwordHash, user.passwordSalt)
}

function isMissingUserTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no such table: user')
    || message.includes('relation "user" does not exist')
}
