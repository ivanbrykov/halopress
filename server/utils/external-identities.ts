import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getRequestURL, setCookie } from 'h3'
import { and, desc, eq, gt } from 'drizzle-orm'

import { getDb } from '../db/db'
import { externalIdentity, membershipInvitation, user } from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { decodeAuthToken, encodeAuthToken } from './auth-jwt'
import { getMembershipSettings, normalizeEmail } from './membership'
import { newId } from './ids'
import { resolveAuthSigningSecret } from './install-token'
import { verifyPassword } from './password'
import {
  consumeRegistrationRateLimit,
  claimMembershipInvitation,
  getRegistrationRequestIp,
  reauthenticationRateLimitKeys,
  registrationRateLimitKeys,
  releaseMembershipInvitation,
  requireSafeMemberRole,
  RegistrationError
} from './member-registration'
import { getTenantKey } from './tenant'

const LINK_COOKIE = 'halopress-oauth-link'
const LINK_TTL_SECONDS = 5 * 60

export class ExternalIdentityError extends Error {
  constructor(message: string, readonly code: string, readonly retryAfterSeconds?: number) {
    super(message)
  }
}

type GoogleIdentityInput = {
  subject: string
  email: string
  emailVerified: boolean
  linkUserId?: string | null
}

type AuthUser = {
  id: string
  email: string
  name: string
  role: string
  accountType: string
  status: string
}

function toAuthUser(row: {
  id: string
  email: string
  name: string | null
  roleKey: string
  accountType: string
  status: string
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name || row.email,
    role: row.roleKey,
    accountType: row.accountType,
    status: row.status
  }
}

async function resolveSafeMemberRole(db: any, roleKey: string) {
  try {
    return await requireSafeMemberRole(db, roleKey)
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw new ExternalIdentityError(error.message, 'unsafe_role')
    }
    throw error
  }
}

async function findActiveUser(db: any, userId: string) {
  return await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      roleKey: user.roleKey,
      accountType: user.accountType,
      status: user.status,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt
    })
    .from(user)
    .where(eq(user.id, userId))
    .get()
}

function isIdentityConstraintError(error: unknown) {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = current instanceof Error ? current.message : String(current)
    if (message.includes('UNIQUE constraint failed')
      || message.includes('idx_external_identity_user_provider')
      || message.includes('idx_user_email_unique')) return true
    current = typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : null
  }
  return false
}

