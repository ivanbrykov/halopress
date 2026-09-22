import { getHeader, type H3Event } from 'h3'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { getDb } from '../db/db'
import {
  membershipInvitation,
  registrationRateLimit,
  user,
  userRole
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { getMembershipSettings, normalizeEmail } from './membership'
import { newId } from './ids'
import { hashPassword } from './password'

const REGISTRATION_WINDOW_MS = 15 * 60 * 1000
const REGISTRATION_ATTEMPT_LIMIT = 5
const INVITATION_TTL_DAYS = 7

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
  }
}

export const registrationInputSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(100).optional().default(''),
  password: z.string().min(12).max(128),
  inviteCode: z.string().trim().max(256).optional().default('')
})

export const invitationInputSchema = z.object({
  email: z.string().trim().email().max(254),
  roleKey: z.string().trim().min(1).max(64).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(INVITATION_TTL_DAYS)
})

export function getRegistrationRequestIp(event: H3Event) {
  const directAddress = event.node?.req?.socket?.remoteAddress || 'unknown'
  if (!(event as any).context?.cloudflare) return String(directAddress).trim()
  return String(getHeader(event, 'cf-connecting-ip') || directAddress).trim()
}

async function getCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto
  return (await import('node:crypto')).webcrypto as unknown as Crypto
}

