import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatDate } from '../app/composables/useDisplayLocale'

const root = resolve(import.meta.dirname, '..')

async function readProjectFile(path: string) {
  return await readFile(resolve(root, path), 'utf8')
}

describe('public membership UI contracts', () => {
  it('provides public login fields with browser-friendly autocomplete and an honest recovery limitation', async () => {
    const login = await readProjectFile('app/pages/login.vue')

    expect(login).toContain(`definePageMeta({ layout: 'default' })`)
    expect(login).toContain('<UFormField label="Email" name="email" required>')
    expect(login).toMatch(/<UInput[^>]*type="email"[^>]*autocomplete="email"/)
    expect(login).toContain('<UFormField label="Password" name="password" required>')
    expect(login).toMatch(/<UInput[^>]*type="password"[^>]*autocomplete="current-password"/)
    expect(login).toContain('No self-service password recovery yet')
    expect(login).not.toMatch(/to="[^"]*(forgot|reset-password)/)
  })

  it('provides public signup fields, invitation autocomplete, and recovery and verification limitations', async () => {
    const signup = await readProjectFile('app/pages/signup.vue')

    expect(signup).toContain(`definePageMeta({ layout: 'default' })`)
    expect(signup).toMatch(/<UInput[^>]*type="email"[^>]*autocomplete="email"/)
    expect(signup.match(/autocomplete="new-password"/g)).toHaveLength(2)
    expect(signup).toContain('name="confirmPassword"')
    expect(signup).toContain('autocomplete="one-time-code"')
    expect(signup).toContain(`v-if="membership?.passwordRegistrationEnabled"`)
    expect(signup).toContain('Password registration is not available')
    expect(signup).toContain('Recovery and verification email are not configured')
    expect(signup).toContain('password reset and verification email delivery are not yet available')
  })

  it('shows session and logout affordances while restricting Desk actions to staff admins', async () => {
    const layout = await readProjectFile('app/components/layout-renderer/BuiltInLayoutRenderer.vue')

    expect(layout).toContain('const { data: session, status, signOut } = useAuth()')
    expect(layout).toContain(`session.value?.user?.role === 'admin' && session.value.user.accountType === 'staff'`)
    expect(layout).toContain(`if (isAdmin.value) actions.unshift({ label: 'Open Desk'`)
    expect(layout).toContain(`{ label: 'Log out'`)
    expect(layout).toContain(`signOut({ callbackUrl: '/' })`)
    expect(layout).toContain('<UButton v-if="isAdmin" to="/_desk"')
    expect(layout).toContain('<UButton to="/account/security"')
  })

  it('redirects authenticated members away from Desk on client navigation', async () => {
    const middleware = await readProjectFile('app/middleware/desk-auth.global.ts')

    expect(middleware).toContain(`data.value.user.role === 'admin' && data.value.user.accountType === 'staff'`)
    expect(middleware).toMatch(/data\.value\.user\.role === 'admin'[\s\S]*?await navigateTo\('\/'\)/)
    expect(middleware).toContain(`session.user.role !== 'admin' || session.user.accountType !== 'staff'`)
    expect(middleware).toContain(`return await navigateTo('/')`)
  })

  it('requires explicit password reauthentication before linking Google by stable identity', async () => {
    const [security, middleware] = await Promise.all([
      readProjectFile('app/pages/account/security.vue'),
      readProjectFile('app/middleware/desk-auth.global.ts')
    ])

    expect(security).not.toContain('onMounted(')
    expect(middleware).toContain(`to.path === '/account' || to.path.startsWith('/account/')`)
    expect(middleware).toContain('if (isAccountRoute) return')
    expect(security).toContain('Matching email alone never links accounts.')
    expect(security).toContain('<UFormField label="Current password" name="password" required>')
    expect(security).toMatch(/<UInput[^>]*type="password"[^>]*autocomplete="current-password"/)
    expect(security).toContain('Reauthenticate and connect Google')
    expect(security).toContain(`'/api/account/link/google'`)
    expect(security).toContain(`signIn('google'`)
    expect(security).toContain(`provider's stable account identity`)
  })

  it('uses resilient provider icons and invitation controls', async () => {
    const [providers, membership, locale] = await Promise.all([
      readProjectFile('app/components/PublicAuthProviders.vue'),
      readProjectFile('app/components/settings/MembershipPanel.vue'),
      readProjectFile('app/composables/useDisplayLocale.ts')
    ])

    expect(providers).toContain(`providerId === 'google'`)
    expect(providers).toContain(`:icon="providerIcon(provider.id)"`)
    expect(providers).toContain(`'i-lucide-key-round'`)
    expect(membership).toContain(`useFetch<MembershipSettings>('/api/settings/membership')`)
    expect(membership).toContain(`useFetch<{ items: Invitation[] }>('/api/settings/membership/invitations')`)
    expect(membership).not.toMatch(/const \[[\s\S]*?\] = await Promise\.all/)
    expect(membership).toContain(`const locale = useDisplayLocale()`)
    expect(locale).toContain(`useState<string>('display-locale'`)
    expect(membership).toContain(`timeZone: 'UTC'`)
    expect(formatDate('2026-07-14T23:30:00-10:00', 'en-US', {
      month: 'short',
      timeZone: 'UTC'
    })).toBe('Jul 15, 2026')
    expect(membership).toContain(`typeof navigator.clipboard?.writeText !== 'function'`)
    expect(membership).toContain('Could not copy invitation code')
  })
})
