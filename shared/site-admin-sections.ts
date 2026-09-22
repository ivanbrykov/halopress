export type SiteAdminSectionId = 'overview' | 'general' | 'themes' | 'layouts' | 'menus'

export type SiteAdminSection = {
  id: SiteAdminSectionId
  label: string
  description: string
  icon: string
  to: string
}

export type SiteAdminNavigation = {
  label: 'Site'
  to: '/_desk/site'
  value: 'site'
  icon: string
  active: boolean
  defaultOpen: true
  children: Array<SiteAdminSection & { active: boolean }>
}

/**
 * Desk-only navigation metadata for Site administration.
 *
 * `layouts` refers to persisted HaloPress Layout resources. It is not a
 * Nuxt application layout and must never resolve to a file in app/layouts/.
 */
export const SITE_ADMIN_SECTIONS: readonly SiteAdminSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Site feature status and presentation summary.',
    icon: 'i-lucide-layout-dashboard',
    to: '/_desk/site'
  },
  {
    id: 'general',
    label: 'General',
    description: 'Site availability, identity, defaults, and built-in fallback settings.',
    icon: 'i-lucide-settings-2',
    to: '/_desk/site/general'
  },
  {
    id: 'themes',
    label: 'Themes',
    description: 'Reusable visual tokens for independently rendered content.',
    icon: 'i-lucide-palette',
    to: '/_desk/site/themes'
  },
  {
    id: 'layouts',
    label: 'Layouts',
    description: 'HaloPress public page-layout resources and rendering contracts.',
    icon: 'i-lucide-panels-top-left',
    to: '/_desk/site/layouts'
  },
  {
    id: 'menus',
    label: 'Menus',
    description: 'Reusable static and dynamic navigation sets.',
    icon: 'i-lucide-menu',
    to: '/_desk/site/menus'
  }
] as const

export const SITE_ADMIN_CHILD_SECTIONS = SITE_ADMIN_SECTIONS.filter(section => section.id !== 'overview')

export function findSiteAdminSection(id: SiteAdminSectionId) {
  return SITE_ADMIN_SECTIONS.find(section => section.id === id)!
}

export function isSiteAdminRouteActive(path: string, section: SiteAdminSection) {
  if (section.id === 'overview') return path === section.to
  return path === section.to || path.startsWith(`${section.to}/`)
}

export function buildSiteAdminNavigation(path: string, enabled: boolean): SiteAdminNavigation {
  return {
    label: 'Site',
    to: '/_desk/site',
    value: 'site',
    icon: 'i-lucide-globe-2',
    active: path === '/_desk/site' || path.startsWith('/_desk/site/'),
    defaultOpen: true,
    children: SITE_ADMIN_CHILD_SECTIONS.filter(section => enabled || section.id === 'general').map(section => ({
      ...section,
      active: isSiteAdminRouteActive(path, section)
    }))
  }
}
