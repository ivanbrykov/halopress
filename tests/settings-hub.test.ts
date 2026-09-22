import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeDeskColorModePreference } from '../shared/desk-preferences'
import {
  SETTINGS_SECTIONS,
  buildSettingsNavigation,
  findSettingsSection,
  isSettingsRouteActive
} from '../shared/settings-sections'

const root = resolve(import.meta.dirname, '..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

describe('Settings navigation and ownership', () => {
  it('registers only actionable Desk-owned destinations and marks deep routes', () => {
    expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['preferences', 'access', 'operations'])
    expect(SETTINGS_SECTIONS.map(section => section.to)).toEqual([
      '/_desk/settings/preferences',
      '/_desk/settings/access',
      '/_desk/settings/operations'
    ])
    expect(new Set(SETTINGS_SECTIONS.map(section => section.to)).size).toBe(SETTINGS_SECTIONS.length)
    expect(SETTINGS_SECTIONS.map(section => section.label).join(' ')).not.toMatch(
      /Overview|Site|Appearance|Navigation|Footer|Publishing|Integrations/
    )

    const access = findSettingsSection('access')
    expect(isSettingsRouteActive('/_desk/settings/access/security', access)).toBe(true)
    expect(isSettingsRouteActive('/_desk/settings/accessibility', access)).toBe(false)
    expect(buildSettingsNavigation('/_desk/settings/access')).toMatchObject({
      label: 'Settings',
      to: '/_desk/settings/preferences',
      value: 'settings',
      active: true,
      children: [
        { label: 'Desk preferences', active: false },
        { label: 'Authentication & membership', active: true },
        { label: 'Operations', active: false }
      ]
    })
  })

  it('uses the main responsive Desk sidebar as the only Settings navigation surface', async () => {
    const [desk, shell, index, preferences, access, operations] = await Promise.all([
      source('app/layouts/desk.vue'),
      source('app/components/SettingsShell.vue'),
      source('app/pages/_desk/settings/index.vue'),
      source('app/pages/_desk/settings/preferences.vue'),
      source('app/pages/_desk/settings/access.vue'),
      source('app/pages/_desk/settings/operations.vue')
    ])

    expect(desk).toContain('buildSettingsNavigation(route.path)')
    expect(desk).toContain('setNavigationOpen(\'settings\', true)')
    expect(desk).toContain(':collapsed="collapsed"')
    expect(desk).toContain(':popover="collapsed"')
    expect(desk).toContain('orientation="vertical"')
    expect(shell).not.toContain('Settings sections')
    expect(shell).not.toContain('<UNavigationMenu')
    expect(index).toContain('navigateTo(\'/_desk/settings/preferences\'')
    expect(index).not.toContain('<UPageCard')
    expect(preferences).toContain('section="preferences"')
    expect(access).toContain('section="access"')
    expect(access).toContain('<SettingsAuthenticationPanel')
    expect(access).toContain('<SettingsMembershipPanel')
    expect(operations).toContain('section="operations"')
    expect(operations).toContain('<SettingsSearchIndexingPanel')
  })

  it('keeps authentication and membership APIs independent inside one workflow', async () => {
    const [authentication, membership, access] = await Promise.all([
      source('app/components/settings/AuthenticationPanel.vue'),
      source('app/components/settings/MembershipPanel.vue'),
      source('app/pages/_desk/settings/access.vue')
    ])

    expect(authentication).toContain('useFetch<AuthenticationSettings>(\'/api/settings/authentication\')')
    expect(authentication).not.toContain('await useFetch')
    expect(authentication).toContain('Authentication settings are unavailable')
    expect(authentication).toContain('Refresh authentication')
    expect(membership).toContain('useFetch<MembershipSettings>(\'/api/settings/membership\')')
    expect(membership).toContain('useFetch<{ items: Invitation[] }>(\'/api/settings/membership/invitations\')')
    expect(membership).not.toMatch(/const \[[\s\S]*?\] = await Promise\.all/)
    expect(membership).toContain('Membership settings are unavailable')
    expect(membership).toContain('Invitations are unavailable')
    expect(membership).toContain('Refresh membership')
    expect(access).toContain(':scroll-to-invitations="route.query.tab === \'invites\'"')
    expect(access).not.toContain('#invitations, #membership')
    expect(membership).toContain('watch([() => props.scrollToInvitations, data, pending]')
    expect(membership).toContain('document.getElementById(settings?.mode === \'invite\' ? \'invitations\' : \'membership\')')
  })

  it('preserves legacy route intent with explicit compatibility redirects', async () => {
    const routes = Object.fromEntries(await Promise.all([
      'site', 'appearance', 'navigation', 'footer', 'authentication', 'membership'
    ].map(async id => [id, await source(`app/pages/_desk/settings/${id}.vue`)])))

    expect(routes.site).toContain('\'/_desk/site/general\'')
    expect(routes.appearance).toContain('await useFetch<SiteModeAdminResponse>(\'/api/settings/site-mode\'')
    expect(routes.appearance).toContain('? \'/_desk/site/themes\'')
    expect(routes.appearance).toContain(': \'/_desk/site/general#built-in-appearance\'')
    expect(routes.appearance).toContain('redirectCode: 302')
    expect(routes.navigation).toContain('\'/_desk/site/menus\'')
    expect(routes.footer).toContain('\'/_desk/site/general#built-in-footer\'')
    expect(routes.authentication).toContain('\'/_desk/settings/access#authentication\'')
    expect(routes.membership).toContain('path: \'/_desk/settings/access\'')
    expect(routes.membership).toContain('query: route.query')
    expect(routes.membership).toContain('hash: \'#membership\'')
    for (const redirect of Object.values(routes).filter(redirect => redirect !== routes.appearance)) {
      expect(redirect).toContain('redirectCode: 301')
    }
  })

  it('stores a validated Desk-only browser preference without Site presentation', async () => {
    expect(normalizeDeskColorModePreference('dark')).toBe('dark')
    expect(normalizeDeskColorModePreference('invalid')).toBe('system')

    const [composable, desk, preferences] = await Promise.all([
      source('app/composables/useDeskColorMode.ts'),
      source('app/layouts/desk.vue'),
      source('app/pages/_desk/settings/preferences.vue')
    ])
    expect(composable).toContain('useCookie<DeskColorModePreference>(DESK_COLOR_MODE_COOKIE')
    expect(composable).toContain('const colorMode = useColorMode()')
    expect(composable).toContain('colorMode.preference = value')
    expect(composable).toContain('key: \'halo-desk-color-mode-bridge\'')
    expect(composable).toContain('tagPosition: \'bodyOpen\'')
    expect(composable).toContain('class: explicitColorMode.value')
    expect(composable).toContain('window.matchMedia')
    expect(desk).toContain('useDeskColorMode()')
    expect(desk).not.toContain('useSitePresentation()')
    expect(desk).not.toContain('presentation.value.appearance.colorMode')
    expect(preferences).toContain('does not change Site Themes')
    expect(preferences).toContain('<ClientOnly>')
  })
})
