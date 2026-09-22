import type { NavigationMenuItem } from '@nuxt/ui'

type DeskNavigationState = {
  contentChildren: NavigationMenuItem[]
  siteNavigation: NavigationMenuItem
  settingsNavigation: NavigationMenuItem
  siteModeEnabled: boolean
  active: {
    schemas: boolean
    users: boolean
    content: boolean
    pages: boolean
    assets: boolean
  }
}

export function buildDeskNavigationGroups(state: DeskNavigationState): NavigationMenuItem[][] {
  const primaryWork: NavigationMenuItem[] = [
    {
      label: 'Dashboard',
      to: '/_desk',
      icon: 'i-lucide-home'
    },
    {
      label: 'Content',
      value: 'content',
      icon: 'i-lucide-files',
      defaultOpen: true,
      active: state.active.content,
      children: state.contentChildren
    },
    {
      label: 'Pages',
      to: '/_desk/pages',
      icon: 'i-lucide-panels-top-left',
      active: state.active.pages
    },
    {
      label: 'Assets',
      to: '/_desk/assets',
      icon: 'i-lucide-image',
      active: state.active.assets
    },
    state.siteNavigation
  ]

  const administration: NavigationMenuItem[] = [
    {
      label: 'Schemas',
      to: '/_desk/schemas',
      icon: 'i-lucide-braces',
      active: state.active.schemas
    },
    {
      label: 'Users',
      to: '/_desk/users',
      icon: 'i-lucide-users',
      active: state.active.users
    },
    state.settingsNavigation
  ]

  const groups = [primaryWork, administration]
  if (state.siteModeEnabled) {
    groups.push([{
      label: 'Back to Site',
      to: '/',
      icon: 'i-lucide-arrow-left'
    }])
  }

  return groups
}
