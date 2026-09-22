import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SITE_ADMIN_CHILD_SECTIONS,
  SITE_ADMIN_SECTIONS,
  buildSiteAdminNavigation,
  findSiteAdminSection,
  isSiteAdminRouteActive
} from '../shared/site-admin-sections'

describe('Site administration foundation', () => {
  it('owns one overview plus General, Themes, Layouts, and Menus child routes', () => {
    expect(SITE_ADMIN_SECTIONS.map(section => section.id)).toEqual([
      'overview',
      'general',
      'themes',
      'layouts',
      'menus'
    ])
    expect(SITE_ADMIN_SECTIONS.map(section => section.to)).toEqual([
      '/_desk/site',
      '/_desk/site/general',
      '/_desk/site/themes',
      '/_desk/site/layouts',
      '/_desk/site/menus'
    ])
    expect(SITE_ADMIN_CHILD_SECTIONS.map(section => section.label)).toEqual(['General', 'Themes', 'Layouts', 'Menus'])
    expect(new Set(SITE_ADMIN_SECTIONS.map(section => section.to)).size).toBe(SITE_ADMIN_SECTIONS.length)
  })

  it('keeps General reachable when disabled and marks exact or deep routes when enabled', () => {
    expect(buildSiteAdminNavigation('/_desk/site/general', false)).toMatchObject({
      active: true,
      children: [{ label: 'General', to: '/_desk/site/general', active: true }]
    })

    const overview = buildSiteAdminNavigation('/_desk/site', true)
    expect(overview).toMatchObject({
      label: 'Site',
      to: '/_desk/site',
      value: 'site',
      active: true,
      children: [
        { label: 'General', to: '/_desk/site/general', active: false },
        { label: 'Themes', to: '/_desk/site/themes', active: false },
        { label: 'Layouts', to: '/_desk/site/layouts', active: false },
        { label: 'Menus', to: '/_desk/site/menus', active: false }
      ]
    })

    const deepLayout = buildSiteAdminNavigation('/_desk/site/layouts/layout-1/edit', true)
    expect(deepLayout?.active).toBe(true)
    expect(deepLayout?.children.map(child => child.active)).toEqual([false, false, true, false])
    expect(buildSiteAdminNavigation('/_desk/site-other', true)?.active).toBe(false)
    expect(isSiteAdminRouteActive('/_desk/site/themes-extra', findSiteAdminSection('themes'))).toBe(false)
  })

  it('uses one administrator-only section component for overview and child routes', async () => {
    const root = resolve(import.meta.dirname, '..')
    const pagePaths = [
      'app/pages/_desk/site/index.vue',
      'app/pages/_desk/site/general.vue',
      'app/pages/_desk/site/themes.vue',
      'app/pages/_desk/site/layouts/index.vue',
      'app/pages/_desk/site/layouts/[layoutId].vue',
      'app/pages/_desk/site/menus/index.vue',
      'app/pages/_desk/site/menus/[menuId].vue'
    ]
    const [component, deskLayout, settingsPage, composable, presentationComposable, themeComposable, ...pages] = await Promise.all([
      readFile(resolve(root, 'app/components/SiteAdminSection.vue'), 'utf8'),
      readFile(resolve(root, 'app/layouts/desk.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/general.vue'), 'utf8'),
      readFile(resolve(root, 'app/composables/useSiteModeSettings.ts'), 'utf8'),
      readFile(resolve(root, 'app/composables/useSitePresentationSettings.ts'), 'utf8'),
      readFile(resolve(root, 'app/composables/useSiteThemeSettings.ts'), 'utf8'),
      ...pagePaths.map(path => readFile(resolve(root, path), 'utf8'))
    ])

    for (const page of pages) {
      expect(page).toContain('layout: \'desk\'')
      expect(page).toContain('<SiteAdminSection')
    }
    expect(pages[0]).not.toContain('navigateTo(')
    expect(component).toContain('Site features are disabled')
    expect(component).toContain('Open Site General')
    expect(component).toContain('aria-label="Site location"')
    expect(component).toContain('aria-label="Site sections"')
    expect(component).toContain('generalSection || (enabled && !verifyingMode && !error)')
    expect(component).toContain('v-if="!generalSection && verifyingMode"')
    expect(component).not.toContain('await useSiteMode()')
    expect(deskLayout).toContain('buildSiteAdminNavigation(route.path, siteModeEnabled.value)')
    expect(deskLayout).toContain('const { enabled: siteModeEnabled } = useSiteMode()')
    expect(deskLayout).toContain('await useFetch<{ items: any[] }>(\'/api/schema/list\')')
    expect(deskLayout).not.toContain('await Promise.all')
    expect(deskLayout).toContain('v-model="openNavItems"')
    expect(deskLayout).toContain('setNavigationOpen(\'site\', enabled || siteRoute)')
    expect(deskLayout).toContain(':collapsed="collapsed"')
    expect(deskLayout).toContain(':popover="collapsed"')
    expect(settingsPage).toContain('v-model="modeState.enabled"')
    expect(settingsPage).toContain('<template #actions>')
    expect(settingsPage).toContain(':loading="pending || modePending || layoutAssignmentPending"')
    expect(settingsPage).not.toContain(':pending="pending || modePending || layoutAssignmentPending"')
    expect(settingsPage).toContain('Save Site mode')
    expect(settingsPage).toContain(':disabled="modeControlsDisabled"')
    expect(settingsPage).toContain('id="built-in-footer"')
    expect(settingsPage).toContain('Open Layouts')
    expect(settingsPage).toContain('Open Menus')
    expect(settingsPage.match(/applySiteGeneralServerSections\(state, response\.value/g)).toHaveLength(3)
    expect(settingsPage).not.toContain('watch(data')
    expect(composable).toContain('export function useSiteMode()')
    expect(composable).toContain('export function useSiteModeSettings()')
    expect(composable).not.toContain('export async function useSiteMode')
    expect(composable).not.toContain('await useFetch')
    expect(composable).toContain('const SITE_MODE_DATA_KEY = \'site-mode\'')
    expect(composable).toContain('result.data.value = response')
    expect(presentationComposable).toContain('export function useSitePresentationStatus()')
    expect(presentationComposable).toContain('export async function useSitePresentationSettings()')
    expect(themeComposable).toContain('export function useSiteThemeStatus()')
    expect(themeComposable).toContain('export async function useSiteThemeSettings()')
    expect(themeComposable).toContain('const result = await useSiteThemeSettingsData()')
  })

  it('provides useful, resilient status, authoring, and compatibility links', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [overview, themes, layouts, menus, menuEditor] = await Promise.all([
      readFile(resolve(root, 'app/pages/_desk/site/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/themes.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/layouts/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/menus/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/menus/[menuId].vue'), 'utf8')
    ])

    expect(overview).toContain('useSiteThemeStatus()')
    expect(overview).toContain('useLayoutResourceStatus()')
    expect(overview).toContain('useSiteLayoutAssignmentSettings()')
    expect(overview).not.toContain('useSitePresentationStatus()')
    expect(overview).not.toContain('await useSitePresentationSettings()')
    expect(overview).not.toContain('Not available yet')
    expect(overview).not.toContain('Default Layout: none')
    expect(overview).not.toContain('saveTheme')
    expect(overview).not.toContain('saveLayoutAssignment')
    expect(overview).toContain('Retry unavailable status')
    expect(overview).toContain('retryUnavailableStatus')
    expect(overview).toContain('Promise.allSettled(refreshes)')
    expect(overview).toContain('data-site-overview-resource="theme"')
    expect(overview).toContain('data-site-overview-resource="layouts"')
    expect(overview).toContain('aria-live="polite"')
    expect(overview).toContain('menuSetCount')
    expect(overview).toContain('menuLinkSummary')
    expect(overview).toContain('useSiteMenusStatus()')
    expect(overview).toContain('/_desk/site/themes')
    expect(overview).toContain('/_desk/site/layouts')
    expect(overview).toContain('/_desk/site/menus')
    expect(themes).toContain('Active theme')
    expect(themes).toContain('<UForm')
    expect(themes).toContain('<UInputNumber')
    expect(themes).toContain('<USlideover')
    expect(themes).toContain('useUnsavedNavigationGuard')
    expect(themes).toContain('siteThemeAccessibilityWarnings')
    expect(themes).not.toContain('unmount-on-hide')
    expect(menus).toContain('<template #actions>')
    expect(menus).toContain('<UModal')
    expect(menus).toContain('data-menu-create-trigger')
    expect(menus).not.toContain('aria-labelledby="menu-create-heading"')
    expect(menus).not.toContain('Save menu')
    expect(menus).not.toContain('SiteMenuItemList')
    expect(menuEditor).toContain('Save menu')
    expect(menuEditor).toContain('SiteMenuItemList')
    expect(menuEditor).toContain('Back to menu sets')
    expect(layouts).toContain('data-layout-list-toolbar')
    expect(layouts).toContain('New layout')
    expect(layouts).toContain('data-layout-create-modal')
    expect(layouts).toContain('data-layout-create-slideover')
  })

  it('keeps Layout resources isolated from Nuxt layouts and public delivery', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [docs, publicLayout, publicCatchAll, publicPresentationRoute] = await Promise.all([
      readFile(resolve(root, 'docs/SETTINGS.md'), 'utf8'),
      readFile(resolve(root, 'app/layouts/default.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/[...path].vue'), 'utf8'),
      readFile(resolve(root, 'server/api/delivery/site-presentation.get.ts'), 'utf8')
    ])

    expect(docs).toContain('`Layout` is the HaloPress domain name')
    expect(docs).toContain('It is not a Nuxt application layout')
    for (const publicSurface of [publicLayout, publicCatchAll, publicPresentationRoute]) {
      expect(publicSurface).not.toContain('SiteAdminSection')
      expect(publicSurface).not.toContain('site-mode')
      expect(publicSurface).not.toContain('app/layouts/desk.vue')
    }
  })
})
