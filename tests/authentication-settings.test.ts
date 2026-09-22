import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  applyGoogleAuthenticationSettingWrites,
  buildGoogleAuthenticationStatus,
  buildGoogleAuthenticationSettingWrites,
  canToggleGoogleAuthentication,
  googleAuthenticationUpdateSchema,
  maskGoogleClientId,
  planGoogleAuthenticationUpdate
} from '../server/utils/authentication-settings'
import { decryptString, encryptString } from '../server/utils/crypto'
import { selectOAuthEncryptionKey } from '../server/utils/oauth'

const clientId = '123456789012-example.apps.googleusercontent.com'
const clientSecret = 'GOCSPX-example-client-secret-value'
const strongAuthSecret = 'f3d869410cfb7c1f9b20301e17d33a565403ba79aa8f91fd1e9d84d1b874c2d7'

function current(overrides: Partial<Parameters<typeof planGoogleAuthenticationUpdate>[1]> = {}) {
  return {
    envManaged: false,
    envClientIdConfigured: false,
    envClientSecretConfigured: false,
    storedClientId: '',
    storedSecretConfigured: false,
    encryptionKeyAvailable: true,
    ...overrides
  }
}

describe('Google authentication settings', () => {
  it('requires a complete valid web client before enabling Google sign-in', () => {
    const input = googleAuthenticationUpdateSchema.parse({ enabled: true })
    expect(() => planGoogleAuthenticationUpdate(input, current())).toThrow('Configure both')

    expect(() => planGoogleAuthenticationUpdate({
      enabled: true,
      clientId: 'not-a-google-client',
      clientSecret
    }, current())).toThrow('valid Google OAuth web client ID')

    expect(planGoogleAuthenticationUpdate({
      enabled: true,
      clientId,
      clientSecret
    }, current())).toEqual({ enabled: true, clientId, clientSecret })
  })

  it('does not accept credential replacement for environment-managed OAuth', () => {
    expect(() => planGoogleAuthenticationUpdate({
      enabled: true,
      clientId,
      clientSecret
    }, current({
      envManaged: true,
      envClientIdConfigured: true,
      envClientSecretConfigured: true
    }))).toThrow('managed by the deployment environment')
  })

  it('reports disabled environment credentials as ready without exposing them', () => {
    const status = buildGoogleAuthenticationStatus({
      resolvedEnabled: false,
      resolvedClientId: clientId,
      resolvedClientSecret: clientSecret,
      storedClientId: '',
      storedSecretValue: '',
      invalidStoredSecret: false,
      envManaged: true,
      canEditCredentials: false,
      canToggle: true,
      passwordEnabled: true,
      encryptionKeyAvailable: true,
      callbackUrl: 'https://example.com/api/auth/callback/google',
      environment: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        enabledOverride: true
      }
    })

    expect(status).toMatchObject({ enabled: false, configured: true, secretConfigured: true })
    expect(JSON.stringify(status)).not.toContain(clientSecret)
  })

  it('makes Google read-only when the environment disables password recovery', () => {
    expect(canToggleGoogleAuthentication(true, true, false)).toBe(false)
    expect(canToggleGoogleAuthentication(true, undefined, false)).toBe(false)
    expect(canToggleGoogleAuthentication(true, true, true)).toBe(true)
  })

  it('requires a strong runtime key to store or activate a database secret', () => {
    expect(() => planGoogleAuthenticationUpdate({
      enabled: true,
      clientId: '',
      clientSecret: ''
    }, current({
      storedClientId: clientId,
      storedSecretConfigured: true,
      encryptionKeyAvailable: false
    }))).toThrow('strong runtime authentication or encryption secret')

    expect(selectOAuthEncryptionKey('google', '', '', 'dev-secret-change-me')).toBe('')
    expect(selectOAuthEncryptionKey('google', '', '', strongAuthSecret)).toBe(
      `halopress:oauth:google:v1:${strongAuthSecret}`
    )
  })

  it('encrypts client secrets and never exposes raw credentials in status', async () => {
    const encryptionKey = selectOAuthEncryptionKey('google', '', '', strongAuthSecret)
    const encrypted = await encryptString(clientSecret, encryptionKey)
    expect(encrypted).not.toContain(clientSecret)
    expect(await decryptString(encrypted, encryptionKey)).toBe(clientSecret)

    const status = buildGoogleAuthenticationStatus({
      resolvedEnabled: true,
      resolvedClientId: clientId,
      resolvedClientSecret: clientSecret,
      storedClientId: '',
      storedSecretValue: encrypted,
      invalidStoredSecret: false,
      envManaged: false,
      canEditCredentials: true,
      canToggle: true,
      passwordEnabled: true,
      encryptionKeyAvailable: true,
      callbackUrl: 'https://example.com/api/auth/callback/google',
      environment: {
        clientIdConfigured: false,
        clientSecretConfigured: false,
        enabledOverride: null
      }
    })

    const serialized = JSON.stringify(status)
    expect(status.clientIdMasked).toBe(maskGoogleClientId(clientId))
    expect(serialized).not.toContain(clientId)
    expect(serialized).not.toContain(clientSecret)
    expect(status).toMatchObject({ enabled: true, secretConfigured: true, passwordEnabled: true })
  })

  it('treats an undecryptable stored secret as invalid and requires replacement', async () => {
    const originalKey = selectOAuthEncryptionKey('google', '', '', strongAuthSecret)
    const rotatedKey = selectOAuthEncryptionKey('google', '', '', `${strongAuthSecret}rotated`)
    const encrypted = await encryptString(clientSecret, originalKey)
    await expect(decryptString(encrypted, rotatedKey)).rejects.toThrow()

    const status = buildGoogleAuthenticationStatus({
      resolvedEnabled: false,
      resolvedClientId: clientId,
      resolvedClientSecret: '',
      storedClientId: clientId,
      storedSecretValue: '',
      invalidStoredSecret: true,
      envManaged: false,
      canEditCredentials: true,
      canToggle: true,
      passwordEnabled: true,
      encryptionKeyAvailable: true,
      callbackUrl: 'https://example.com/api/auth/callback/google',
      environment: {
        clientIdConfigured: false,
        clientSecretConfigured: false,
        enabledOverride: null
      }
    })
    expect(status).toMatchObject({ configured: false, secretConfigured: false, invalidStoredSecret: true })
    expect(() => planGoogleAuthenticationUpdate({
      enabled: true,
      clientId: '',
      clientSecret: ''
    }, current({ storedClientId: clientId, storedSecretConfigured: false }))).toThrow('Configure both')
  })

  it('disables Google before replacing credentials and leaves it disabled on write failure', async () => {
    const writes = buildGoogleAuthenticationSettingWrites({
      enabled: true,
      clientId,
      clientSecret
    }, strongAuthSecret, {
      scope: 'global',
      groupKey: 'auth.oauth',
      updatedBy: 'user_1',
      note: 'test'
    })
    expect(writes.map(write => [write.key, write.value])).toEqual([
      ['auth.oauth.credentials.enabled', 'true'],
      ['auth.oauth.google.enabled', 'false'],
      ['auth.oauth.google.clientId', clientId],
      ['auth.oauth.google.clientSecret', clientSecret],
      ['auth.oauth.google.enabled', 'true']
    ])

    const completed: Array<[string, string]> = []
    await expect(applyGoogleAuthenticationSettingWrites(writes, async (write) => {
      completed.push([write.key, write.value])
      if (write.key === 'auth.oauth.google.clientId') throw new Error('injected write failure')
    })).rejects.toThrow('injected write failure')
    expect(completed).toEqual([
      ['auth.oauth.credentials.enabled', 'true'],
      ['auth.oauth.google.enabled', 'false'],
      ['auth.oauth.google.clientId', clientId]
    ])
  })

  it('keeps both settings endpoints behind the current admin guard', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [getRoute, putRoute] = await Promise.all([
      readFile(resolve(root, 'server/api/settings/authentication.get.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/settings/authentication.put.ts'), 'utf8')
    ])

    expect(getRoute.indexOf('await requireAdmin(event)')).toBeGreaterThan(-1)
    expect(getRoute.indexOf('await requireAdmin(event)')).toBeLessThan(getRoute.indexOf('getGoogleAuthenticationSettings(event)'))
    expect(putRoute.indexOf('await requireAdmin(event)')).toBeGreaterThan(-1)
    expect(putRoute.indexOf('await requireAdmin(event)')).toBeLessThan(putRoute.indexOf('readBody(event)'))
  })
})
