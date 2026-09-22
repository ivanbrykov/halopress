import type { H3Event } from 'h3'
import { getSettingValue, isSettingsTableReady } from './settings'
import { hasStrongInstallToken, resolveAuthSigningSecret } from './install-token'

export type OAuthProviderId = 'google'

type SettingsSource = {
  useEnv: boolean
  useDb: boolean
}

type OAuthProviderConfig = {
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  autoProvision?: boolean
}

const DEFAULT_SCOPE = 'global'

function parseBoolean(value?: string | boolean | null) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function parseProvidersList(value?: string) {
  if (!value) return null
  return value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
}

function resolveSettingsSource(event?: H3Event): SettingsSource {
  const config = useRuntimeConfig(event)
  const raw = (config.oauthSettingsSource || 'env+db').toLowerCase()
  if (raw === 'env') return { useEnv: true, useDb: false }
  if (raw === 'db') return { useEnv: false, useDb: true }
  if (raw === 'db+env' || raw === 'env+db') return { useEnv: true, useDb: true }
  return { useEnv: true, useDb: true }
}

export function resolveEncryptionKey(providerId: OAuthProviderId, event?: H3Event) {
  const config = useRuntimeConfig(event)
  const providerKey = String(providerId === 'google' ? config.oauthGoogleEncryptionKey : '').trim()
  const sharedKey = String(config.secretKey || '').trim()
  const authSigningSecret = resolveAuthSigningSecret(event)
  return selectOAuthEncryptionKey(providerId, providerKey, sharedKey, authSigningSecret)
}

export function selectOAuthEncryptionKey(
  providerId: OAuthProviderId,
  providerKey: string,
  sharedKey: string,
  authSigningSecret: string
) {
  if (hasStrongInstallToken(providerKey)) return providerKey
  if (hasStrongInstallToken(sharedKey)) return sharedKey
  if (!hasStrongInstallToken(authSigningSecret)) return ''
  return `halopress:oauth:${providerId}:v1:${authSigningSecret}`
}

function buildEnvConfig(providerId: OAuthProviderId, event?: H3Event): OAuthProviderConfig {
  const config = useRuntimeConfig(event)
  const providersList = parseProvidersList(config.oauthProviders)
  const enabledOverride = providerId === 'google'
    ? parseBoolean(config.oauthGoogleEnabled)
    : undefined
  const clientId = providerId === 'google' ? config.oauthGoogleClientId : undefined
  const clientSecret = providerId === 'google' ? config.oauthGoogleClientSecret : undefined

  let enabled: boolean | undefined = enabledOverride
  if (enabled === undefined && providersList) {
    enabled = providersList.includes(providerId.toLowerCase())
  }
  if (enabled === undefined && clientId && clientSecret) {
    enabled = true
  }

  return {
    enabled,
    clientId,
    clientSecret
  }
}

async function buildDbConfig(
  providerId: OAuthProviderId,
  event?: H3Event,
  options?: { enabled?: boolean | null; skipSecrets?: boolean }
): Promise<OAuthProviderConfig> {
  const baseKey = `auth.oauth.${providerId}`
  const decryptKey = resolveEncryptionKey(providerId, event) || undefined
  const enabled = options?.enabled
    ?? await getSettingValue<boolean>(DEFAULT_SCOPE, `${baseKey}.enabled`, undefined, event)
  if (enabled === false) {
    return { enabled: false }
  }

  const clientId = await getSettingValue<string>(DEFAULT_SCOPE, `${baseKey}.clientId`, undefined, event)
  const clientSecret = options?.skipSecrets
    ? null
    : await safeGetSettingValue<string>(
      DEFAULT_SCOPE,
      `${baseKey}.clientSecret`,
      decryptKey ? { decryptKey } : undefined,
      event
    )
  const autoProvision = await getSettingValue<boolean>(DEFAULT_SCOPE, `${baseKey}.autoProvision`, undefined, event)
  return {
    enabled: enabled ?? undefined,
    clientId: clientId ?? undefined,
    clientSecret: clientSecret ?? undefined,
    autoProvision: autoProvision ?? undefined
  }
}

function mergeDefined(base: OAuthProviderConfig, override: OAuthProviderConfig) {
  const merged: OAuthProviderConfig = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      merged[key as keyof OAuthProviderConfig] = value as any
    }
  }
  return merged
}

export async function resolveOAuthProviderConfig(providerId: OAuthProviderId, event?: H3Event) {
  const source = resolveSettingsSource(event)
  if (source.useDb && !(await isSettingsTableReady(event))) {
    source.useDb = false
  }
  const envConfig = source.useEnv ? buildEnvConfig(providerId, event) : {}
  if (!source.useDb) return envConfig as OAuthProviderConfig

  const enabled = await getSettingValue<boolean>(DEFAULT_SCOPE, `auth.oauth.${providerId}.enabled`, undefined, event)
  if (enabled === false) return { enabled: false }

  const skipSecrets = Boolean(source.useEnv && envConfig.clientId && envConfig.clientSecret)
  const dbConfig = await buildDbConfig(providerId, event, { enabled, skipSecrets })
  return source.useEnv
    ? mergeDefined(dbConfig as OAuthProviderConfig, envConfig as OAuthProviderConfig)
    : dbConfig
}

export async function resolveCredentialsEnabled(event?: H3Event) {
  const source = resolveSettingsSource(event)
  if (source.useDb && !(await isSettingsTableReady(event))) {
    source.useDb = false
  }
  const config = useRuntimeConfig(event)
  const providersList = source.useEnv ? parseProvidersList(config.oauthProviders) : null
  const envEnabledOverride = source.useEnv ? parseBoolean(config.oauthCredentialsEnabled) : undefined
  let enabled: boolean | undefined = envEnabledOverride

  if (enabled === undefined && providersList) {
    enabled = providersList.includes('credentials')
  }

  if (source.useDb && enabled === undefined) {
    const dbEnabled = await getSettingValue<boolean>(DEFAULT_SCOPE, 'auth.oauth.credentials.enabled', undefined, event)
    if (dbEnabled !== null) {
      enabled = dbEnabled
    }
  }

  return enabled ?? true
}

async function safeGetSettingValue<T = string>(
  scope: string,
  key: string,
  options: { decryptKey?: string } | undefined,
  event?: H3Event
): Promise<T | null> {
  try {
    return await getSettingValue<T>(scope, key, options, event)
  } catch (error) {
    console.warn('[oauth] Failed to resolve setting', key, error)
    return null
  }
}
