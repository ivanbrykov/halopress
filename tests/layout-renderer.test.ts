import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const runtimeFiles = [
  'app/components/layout-renderer/LayoutRenderer.vue',
  'app/components/layout-renderer/LayoutComposition.vue',
  'server/utils/layout-rendering.ts',
  'shared/layout-rendering.ts'
]

describe('persisted Layout runtime boundary', () => {
  it('uses source-owned CSS-only 4/8/12 grids at the contract breakpoints', async () => {
    const source = await readFile('app/components/layout-renderer/LayoutRenderer.vue', 'utf8')
    expect(source).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(source).toContain('@media (min-width: 640px)')
    expect(source).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))')
    expect(source).toContain('@media (min-width: 1024px)')
    expect(source).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))')
    expect(source).not.toMatch(/window\.innerWidth|clientWidth|matchMedia\(.+min-width/)
  })

  it('keeps persisted rendering separate from Nuxt layouts and editor runtime', async () => {
    const sources = await Promise.all(runtimeFiles.map(async file => `${file}\n${await readFile(file, 'utf8')}`))
    const combined = sources.join('\n')
    expect(combined).not.toMatch(/layout-editor|LayoutCanvas|resolveComponent|import\(['"`].*\.vue|app\/layouts\//)
    expect(combined).not.toContain('SiteWorkspaceShell')
    expect(combined).toContain('defineLayoutRendererRegistry')
    expect(combined).toContain('No API string is resolved')
  })

  it('makes all five composition routes layout-free and leaves the editor preview untouched', async () => {
    const routes = [
      'app/pages/[...path].vue',
      'app/pages/[schema]/index.vue',
      'app/pages/[schema]/[id].vue',
      'app/pages/_preview/pages/[id].vue',
      'app/pages/_preview/content/[schemaKey]/[id].vue'
    ]
    for (const route of routes) {
      const source = await readFile(route, 'utf8')
      expect(source, route).toMatch(/definePageMeta\([\s\S]*layout:\s*false/)
      expect(source, route).toContain('LayoutComposition')
    }
    expect(await readFile('app/components/PageEditor.vue', 'utf8')).not.toContain('LayoutComposition')
  })

  it('preserves safe external Menu attributes and public head metadata in the ready shell', async () => {
    const source = await readFile('app/components/layout-renderer/LayoutRenderer.vue', 'utf8')
    expect(source).toContain('resolvedMenuNavigationItems(element.props.menu.document, route.path)')
    expect(source).not.toContain('document.items.map')
    expect(source).toContain('htmlAttrs: { lang: props.projection.site.locale }')
    expect(source).toContain(`rel: 'icon'`)
    expect(source).toContain(`name: 'description'`)
    expect(source).toContain('titleTemplate: title => title || props.projection.site.siteName')
    expect(source).toContain('const themeAdapterStyle = computed(() => haloThemeAdapterStyle())')
    expect(source).toContain(':style="themeAdapterStyle"')
    expect(source).toContain('style: themeAdapterStyle.value')
  })

  it('keeps the default Nuxt layout a thin code-owned wrapper only', async () => {
    const source = await readFile('app/layouts/default.vue', 'utf8')
    expect(source).toContain('Persisted HaloPress Layout IDs never select')
    expect(source).toContain('<BuiltInLayoutRenderer>')
    expect(source).not.toContain('UNavigationMenu')
  })

  it('keeps built-in shell status non-blocking and fallback dates timezone-stable', async () => {
    const source = await readFile('app/components/layout-renderer/BuiltInLayoutRenderer.vue', 'utf8')
    expect(source).toContain('const { data: membership } = useFetch<{ registrationEnabled: boolean }>(\'/api/membership\')')
    expect(source).not.toContain('await useFetch<{ registrationEnabled: boolean }>(\'/api/membership\')')
    expect(source.match(/v-if="membership\?\.registrationEnabled"/g)).toHaveLength(2)
    expect(source).toContain('new Date().getUTCFullYear()')
    expect(source).not.toContain('new Date().getFullYear()')
  })

  it('batches selected Menus and bounds Page-list projection in database queries', async () => {
    const [layoutResolver, menuResolver] = await Promise.all([
      readFile('server/utils/layout-rendering.ts', 'utf8'),
      readFile('server/utils/site-menus.ts', 'utf8')
    ])
    expect(layoutResolver).toContain('resolvePublicLayoutMenus(args.event, menuSetIds')
    expect(layoutResolver).toContain('.orderBy(...order).limit(props.limit)')
    expect(layoutResolver).not.toContain('listCanonicalPublicRoutes(db)')
    expect(menuResolver).toContain('listCanonicalPublicRoutesByIdentity')
    expect(menuResolver).toContain('inArray(siteMenuSetTable.id, menuSetIds)')
  })

  it('restores shell-free Site head metadata only after full-preview authorization', async () => {
    const [headOwner, pagePreview, contentPreview] = await Promise.all([
      readFile('app/composables/useAuthenticatedPreviewSiteHead.ts', 'utf8'),
      readFile('app/pages/_preview/pages/[id].vue', 'utf8'),
      readFile('app/pages/_preview/content/[schemaKey]/[id].vue', 'utf8')
    ])
    expect(headOwner).toContain('htmlAttrs: { lang: presentation.value.general.locale }')
    expect(headOwner).toContain('rel: \'icon\'')
    expect(headOwner).toContain('name: \'description\'')
    expect(headOwner).toContain('presentation: ComputedRef<PublicSitePresentation>')
    expect(headOwner).not.toContain('await useSitePresentation()')
    expect(headOwner).not.toContain('BuiltInLayoutRenderer')
    for (const preview of [pagePreview, contentPreview]) {
      expect(preview).toContain('const { presentation: previewPresentation } = await useSitePresentation()')
      expect(preview).toContain('useAuthenticatedPreviewSiteHead(previewPresentation)')
      expect(preview).not.toContain('await useAuthenticatedPreviewSiteHead(')
      expect(preview.indexOf('useAuthenticatedPreviewSiteHead(previewPresentation)')).toBeGreaterThan(preview.indexOf('=== \'ready\''))
    }
  })
})