export async function resolveGoogleIdentity(event: H3Event, input: GoogleIdentityInput) {
  const subject = input.subject.trim()
  const email = normalizeEmail(input.email)
  if (!subject) throw new ExternalIdentityError('Google did not provide a stable account subject', 'missing_subject')

  const db = await getDb(event)
  const now = new Date()
  const identity = await db
    .select({
      userId: externalIdentity.userId,
      emailVerified: externalIdentity.emailVerified
    })
    .from(externalIdentity)
    .where(and(eq(externalIdentity.provider, 'google'), eq(externalIdentity.subject, subject)))
    .get()

  if (identity) {
    if (input.linkUserId && identity.userId !== input.linkUserId) {
      throw new ExternalIdentityError('This Google account is already linked to another user', 'identity_conflict')
    }
    const existing = await findActiveUser(db, identity.userId)
    if (!existing || existing.status !== 'active') {
      throw new ExternalIdentityError('This account is not active', 'inactive_user')
    }
    if (!identity.emailVerified && (!email || !input.emailVerified)) {
      throw new ExternalIdentityError('Google must provide a verified email address', 'unverified_email')
    }
    await db.update(externalIdentity).set({
      ...(email ? { emailAtLink: email } : {}),
      emailVerified: identity.emailVerified || input.emailVerified,
      lastUsedAt: now
    }).where(and(eq(externalIdentity.provider, 'google'), eq(externalIdentity.subject, subject)))
    return toAuthUser(existing)
  }

  if (!email || !input.emailVerified) {
    throw new ExternalIdentityError('Google must provide a verified email address', 'unverified_email')
  }

  if (input.linkUserId) {
    const target = await findActiveUser(db, input.linkUserId)
    if (!target || target.status !== 'active') {
      throw new ExternalIdentityError('The account to link is not active', 'inactive_user')
    }
    if (target.email !== email) {
      throw new ExternalIdentityError('Google email must match the reauthenticated account', 'email_mismatch')
    }
    try {
      await db.insert(externalIdentity).values({
        provider: 'google',
        subject,
        userId: target.id,
        emailAtLink: email,
        emailVerified: true,
        createdAt: now,
        lastUsedAt: now
      })
    } catch (error) {
      if (!isIdentityConstraintError(error)) throw error
      const concurrent = await db.select({ userId: externalIdentity.userId }).from(externalIdentity).where(and(
        eq(externalIdentity.provider, 'google'),
        eq(externalIdentity.subject, subject)
      )).get()
      if (concurrent?.userId !== target.id) {
        throw new ExternalIdentityError('This Google account is already linked to another user', 'identity_conflict')
      }
    }
    return toAuthUser(target)
  }

  const emailOwner = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (emailOwner) {
    throw new ExternalIdentityError(
      'A password account already uses this email. Sign in and explicitly link Google after reauthentication.',
      'explicit_link_required'
    )
  }

  const rateLimitKeys = await registrationRateLimitKeys({
    tenantKey: getTenantKey(event),
    ip: getRegistrationRequestIp(event),
    email,
    now
  })
  try {
    await consumeRegistrationRateLimit(db, rateLimitKeys, now)
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw new ExternalIdentityError(error.message, 'rate_limited')
    }
    throw error
  }

  const policy = await getMembershipSettings(event)
  if (policy.mode === 'disabled') {
    throw new ExternalIdentityError('Public registration is disabled', 'registration_disabled')
  }

  let roleKey = await resolveSafeMemberRole(db, policy.defaultRole)
  let invitation: { id: string; roleKey: string } | null = null
  if (policy.mode === 'invite') {
    invitation = await db
      .select({ id: membershipInvitation.id, roleKey: membershipInvitation.roleKey })
      .from(membershipInvitation)
      .where(and(
        eq(membershipInvitation.email, email),
        eq(membershipInvitation.status, 'pending'),
        gt(membershipInvitation.expiresAt, now)
      ))
      .orderBy(desc(membershipInvitation.createdAt))
      .get() ?? null
    if (!invitation) throw new ExternalIdentityError('A valid invitation is required', 'invitation_required')
    roleKey = await resolveSafeMemberRole(db, invitation.roleKey)
  }
  const userId = newId()
  const status = policy.mode === 'approval' ? 'pending' : 'active'
  try {
    if (invitation) {
      try {
        await claimMembershipInvitation(db, invitation.id, email, now)
      } catch (error) {
        if (error instanceof RegistrationError) {
          throw new ExternalIdentityError(error.message, 'invitation_required')
        }
        throw error
      }
    }
    await withDbTransaction(event, db, async (tx, statements) => {
      await executeDbStatement(tx.insert(user).values({
        id: userId,
        email,
        emailVerifiedAt: now,
        name: null,
        accountType: 'member',
        roleKey,
        passwordHash: null,
        passwordSalt: null,
        status,
        createdAt: now
      }), statements)
      await executeDbStatement(tx.insert(externalIdentity).values({
        provider: 'google',
        subject,
        userId,
        emailAtLink: email,
        emailVerified: true,
        createdAt: now,
        lastUsedAt: now
      }), statements)
      if (invitation) {
        await executeDbStatement(tx.update(membershipInvitation).set({
          status: 'used',
          usedBy: userId,
          usedAt: now
        }).where(and(
          eq(membershipInvitation.id, invitation.id),
          eq(membershipInvitation.status, 'claimed')
        )), statements)
      }
    })
  } catch (error) {
    if (invitation) await releaseMembershipInvitation(db, invitation.id, email).catch(() => {})
    if (!isIdentityConstraintError(error)) throw error
    const concurrentIdentity = await db.select({ userId: externalIdentity.userId }).from(externalIdentity).where(and(
      eq(externalIdentity.provider, 'google'),
      eq(externalIdentity.subject, subject)
    )).get()
    if (concurrentIdentity) {
      const concurrentUser = await findActiveUser(db, concurrentIdentity.userId)
      if (concurrentUser) return toAuthUser(concurrentUser)
    }
    throw new ExternalIdentityError(
      'A password account already uses this email. Sign in and explicitly link Google after reauthentication.',
      'explicit_link_required'
    )
  }

  const created = { id: userId, email, name: null, roleKey, accountType: 'member', status }
  return toAuthUser(created)
}

export async function createGoogleLinkIntent(event: H3Event, userId: string, password: string) {
  const db = await getDb(event)
  const now = new Date()
  const keys = await reauthenticationRateLimitKeys({
    tenantKey: getTenantKey(event),
    userId,
    ip: getRegistrationRequestIp(event),
    now
  })
  try {
    await consumeRegistrationRateLimit(db, keys, now, 'Too many reauthentication attempts. Try again later.')
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw new ExternalIdentityError(error.message, 'rate_limited', error.retryAfterSeconds)
    }
    throw error
  }
  const row = await findActiveUser(db, userId)
  if (!row || row.status !== 'active' || !row.passwordHash || !row.passwordSalt) {
    throw new ExternalIdentityError('Password reauthentication is unavailable for this account', 'password_unavailable')
  }
  if (!(await verifyPassword(password, row.passwordHash, row.passwordSalt))) {
    throw new ExternalIdentityError('Password reauthentication failed', 'invalid_password')
  }

  const token = await encodeAuthToken({
    secret: resolveAuthSigningSecret(event),
    maxAge: LINK_TTL_SECONDS,
    token: { scope: 'oauth-link', userId: row.id }
  })
  setCookie(event, LINK_COOKIE, token, {
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: LINK_TTL_SECONDS
  })
}

export async function consumeGoogleLinkIntent(event: H3Event) {
  const encoded = getCookie(event, LINK_COOKIE)
  if (!encoded) return null
  deleteCookie(event, LINK_COOKIE, { path: '/api/auth' })
  try {
    const token = await decodeAuthToken({ token: encoded, secret: resolveAuthSigningSecret(event) })
    return token?.scope === 'oauth-link' && typeof token.userId === 'string' ? token.userId : null
  } catch {
    return null
  }
}
