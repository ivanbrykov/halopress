import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { haloThemeAdapterStyle, siteThemeStyle } from '../app/utils/site-presentation'
import { createPortablePageRendering, PORTABLE_CONTENT_STYLESHEET_PATH } from '../shared/portable-content'
import { defaultSitePresentation, toPublicSitePresentation } from '../shared/site-presentation'
import { defaultSiteTheme } from '../shared/site-theme'
import { buildSiteThemeArtifact } from '../server/utils/site-theme-settings'

const root = resolve(import.meta.dirname, '..')

describe('Site Theme app and mode boundaries', () => {
  it('drives the anonymous public shell only from the public Theme manifest', async () => {
    const [layout, mainCss, colorModeBridgePlugin] = await Promise.all([
      readFile(resolve(root, 'app/components/layout-renderer/BuiltInLayoutRenderer.vue'), 'utf8'),
      readFile(resolve(root, 'app/assets/css/main.css'), 'utf8'),
      readFile(resolve(root, 'server/plugins/public-color-mode-bridge.ts'), 'utf8')
    ])
    expect(layout).toContain('const { theme: siteTheme } = useSiteTheme()')
    expect(layout).toContain('siteTheme.value?.siteModeEnabled === true')
    expect(layout).not.toContain('useSiteMode()')
    expect(layout).not.toContain('/api/settings/site-mode')
    expect(layout).toContain('siteModeEnabled.value && siteTheme.value')
    expect(layout).toContain('siteThemeStyle(presentation.value, siteModeEnabled.value)')
    expect(layout).toContain('? siteTheme.value.colorMode')
    expect(layout).toContain(': presentation.value.appearance.colorMode')
    expect(layout).toContain('halo-stylesheet-${siteTheme.value.stylesheetUrl}')
    expect(layout).not.toContain('PORTABLE_CONTENT_STYLESHEET_PATH')
    expect(layout).toContain('site-theme-adapter')
    expect(layout).toContain('configuredColorModePreference')
    expect(layout).toContain(`hook('app:mounted'`)
    expect(layout).toContain(`window.matchMedia('(prefers-color-scheme: dark)')`)
    expect(layout).toContain(`addEventListener('change', syncSystemColorMode)`)
    expect(layout).toContain('colorMode.preference === \'system\' && systemPrefersDark.value')
    expect(layout).toContain('halo-public-color-mode-bridge')
    expect(layout).toContain('tagPriority: \'low\'')
    expect(layout).toContain('window.__NUXT_COLOR_MODE__')
    expect(layout).toContain('document.documentElement')
    expect(layout).toContain('e.classList.remove("light","dark")')
    expect(colorModeBridgePlugin).toContain('hooks.hook(\'render:response\'')
    expect(colorModeBridgePlugin).toContain('.replace(\'</head>\', `${bridge}</head>`)')
    expect(layout).toContain('colorMode.preference === \'dark\'')
    expect(layout).toContain('colorMode.preference === \'light\'')
    expect(layout).toContain('\'data-halo-color-mode\': siteModeEnabled.value ? shellColorMode.value : undefined')
    expect(layout).not.toContain('<style>')
    expect(mainCss).toContain('body.site-theme-adapter[data-halo-theme-enabled="true"]')
    expect(mainCss).toContain('[data-halo-color-mode="dark"]')
    expect(mainCss).toContain('@media (prefers-color-scheme: dark)')
    expect(mainCss).toContain('[data-halo-color-mode="default"]')
    expect(mainCss).toContain('color-scheme: dark')
    expect(mainCss).toContain('body.site-theme-adapter[data-halo-theme-enabled="true"] {\n  font-family: var(--halo-font-family-body)')
    expect(mainCss).toContain('font-size: var(--halo-font-size-base)')
    expect(mainCss).toContain('line-height: var(--halo-line-height-body)')
    expect(mainCss).toContain('line-height: inherit')
    expect(mainCss).toContain('font-family: var(--halo-font-family-heading)')
    expect(mainCss).toContain('line-height: var(--halo-line-height-heading)')
    for (const role of ['primary', 'secondary', 'success', 'info', 'warning', 'error']) {
      expect(mainCss).toContain(`:where(.bg-${role})`)
      expect(mainCss).toContain(`--ui-text-inverted: var(--halo-site-color-on-${role})`)
    }
    expect(layout).toContain('data-public-color-mode-toggle')
    expect(layout).toContain(':aria-label="visitorColorModeLabel"')
    expect(layout).toContain(':icon="visitorColorModeIcon"')
    expect(layout).toContain('colorMode.preference = visitorColorModeIsDark.value ? \'light\' : \'dark\'')
  })

  it('retains legacy Nuxt UI shell tokens while disabled and maps every v4 semantic role while enabled', () => {
    const presentation = toPublicSitePresentation(defaultSitePresentation(), new Set(), 'test')
    const disabled = siteThemeStyle(presentation, false)
    expect(disabled['--ui-color-primary-500']).toBe('var(--color-purple-500)')
    expect(disabled['--ui-color-neutral-500']).toBe('var(--color-zinc-500)')
    expect(disabled['--ui-radius']).toBe('0.25rem')
    expect(disabled['--site-line-height']).toBe('1.6')
    expect(disabled['--ui-primary']).toBeUndefined()

    const enabled = siteThemeStyle(presentation, true)
    expect(enabled).toEqual(haloThemeAdapterStyle())
    const exactRoles = {
      '--ui-text': '--halo-site-color-text',
      '--ui-text-dimmed': '--halo-site-color-text-dimmed',
      '--ui-text-muted': '--halo-site-color-text-muted',
      '--ui-text-toned': '--halo-site-color-text-toned',
      '--ui-text-highlighted': '--halo-site-color-text-highlighted',
      '--ui-text-inverted': '--halo-site-color-text-inverted',
      '--ui-bg': '--halo-site-color-background',
      '--ui-bg-muted': '--halo-site-color-background-muted',
      '--ui-bg-elevated': '--halo-site-color-background-elevated',
      '--ui-bg-accented': '--halo-site-color-background-accented',
      '--ui-bg-inverted': '--halo-site-color-background-inverted',
      '--ui-border': '--halo-site-color-border',
      '--ui-border-muted': '--halo-site-color-border-muted',
      '--ui-border-accented': '--halo-site-color-border-accented',
      '--ui-border-inverted': '--halo-site-color-border-inverted'
    } as const
    for (const [variable, haloRole] of Object.entries(exactRoles)) {
      expect(enabled[variable]).toContain(`var(${haloRole}`)
    }
    for (const variable of [
      '--ui-primary', '--ui-secondary', '--ui-success', '--ui-info', '--ui-warning', '--ui-error', '--ui-radius'
    ]) expect(enabled[variable]).toContain('var(--halo-')
    expect(enabled['--ui-color-primary-500']).toBeUndefined()
  })

  it('keeps the Theme artifact in headless envelopes when Site mode is disabled', () => {
    const artifact = buildSiteThemeArtifact(defaultSiteTheme())
    const theme = {
      revision: artifact.revision,
      stylesheetRevision: artifact.stylesheetRevision,
      stylesheetUrl: `https://press.example.com${artifact.stylesheetPath}`,
      colorMode: artifact.value.colorMode,
      siteModeEnabled: false
    }
    const rendering = createPortablePageRendering({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Portable Theme' }] }]
    }, { origin: 'https://press.example.com', theme })
    expect(rendering.stylesheets).toEqual([
      `https://press.example.com${PORTABLE_CONTENT_STYLESHEET_PATH}`,
      theme.stylesheetUrl
    ])
    expect(rendering.themeRevision).toBe(artifact.revision)
  })

  it('moves Appearance to Site and partitions Desk color-mode ownership deliberately', async () => {
    const [appearance, app, desk, deskPreference, layout, pagePreview, contentPreview] = await Promise.all([
      readFile(resolve(root, 'app/pages/_desk/settings/appearance.vue'), 'utf8'),
      readFile(resolve(root, 'app/app.vue'), 'utf8'),
      readFile(resolve(root, 'app/layouts/desk.vue'), 'utf8'),
      readFile(resolve(root, 'app/composables/useDeskColorMode.ts'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-renderer/BuiltInLayoutRenderer.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_preview/pages/[id].vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_preview/content/[schemaKey]/[id].vue'), 'utf8')
    ])
    expect(appearance).toContain('? \'/_desk/site/themes\'')
    expect(appearance).toContain(': \'/_desk/site/general#built-in-appearance\'')
    expect(appearance).toContain('redirectCode: 302')
    expect(appearance).not.toContain('savePatch')
    expect(app).not.toContain('useSitePresentation()')
    expect(app).not.toContain('useSiteTheme()')
    expect(desk).toContain('useDeskColorMode()')
    expect(desk).not.toContain('presentation.value.appearance.colorMode')
    expect(deskPreference).toContain('useColorMode()')
    expect(deskPreference).not.toContain('site.presentation')
    for (const preview of [pagePreview, contentPreview]) {
      expect(preview).toContain('const { theme: previewTheme } = useSiteTheme()')
      expect(preview).toContain('previewTheme.value?.colorMode')
      expect(preview.indexOf('useSiteTheme()')).toBeGreaterThan(preview.indexOf(`=== 'ready'`))
    }
    expect(layout).toContain('presentation.value.appearance.colorMode')
  })

  it('keeps Site document renderers independent from standalone artifacts and Theme fetches', async () => {
    const [pageRenderer, fieldRenderer, schemaIndex, artifactPreview, artifactPreviewRoute] = await Promise.all([
      readFile(resolve(root, 'app/components/PageDocumentRenderer.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/public/FieldRenderer.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/[schema]/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/SiteThemeArtifactPreview.vue'), 'utf8'),
      readFile(resolve(root, 'server/api/preview/site-theme-artifact.get.ts'), 'utf8')
    ])
    for (const renderer of [pageRenderer, fieldRenderer]) {
      expect(renderer).not.toContain('useSiteTheme()')
      expect(renderer).not.toContain('portable-content')
      expect(renderer).not.toContain('useColorMode()')
      expect(renderer).not.toContain('data-halo-color-mode')
      expect(renderer).not.toContain('useHead(')
      expect(renderer).not.toContain('v-html')
      expect(renderer).not.toContain('useRequestURL()')
    }
    expect(schemaIndex).toContain('{ query: { rendering: \'0\' } }')
    expect(schemaIndex).not.toContain(':rendering="standalonePage.rendering"')
    expect(artifactPreview).toContain('<iframe')
    expect(artifactPreview).toContain('src="/api/preview/site-theme-artifact"')
    expect(artifactPreview).toContain('sandbox="allow-same-origin"')
    expect(artifactPreview).not.toContain('PageDocumentRenderer')
    expect(artifactPreviewRoute).toContain('await requireAdmin(event)')
    expect(artifactPreviewRoute).toContain('createPortablePageRendering')
    expect(artifactPreviewRoute).toContain('createPortableStandaloneDocument')
    expect(artifactPreviewRoute).toContain('getPublicSiteThemeManifest(event)')
    expect(artifactPreviewRoute).toContain('frame-ancestors')
  })

  it('exposes an accessible single active editor with live draft status and numeric controls', async () => {
    const editor = await readFile(resolve(root, 'app/pages/_desk/site/themes.vue'), 'utf8')
    expect(editor).toContain('title="Active theme"')
    expect(editor.match(/<UForm\b/g)).toHaveLength(1)
    expect(editor).toContain('name="colorMode"')
    expect(editor).toContain('<UInputNumber')
    expect(editor).toContain('aria-live="polite"')
    expect(editor).toContain('isDirty ? \'Unsaved custom token changes.\'')
    expect(editor).toContain('<p v-if="saveStatus"')
    expect(editor).toContain('{{ saveStatus }}')
    expect(editor).toContain('The Theme changed elsewhere. Refresh before saving again.')
    expect(editor).toContain('Your draft was preserved')
    expect(editor).toContain('Theme validation failed')
    expect(editor).toContain('<USlideover')
    expect(editor).not.toContain('unmount-on-hide')
  })

  it('protects Theme administration and gates mutation before reading its body', async () => {
    const [getRoute, putRoute, manifestRoute, cssRoute] = await Promise.all([
      readFile(resolve(root, 'server/api/settings/theme.get.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/settings/theme.put.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/delivery/site-theme.get.ts'), 'utf8'),
      readFile(resolve(root, 'server/routes/_halo/theme/v1/[revision].css.get.ts'), 'utf8')
    ])
    expect(getRoute).toContain('await requireAdmin(event)')
    expect(putRoute.indexOf('await requireAdmin(event)')).toBeLessThan(putRoute.indexOf('getSiteMode(event)'))
    expect(putRoute.indexOf('getSiteMode(event)')).toBeLessThan(putRoute.indexOf('readBody(event)'))
    expect(putRoute).toContain('Enable Site features before publishing')
    expect(manifestRoute).not.toContain('requireAdmin')
    expect(cssRoute).not.toContain('requireAdmin')
  })
})
