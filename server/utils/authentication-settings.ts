import { z } from 'zod'

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

export class AuthenticationSettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationSettingsValidationError'
  }
}

export const googleAuthenticationUpdateSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().trim().max(512).optional().default(''),
  clientSecret: z.string().trim().max(2048).optional().default('')
}).strict()

export type GoogleAuthenticationUpdate = z.output<typeof googleAuthenticationUpdateSchema>

export type GoogleAuthenticationCurrentState = {
  envManaged: boolean
  envClientIdConfigured: boolean
  envClientSecretConfigured: boolean
  storedClientId: string
  storedSecretConfigured: boolean
  encryptionKeyAvailable: boolean
}

export type GoogleAuthenticationUpdatePlan = {
  enabled: boolean
  clientId?: string
  clientSecret?: string
}

export type GoogleAuthenticationStatusInput = {
  resolvedEnabled: boolean
  resolvedClientId: string
  resolvedClientSecret: string
  storedClientId: string
  storedSecretValue: string
  invalidStoredSecret: boolean
  envManaged: boolean
  canEditCredentials: boolean
  canToggle: boolean
  passwordEnabled: boolean
  encryptionKeyAvailable: boolean
  callbackUrl: string
  environment: {
    clientIdConfigured: boolean
    clientSecretConfigured: boolean
    enabledOverride: boolean | null
  }
}

export type GoogleAuthenticationSettingWrite = {
  scope: string
  key: string
  value: string
  valueType?: 'string' | 'boolean'
  isEncrypted?: boolean
  groupKey: string
  updatedBy: string | null
  note: string
  encryptionKey?: string
}

export function isValidGoogleClientId(value: string) {
  return value.length >= GOOGLE_CLIENT_ID_SUFFIX.length + 6
    && value.endsWith(GOOGLE_CLIENT_ID_SUFFIX)
    && /^[A-Za-z0-9][A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value)
}

export function isValidGoogleClientSecret(value: string) {
  return value.length >= 16 && !/\s/.test(value)
}

export function canToggleGoogleAuthentication(
  databaseSettingsEnabled: boolean,
  environmentGoogleEnabled: boolean | undefined,
  environmentCredentialsEnabled: boolean | undefined
) {
  return databaseSettingsEnabled
    && environmentGoogleEnabled !== false
    && environmentCredentialsEnabled !== false
}

export function planGoogleAuthenticationUpdate(
  input: GoogleAuthenticationUpdate,
  current: GoogleAuthenticationCurrentState
): GoogleAuthenticationUpdatePlan {
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()

  if (current.envManaged) {
    if (clientId || clientSecret) {
      throw new AuthenticationSettingsValidationError('Google OAuth credentials are managed by the deployment environment and cannot be replaced here')
    }
    if (input.enabled && (!current.envClientIdConfigured || !current.envClientSecretConfigured)) {
      throw new AuthenticationSettingsValidationError('Both environment-managed Google client ID and client secret are required before Google sign-in can be enabled')
    }
    return { enabled: input.enabled }
  }

  if (clientId && !isValidGoogleClientId(clientId)) {
    throw new AuthenticationSettingsValidationError('Enter a valid Google OAuth web client ID ending in .apps.googleusercontent.com')
  }
  if (clientSecret && !isValidGoogleClientSecret(clientSecret)) {
    throw new AuthenticationSettingsValidationError('Google client secret must be at least 16 characters and contain no whitespace')
  }

  const nextClientId = clientId || current.storedClientId
  const nextSecretConfigured = Boolean(clientSecret || current.storedSecretConfigured)

  if ((clientSecret || (input.enabled && nextSecretConfigured)) && !current.encryptionKeyAvailable) {
    throw new AuthenticationSettingsValidationError('A strong runtime authentication or encryption secret is required before a Google client secret can be stored')
  }
  if (input.enabled && (!nextClientId || !nextSecretConfigured)) {
    throw new AuthenticationSettingsValidationError('Configure both the Google client ID and client secret before enabling Google sign-in')
  }

  return {
    enabled: input.enabled,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined
  }
}

export function maskGoogleClientId(clientId: string) {
  if (!clientId) return null
  if (clientId.length <= 12) return `${clientId.slice(0, 4)}…${clientId.slice(-4)}`

  const suffixIndex = clientId.lastIndexOf(GOOGLE_CLIENT_ID_SUFFIX)
  const accountPart = suffixIndex > 0 ? clientId.slice(0, suffixIndex) : clientId
  const suffix = suffixIndex > 0 ? GOOGLE_CLIENT_ID_SUFFIX : ''
  const visibleStart = accountPart.slice(0, Math.min(8, accountPart.length))
  const visibleEnd = accountPart.length > 12 ? accountPart.slice(-4) : ''
  return `${visibleStart}…${visibleEnd}${suffix}`
}

export function buildGoogleAuthenticationStatus(input: GoogleAuthenticationStatusInput) {
  const clientId = input.resolvedClientId || input.storedClientId
  const secretConfigured = Boolean(input.resolvedClientSecret || input.storedSecretValue)

  return {
    provider: 'google' as const,
    enabled: Boolean(input.resolvedEnabled && input.resolvedClientId && input.resolvedClientSecret),
    configured: Boolean(clientId && secretConfigured),
    envManaged: input.envManaged,
    canEditCredentials: input.canEditCredentials,
    canToggle: input.canToggle,
    passwordEnabled: input.passwordEnabled,
    clientIdConfigured: Boolean(clientId),
    clientIdMasked: maskGoogleClientId(clientId),
    secretConfigured,
    invalidStoredSecret: input.invalidStoredSecret,
    encryptionKeyAvailable: input.encryptionKeyAvailable,
    callbackUrl: input.callbackUrl,
    environment: input.environment
  }
}

export function buildGoogleAuthenticationSettingWrites(
  plan: GoogleAuthenticationUpdatePlan,
  encryptionKey: string,
  common: Pick<GoogleAuthenticationSettingWrite, 'scope' | 'groupKey' | 'updatedBy' | 'note'>
) {
  const writes: GoogleAuthenticationSettingWrite[] = [{
    ...common,
    key: 'auth.oauth.credentials.enabled',
    value: 'true',
    valueType: 'boolean'
  }]
  const credentialsChanged = Boolean(plan.clientId || plan.clientSecret)

  // Disable the provider before touching either half of the credential pair.
  // If any later write fails, password sign-in stays available and Google stays off.
  if (credentialsChanged) {
    writes.push({
      ...common,
      key: 'auth.oauth.google.enabled',
      value: 'false',
      valueType: 'boolean'
    })
  }
  if (plan.clientId) {
    writes.push({
      ...common,
      key: 'auth.oauth.google.clientId',
      value: plan.clientId
    })
  }
  if (plan.clientSecret) {
    writes.push({
      ...common,
      key: 'auth.oauth.google.clientSecret',
      value: plan.clientSecret,
      isEncrypted: true,
      encryptionKey
    })
  }
  writes.push({
    ...common,
    key: 'auth.oauth.google.enabled',
    value: plan.enabled ? 'true' : 'false',
    valueType: 'boolean'
  })
  return writes
}

export async function applyGoogleAuthenticationSettingWrites(
  writes: GoogleAuthenticationSettingWrite[],
  write: (input: GoogleAuthenticationSettingWrite) => Promise<void>
) {
  for (const input of writes) {
    await write(input)
  }
}
