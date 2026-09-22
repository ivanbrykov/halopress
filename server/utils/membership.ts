import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  DEFAULT_MEMBER_ROLE,
  DEFAULT_MEMBERSHIP_MODE,
  MEMBERSHIP_MODES,
  type MembershipMode,
  type MembershipPublicSettings
} from '../../shared/membership'
import { getDb } from '../db/db'
import { userRole } from '../db/schema'
import { resolveCredentialsEnabled } from './oauth'
import { getSettingValue, upsertSetting } from './settings'

const SETTINGS_SCOPE = 'global'
const SETTINGS_GROUP = 'auth.membership'
const POLICY_KEY = 'auth.membership.policy'

const protectedMemberRoles = new Set(['admin', 'anonymous'])

export const membershipSettingsUpdateSchema = z.object({
  mode: z.enum(MEMBERSHIP_MODES),
  defaultRole: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/)
})

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function isMembershipMode(value: unknown): value is MembershipMode {
  return typeof value === 'string' && (MEMBERSHIP_MODES as readonly string[]).includes(value)
}

export async function getMembershipSettings(event?: H3Event) {
  const storedPolicy = await getSettingValue<{ mode?: unknown; defaultRole?: unknown }>(
    SETTINGS_SCOPE,
    POLICY_KEY,
    undefined,
    event
  )

  return {
    mode: isMembershipMode(storedPolicy?.mode) ? storedPolicy.mode : DEFAULT_MEMBERSHIP_MODE,
    defaultRole: typeof storedPolicy?.defaultRole === 'string' && storedPolicy.defaultRole.trim()
      ? storedPolicy.defaultRole.trim()
      : DEFAULT_MEMBER_ROLE
  }
}

export function toPublicMembershipSettings(
  mode: MembershipMode,
  credentialsEnabled: boolean
): MembershipPublicSettings {
  const registrationEnabled = mode !== 'disabled'
  return {
    mode,
    registrationEnabled,
    passwordRegistrationEnabled: registrationEnabled && credentialsEnabled,
    inviteRequired: mode === 'invite',
    approvalRequired: mode === 'approval',
    passwordRecoveryAvailable: false,
    emailVerificationAvailable: false
  }
}

export async function getPublicMembershipSettings(event?: H3Event) {
  const [settings, credentialsEnabled] = await Promise.all([
    getMembershipSettings(event),
    resolveCredentialsEnabled(event)
  ])
  return toPublicMembershipSettings(settings.mode, credentialsEnabled)
}

export async function listEligibleMemberRoles(event?: H3Event) {
  const db = await getDb(event)
  const rows = await db
    .select({ roleKey: userRole.roleKey, title: userRole.title, level: userRole.level })
    .from(userRole)

  return rows
    .filter((role: { roleKey: string }) => !protectedMemberRoles.has(role.roleKey))
    .sort((a: { level: number; roleKey: string }, b: { level: number; roleKey: string }) =>
      b.level - a.level || a.roleKey.localeCompare(b.roleKey))
}

export async function updateMembershipSettings(event: H3Event, input: unknown, actorId: string | null) {
  const parsed = membershipSettingsUpdateSchema.parse(input)
  if (protectedMemberRoles.has(parsed.defaultRole)) {
    throw new Error('The default member role cannot grant administrator or anonymous access')
  }

  const db = await getDb(event)
  const role = await db
    .select({ roleKey: userRole.roleKey })
    .from(userRole)
    .where(eq(userRole.roleKey, parsed.defaultRole))
    .get()
  if (!role) throw new Error('The selected default member role does not exist')

  await upsertSetting({
    scope: SETTINGS_SCOPE,
    key: POLICY_KEY,
    value: JSON.stringify(parsed),
    valueType: 'json',
    groupKey: SETTINGS_GROUP,
    updatedBy: actorId,
    note: 'Public membership admission policy and safe default role'
  }, event)

  return parsed
}
