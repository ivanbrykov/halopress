import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildDeskNavigationGroups } from '../app/utils/desk-navigation'
import { buildSettingsNavigation } from '../shared/settings-sections'
import { buildSiteAdminNavigation } from '../shared/site-admin-sections'

function navigation(siteModeEnabled: boolean, path = '/_desk') {
  return buildDeskNavigationGroups({
    contentChildren: [{ label: 'Articles', to: '/_desk/content/article' }],
    siteNavigation: buildSiteAdminNavigation(path, siteModeEnabled),
    settingsNavigation: buildSettingsNavigation(path),
    siteModeEnabled,
    active: {
      schemas: path.startsWith('/_desk/schemas'),
      users: path.startsWith('/_desk/users'),
      content: path.startsWith('/_desk/content'),
      pages: path.startsWith('/_desk/pages'),
      assets: path.startsWith('/_desk/assets')
    }
  })
}

describe('Desk navigation', () => {
  it('keeps the exact primary and administration groups while Site mode is disabled', () => {
    const groups = navigation(false)

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.map(item => item.label))).toEqual([
      ['Dashboard', 'Content', 'Pages', 'Assets', 'Site'],
      ['Schemas', 'Users', 'Settings']
    ])
    expect(groups.flat().find(item => item.label === 'Site')).toMatchObject({
      to: '/_desk/site',
      children: [{ label: 'General', to: '/_desk/site/general' }]
    })
    expect(groups.flat().some(item => item.label === 'Back to Site')).toBe(false)
    expect(groups.flat().some(item => item.label === 'Viewer')).toBe(false)
  })

  it('adds one distinct same-window public Site exit only when explicitly enabled', () => {
    const groups = navigation(true)

    expect(groups).toHaveLength(3)
    expect(groups[2]).toEqual([{
      label: 'Back to Site',
      to: '/',
      icon: 'i-lucide-arrow-left'
    }])
    expect(groups.flat().find(item => item.label === 'Site')?.children).toHaveLength(4)
    expect(groups[2]?.[0]).not.toHaveProperty('target')
  })

  it('preserves nested active state and the supported collapsed and narrow menu behavior', async () => {
    const siteGroups = navigation(true, '/_desk/site/layouts/layout-1/edit')
    const settingsGroups = navigation(true, '/_desk/settings/access')
    const contentGroups = navigation(true, '/_desk/content/article/entry-1')

    expect(siteGroups[0]?.[4]).toMatchObject({ label: 'Site', active: true })
    expect(siteGroups[0]?.[4]?.children?.find(item => item.label === 'Layouts')).toMatchObject({ active: true })
    expect(settingsGroups[1]?.[2]).toMatchObject({ label: 'Settings', active: true })
    expect(settingsGroups[1]?.[2]?.children?.find(item => item.label === 'Authentication & membership'))
      .toMatchObject({ active: true })
    expect(contentGroups[0]?.[1]).toMatchObject({
      label: 'Content',
      value: 'content',
      defaultOpen: true,
      active: true,
      children: [{ label: 'Articles', to: '/_desk/content/article' }]
    })

    const layout = await readFile(resolve(import.meta.dirname, '../app/layouts/desk.vue'), 'utf8')
    expect(layout).toContain('v-model="openNavItems"')
    expect(layout).toContain('aria-label="Desk navigation"')
    expect(layout).toContain(':collapsed="collapsed"')
    expect(layout).toContain(':tooltip="collapsed"')
    expect(layout).toContain(':popover="collapsed"')
    expect(layout).toContain(':ui="{ linkLabel: collapsed ? \'!block sr-only\' : undefined }"')
    expect(layout).toContain('<UDashboardSidebar class="min-h-dvh" resizable collapsible')
  })
})
