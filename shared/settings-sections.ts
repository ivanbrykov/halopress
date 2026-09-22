export type SettingsSectionId = 'preferences' | 'access' | 'operations'

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  description: string
  icon: string
  to: string
}

export type SettingsNavigation = {
  label: 'Settings'
  to: '/_desk/settings/preferences'
  value: 'settings'
  icon: string
  active: boolean
  defaultOpen: true
  children: Array<SettingsSection & { active: boolean }>
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'preferences',
    label: 'Desk preferences',
    description: 'Browser preferences for the HaloPress administrator workspace.',
    icon: 'i-lucide-monitor-cog',
    to: '/_desk/settings/preferences'
  },
  {
    id: 'access',
    label: 'Authentication & membership',
    description: 'Sign-in providers, account admission, roles, and invitations.',
    icon: 'i-lucide-shield-check',
    to: '/_desk/settings/access'
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Background indexing health and recovery controls.',
    icon: 'i-lucide-activity',
    to: '/_desk/settings/operations'
  }
] as const

export function findSettingsSection(id: SettingsSectionId) {
  return SETTINGS_SECTIONS.find(section => section.id === id)!
}

export function isSettingsRouteActive(path: string, section: SettingsSection) {
  return path === section.to || path.startsWith(`${section.to}/`)
}

export function buildSettingsNavigation(path: string): SettingsNavigation {
  return {
    label: 'Settings',
    to: '/_desk/settings/preferences',
    value: 'settings',
    icon: 'i-lucide-settings',
    active: path === '/_desk/settings' || path.startsWith('/_desk/settings/'),
    defaultOpen: true,
    children: SETTINGS_SECTIONS.map(section => ({
      ...section,
      active: isSettingsRouteActive(path, section)
    }))
  }
}
