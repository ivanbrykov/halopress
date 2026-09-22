import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'

import {
  AuthenticationSettingsValidationError,
  applyGoogleAuthenticationSettingWrites,
  buildGoogleAuthenticationStatus,
  buildGoogleAuthenticationSettingWrites,
  canToggleGoogleAuthentication,
  googleAuthenticationUpdateSchema,
  planGoogleAuthenticationUpdate
} from './authentication-settings'
import { resolveCredentialsEnabled, resolveEncryptionKey, resolveOAuthProviderConfig } from './oauth'
import { getSetting, getSettingValue, resolveSettingValue, upsertSetting } from './settings'

const SETTINGS_SCOPE = 'global'
const SETTINGS_GROUP = 'auth.oauth'
const GOOGLE_CLIENT_ID_KEY = 'auth.oauth.google.clientId'
const GOOGLE_CLIENT_SECRET_KEY = 'auth.oauth.google.clientSecret'

type SettingsSource = { useEnv: boolean, useDb: boolean }

function settingsSource(event: H3Event): SettingsSource {
  const raw = String(useRuntimeConfig(event).oauthSettingsSource || 'env+db').toLowerCase()
  if (raw === 'env') return { useEnv: true, useDb: false }
  if (raw === 'db') return { useEnv: false, useDb: true }
  return { useEnv: true, useDb: true }
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function environmentGoogleEnabled(event: H3Event) {
  const config = useRuntimeConfig(event)
  const explicit = parseBoolean(config.oauthGoogleEnabled)
  if (explicit !== undefined) return explicit

  const providers = String(config.oauthProviders || '')
    .split(',')
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean)
  if (providers.length) return providers.includes('google')
  return undefined
}

function environmentCredentialsEnabled(event: H3Event) {
  const config = useRuntimeConfig(event)
  const explicit = parseBoolean(config.oauthCredentialsEnabled)
  if (explicit !== undefined) return explicit

  const providers = String(config.oauthProviders || '')
    .split(',')
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean)
  if (providers.length) return providers.includes('credentials')
  return undefined
}

export async function getGoogleAuthenticationSettings(event: H3Event) {
  const config = useRuntimeConfig(event)
  const source = settingsSource(event)
  const envClientId = source.useEnv ? String(config.oauthGoogleClientId || '').trim() : ''
  const envClientSecret = source.useEnv ? String(config.oauthGoogleClientSecret || '').trim() : ''
  const envManaged = Boolean(envClientId || envClientSecret)
  const encryptionKey = resolveEncryptionKey('google', event)
  const [resolved, passwordEnabled, storedClientId, storedSecret] = await Promise.all([
    resolveOAuthProviderConfig('google', event),
    resolveCredentialsEnabled(event),
    source.useDb
      ? getSettingValue<string>(SETTINGS_SCOPE, GOOGLE_CLIENT_ID_KEY, undefined, event)
      : Promise.resolve(null),
    source.useDb
      ? getSetting(SETTINGS_SCOPE, GOOGLE_CLIENT_SECRET_KEY, event)
      : Promise.resolve(null)
  ])
  const storedSecretValue = storedSecret
    ? await resolveSettingValue<string>(storedSecret, encryptionKey ? { decryptKey: encryptionKey } : undefined)
    : null

  const envEnabled = source.useEnv ? environmentGoogleEnabled(event) : undefined
  const envCredentialsEnabled = source.useEnv ? environmentCredentialsEnabled(event) : undefined
  const canToggle = canToggleGoogleAuthentication(source.useDb, envEnabled, envCredentialsEnabled)
  const callbackUrl = `${getRequestURL(event).origin}/api/auth/callback/google`

  return buildGoogleAuthenticationStatus({
    resolvedEnabled: Boolean(resolved.enabled),
    // A DB-level disable intentionally short-circuits the provider resolver.
    // Keep raw environment presence for status only so disabled credentials
    // still show as ready without returning either credential.
    resolvedClientId: String(resolved.clientId || envClientId).trim(),
    resolvedClientSecret: String(resolved.clientSecret || envClientSecret),
    storedClientId: String(storedClientId || ''),
    storedSecretValue: String(storedSecretValue || ''),
    invalidStoredSecret: Boolean(!envManaged && storedSecret && !storedSecretValue),
    envManaged,
    canEditCredentials: source.useDb && !envManaged,
    canToggle,
    passwordEnabled,
    encryptionKeyAvailable: Boolean(encryptionKey),
    callbackUrl,
    environment: {
      clientIdConfigured: Boolean(envClientId),
      clientSecretConfigured: Boolean(envClientSecret),
      enabledOverride: envEnabled ?? null
    }
  })
}

export async function updateGoogleAuthenticationSettings(
  event: H3Event,
  body: unknown,
  actorId: string | null
) {
  const parsed = googleAuthenticationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'Invalid authentication settings'
    throw new AuthenticationSettingsValidationError(message)
  }

  const config = useRuntimeConfig(event)
  const source = settingsSource(event)
  if (!source.useDb) {
    throw new AuthenticationSettingsValidationError('Authentication settings are read-only because this deployment is configured to use environment values only')
  }

  const envClientId = source.useEnv ? String(config.oauthGoogleClientId || '').trim() : ''
  const envClientSecret = source.useEnv ? String(config.oauthGoogleClientSecret || '').trim() : ''
  const envEnabled = source.useEnv ? environmentGoogleEnabled(event) : undefined
  const envCredentialsEnabled = source.useEnv ? environmentCredentialsEnabled(event) : undefined
  if (parsed.data.enabled && envEnabled === false) {
    throw new AuthenticationSettingsValidationError('Google sign-in is disabled by the deployment environment and cannot be enabled in Desk')
  }
  if (envCredentialsEnabled === false) {
    throw new AuthenticationSettingsValidationError('Password sign-in is disabled by the deployment environment; keep it enabled as an administrator recovery path')
  }

  const [storedClientId, storedSecret] = await Promise.all([
    getSettingValue<string>(SETTINGS_SCOPE, GOOGLE_CLIENT_ID_KEY, undefined, event),
    getSetting(SETTINGS_SCOPE, GOOGLE_CLIENT_SECRET_KEY, event)
  ])
  const encryptionKey = resolveEncryptionKey('google', event)
  const storedSecretValue = storedSecret
    ? await resolveSettingValue<string>(storedSecret, encryptionKey ? { decryptKey: encryptionKey } : undefined)
    : null
  const plan = planGoogleAuthenticationUpdate(parsed.data, {
    envManaged: Boolean(envClientId || envClientSecret),
    envClientIdConfigured: Boolean(envClientId),
    envClientSecretConfigured: Boolean(envClientSecret),
    storedClientId: String(storedClientId || ''),
    storedSecretConfigured: Boolean(storedSecretValue),
    encryptionKeyAvailable: Boolean(encryptionKey)
  })

  const common = {
    scope: SETTINGS_SCOPE,
    groupKey: SETTINGS_GROUP,
    updatedBy: actorId,
    note: 'Managed from Desk authentication settings'
  }

  const writes = buildGoogleAuthenticationSettingWrites(plan, encryptionKey, common)
  await applyGoogleAuthenticationSettingWrites(writes, async input => await upsertSetting(input, event))

  const status = await getGoogleAuthenticationSettings(event)
  if (plan.enabled && !status.passwordEnabled) {
    throw new AuthenticationSettingsValidationError('Password sign-in is disabled by the deployment environment; keep it enabled as an administrator recovery path')
  }
  return status
}