async function sha256Hex(value: string) {
  const crypto = await getCrypto()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function randomToken() {
  const crypto = await getCrypto()
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function registrationRateLimitKeys(input: {
  tenantKey: string
  ip: string
  email: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const window = Math.floor(now.getTime() / REGISTRATION_WINDOW_MS)
  const email = normalizeEmail(input.email)
  return await Promise.all([
    sha256Hex(`registration:ip:${input.tenantKey}:${input.ip || 'unknown'}:${window}`),
    sha256Hex(`registration:email:${input.tenantKey}:${email}:${window}`)
  ])
}

export async function reauthenticationRateLimitKeys(input: {
  tenantKey: string
  userId: string
  ip: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const window = Math.floor(now.getTime() / REGISTRATION_WINDOW_MS)
  return await Promise.all([
    sha256Hex(`reauthentication:user:${input.tenantKey}:${input.userId}:${window}`),
    sha256Hex(`reauthentication:user-ip:${input.tenantKey}:${input.userId}:${input.ip || 'unknown'}:${window}`)
  ])
}

export async function consumeRegistrationRateLimit(
  db: any,
  keys: string[],
  now = new Date(),
  limitMessage = 'Too many registration attempts. Try again later.'
) {
  const resetAt = new Date((Math.floor(now.getTime() / REGISTRATION_WINDOW_MS) + 1) * REGISTRATION_WINDOW_MS)
  await db.delete(registrationRateLimit).where(lt(registrationRateLimit.resetAt, now))

  for (const bucketKey of keys) {
    const rows = await db
      .insert(registrationRateLimit)
      .values({ bucketKey, attemptCount: 1, resetAt, updatedAt: now })
      .onConflictDoUpdate({
        target: registrationRateLimit.bucketKey,
        set: {
          attemptCount: sql`${registrationRateLimit.attemptCount} + 1`,
          updatedAt: now
        }
      })
      .returning({ attemptCount: registrationRateLimit.attemptCount })

    if (Number(rows?.[0]?.attemptCount ?? 1) > REGISTRATION_ATTEMPT_LIMIT) {
      throw new RegistrationError(
        limitMessage,
        429,
        Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))
      )
    }
  }
}

export async function requireSafeMemberRole(db: any, roleKey: string) {
  if (!roleKey || roleKey === 'admin' || roleKey === 'anonymous') {
    throw new RegistrationError('Membership is not configured with a safe default role', 503)
  }
  const role = await db
    .select({ roleKey: userRole.roleKey })
    .from(userRole)
    .where(eq(userRole.roleKey, roleKey))
    .get()
  if (!role) throw new RegistrationError('Membership is not configured with a valid default role', 503)
  return role.roleKey as string
}

export async function claimMembershipInvitation(db: any, invitationId: string, email: string, now: Date) {
  const claimed = await db
    .update(membershipInvitation)
    .set({ status: 'claimed', usedAt: now })
    .where(and(
      eq(membershipInvitation.id, invitationId),
      eq(membershipInvitation.email, email),
      eq(membershipInvitation.status, 'pending'),
      gt(membershipInvitation.expiresAt, now)
    ))
    .returning({ id: membershipInvitation.id })
  if (!claimed.length) throw new RegistrationError('A valid invitation is required', 403)
}

export async function releaseMembershipInvitation(db: any, invitationId: string, email: string) {
  await db
    .update(membershipInvitation)
    .set({
      status: sql`case when exists (
        select 1 from membership_invitation replacement
        where replacement.email = ${email}
          and replacement.status = 'pending'
          and replacement.id <> ${invitationId}
      ) then 'superseded' else 'pending' end`,
      usedAt: null
    })
    .where(and(
      eq(membershipInvitation.id, invitationId),
      eq(membershipInvitation.status, 'claimed')
    ))
}

function isUniqueEmailError(error: unknown) {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = current instanceof Error ? current.message : String(current)
    if (message.includes('UNIQUE constraint failed: user.email') || message.includes('idx_user_email_unique')) return true
    current = typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : null
  }
  return false
}

export async function registerPasswordMember(event: H3Event, rawInput: unknown) {
  const input = registrationInputSchema.parse(rawInput)
  const email = normalizeEmail(input.email)
  const policy = await getMembershipSettings(event)
  if (policy.mode === 'disabled') throw new RegistrationError('Public registration is disabled', 403)

  const db = await getDb(event)
  let roleKey = await requireSafeMemberRole(db, policy.defaultRole)
  let invitation: { id: string; roleKey: string } | null = null
  const now = new Date()

  if (policy.mode === 'invite') {
    if (!input.inviteCode) throw new RegistrationError('A valid invitation is required', 403)
    const tokenHash = await sha256Hex(input.inviteCode)
    invitation = await db
      .select({ id: membershipInvitation.id, roleKey: membershipInvitation.roleKey })
      .from(membershipInvitation)
      .where(and(
        eq(membershipInvitation.tokenHash, tokenHash),
        eq(membershipInvitation.email, email),
        eq(membershipInvitation.status, 'pending'),
        gt(membershipInvitation.expiresAt, now)
      ))
      .get() ?? null
    if (!invitation) throw new RegistrationError('A valid invitation is required', 403)
    roleKey = await requireSafeMemberRole(db, invitation.roleKey)
  }

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (existing) throw new RegistrationError('An account already exists for this email', 409)

  const { hash, salt } = await hashPassword(input.password)
  const userId = newId()
  const status = policy.mode === 'approval' ? 'pending' : 'active'

  try {
    if (invitation) await claimMembershipInvitation(db, invitation.id, email, now)
    await withDbTransaction(event, db, async (tx, statements) => {
      await executeDbStatement(tx.insert(user).values({
        id: userId,
        email,
        emailVerifiedAt: null,
        name: input.name || null,
        accountType: 'member',
        roleKey,
        passwordHash: hash,
        passwordSalt: salt,
        status,
        createdAt: now
      }), statements)

      if (invitation) {
        await executeDbStatement(tx
          .update(membershipInvitation)
          .set({ status: 'used', usedBy: userId, usedAt: now })
          .where(and(
            eq(membershipInvitation.id, invitation.id),
            eq(membershipInvitation.status, 'claimed')
          )), statements)
      }
    })
  } catch (error) {
    if (invitation) await releaseMembershipInvitation(db, invitation.id, email).catch(() => {})
    if (isUniqueEmailError(error)) throw new RegistrationError('An account already exists for this email', 409)
    throw error
  }

  return { id: userId, email, status, role: roleKey }
}

export async function createMembershipInvitation(event: H3Event, rawInput: unknown, actorId: string) {
  const input = invitationInputSchema.parse(rawInput)
  const policy = await getMembershipSettings(event)
  const db = await getDb(event)
  const email = normalizeEmail(input.email)
  const roleKey = await requireSafeMemberRole(db, input.roleKey || policy.defaultRole)
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (existing) throw new RegistrationError('An account already exists for this email', 409)

  const code = await randomToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
  const invitationId = newId()
  const tokenHash = await sha256Hex(code)
  await withDbTransaction(event, db, async (tx, statements) => {
    await executeDbStatement(tx.update(membershipInvitation).set({ status: 'superseded' }).where(and(
      eq(membershipInvitation.email, email),
      eq(membershipInvitation.status, 'pending')
    )), statements)
    await executeDbStatement(tx.insert(membershipInvitation).values({
      id: invitationId,
      tokenHash,
      email,
      roleKey,
      status: 'pending',
      expiresAt,
      createdBy: actorId,
      createdAt: now
    }), statements)
  })
  return { code, email, roleKey, expiresAt: expiresAt.toISOString() }
}

export async function listMembershipInvitations(event: H3Event) {
  const db = await getDb(event)
  const rows = await db
    .select({
      id: membershipInvitation.id,
      email: membershipInvitation.email,
      roleKey: membershipInvitation.roleKey,
      status: membershipInvitation.status,
      expiresAt: membershipInvitation.expiresAt,
      usedAt: membershipInvitation.usedAt,
      createdAt: membershipInvitation.createdAt
    })
    .from(membershipInvitation)

  const now = Date.now()
  return rows
    .map((row: any) => ({
      ...row,
      status: row.status === 'pending' && row.expiresAt.getTime() <= now ? 'expired' : row.status,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    }))
    .sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt))
}
