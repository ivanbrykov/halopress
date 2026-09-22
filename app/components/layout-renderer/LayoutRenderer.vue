<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { LayoutRenderProjection, ResolvedLayoutElement } from '~~/shared/layout-rendering'
import { defineLayoutRendererRegistry, resolveLayoutRenderer } from '~~/shared/site-layout-renderer'
import type { LayoutElement } from '~~/shared/site-layout'

type ReadyProjection = Extract<LayoutRenderProjection, { status: 'ready' }>
type ElementView = { element: ResolvedLayoutElement }

const props = defineProps<{ projection: ReadyProjection }>()
const route = useRoute()
const colorMode = useColorMode()

// Security boundary: the validated semantic type is the only persisted value
// that enters this exhaustive code-owned registry. No API string is resolved
// as a Vue component, import, class, slot, Nuxt UI payload, or Nuxt layout.
const elementRegistry = defineLayoutRendererRegistry<ElementView>({
  'page-content': element => ({ element: element as ResolvedLayoutElement }),
  'site-logo': element => ({ element: element as ResolvedLayoutElement }),
  'site-title': element => ({ element: element as ResolvedLayoutElement }),
  menu: element => ({ element: element as ResolvedLayoutElement }),
  'page-list': element => ({ element: element as ResolvedLayoutElement }),
  'table-of-contents': element => ({ element: element as ResolvedLayoutElement }),
  copyright: element => ({ element: element as ResolvedLayoutElement })
})

const resolvedById = computed(() => new Map(props.projection.elements.map(element => [element.id, element])))
const regions = computed(() => props.projection.document.grid.regions.map(region => ({
  region,
  elements: props.projection.document.elements
    .filter(element => element.region === region.id)
    .sort((left, right) => left.order - right.order)
    .flatMap((element) => {
      const resolved = resolvedById.value.get(element.id)
      if (!resolved) return []
      return [resolveLayoutRenderer(elementRegistry, element as LayoutElement)(resolved as never)]
    })
})))
const hasPageContent = computed(() => props.projection.elements.some(element => element.type === 'page-content'))

function regionStyle(region: ReadyProjection['document']['grid']['regions'][number]) {
  return {
    '--layout-mobile-row': region.placement.mobile.row,
    '--layout-mobile-column': region.placement.mobile.column,
    '--layout-mobile-span': region.placement.mobile.span,
    '--layout-tablet-row': region.placement.tablet.row,
    '--layout-tablet-column': region.placement.tablet.column,
    '--layout-tablet-span': region.placement.tablet.span,
    '--layout-desktop-row': region.placement.desktop.row,
    '--layout-desktop-column': region.placement.desktop.column,
    '--layout-desktop-span': region.placement.desktop.span
  } as CSSProperties
}

function menuItems(element: Extract<ResolvedLayoutElement, { type: 'menu' }>) {
  if (element.props.menu.status !== 'ready') return []
  return resolvedMenuNavigationItems(element.props.menu.document, route.path)
}

const theme = computed(() => props.projection.theme)
const themeAdapterStyle = computed(() => haloThemeAdapterStyle())
const renderedColorMode = computed(() => colorMode.preference === 'dark'
  ? 'dark'
  : colorMode.preference === 'light' ? 'light' : 'default')
const themeStylesheets = computed(() => [theme.value.stylesheetUrl])
const colorModeBridgeScript = computed(() => {
  const preference = theme.value.colorMode
  return `(function(){var p="${preference}",m=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p,e=document.documentElement,h=window.__NUXT_COLOR_MODE__;e.classList.remove("light","dark");e.classList.add(m);e.style.colorScheme=m;if(h){h.preference=p;h.value=m}})()`
})

watch(() => theme.value.colorMode, (preference) => {
  colorMode.preference = preference
}, { immediate: true, flush: 'sync' })
useHead(() => ({
  titleTemplate: title => title || props.projection.site.siteName,
  htmlAttrs: { lang: props.projection.site.locale },
  bodyAttrs: {
    class: 'site-theme-adapter',
    'data-halo-theme-enabled': 'true',
    'data-halo-color-mode': renderedColorMode.value,
    style: themeAdapterStyle.value
  },
  link: [
    { key: 'halo-layout-favicon', rel: 'icon' as const, href: props.projection.site.faviconUrl },
    { key: 'halo-layout-apple-touch-icon', rel: 'apple-touch-icon' as const, href: props.projection.site.faviconUrl },
    ...themeStylesheets.value.map(href => ({ key: `halo-stylesheet-${href}`, rel: 'stylesheet' as const, href }))
  ],
  meta: [
    { key: 'halo-layout-description', name: 'description', content: props.projection.site.description, tagPriority: 'low' },
    { key: 'halo-layout-og-title', property: 'og:title', content: props.projection.site.siteName, tagPriority: 'low' },
    { key: 'halo-layout-og-description', property: 'og:description', content: props.projection.site.description, tagPriority: 'low' },
    { key: 'halo-layout-og-image', property: 'og:image', content: props.projection.site.socialImageUrl, tagPriority: 'low' },
    { key: 'halo-layout-twitter-card', name: 'twitter:card', content: 'summary_large_image', tagPriority: 'low' }
  ],
  script: [{
    key: 'halo-layout-color-mode-bridge',
    id: 'halo-layout-color-mode-bridge',
    tagPriority: 'low',
    innerHTML: colorModeBridgeScript.value
  }]
}))
</script>

<template>
  <div
    class="layout-runtime site-shell"
    data-layout-renderer
    :data-layout-id="props.projection.layoutId"
    :data-layout-revision="props.projection.layoutRevision"
    :data-theme-revision="props.projection.theme.revision"
    data-halo-theme-enabled="true"
    :data-halo-color-mode="renderedColorMode"
    :data-layout-gap="props.projection.document.grid.gap"
    :data-layout-max-width="props.projection.document.grid.maxWidth"
    :style="themeAdapterStyle"
  >
    <div class="layout-runtime-grid">
      <section
        v-for="regionView in regions"
        :key="regionView.region.id"
        class="layout-runtime-region"
        :data-layout-region="regionView.region.id"
        :data-layout-flow="regionView.region.flow"
        :data-mobile-visible="regionView.region.placement.mobile.visibility === 'visible'"
        :data-tablet-visible="regionView.region.placement.tablet.visibility === 'visible'"
        :data-desktop-visible="regionView.region.placement.desktop.visibility === 'visible'"
        :style="regionStyle(regionView.region)"
      >
        <template v-for="view in regionView.elements" :key="view.element.id">
          <main
            v-if="view.element.type === 'page-content'"
            class="layout-page-content"
            data-layout-element="page-content"
          >
            <slot />
          </main>

          <div
            v-else-if="view.element.type === 'site-logo'"
            class="layout-site-logo"
            data-layout-element="site-logo"
            :data-logo-size="view.element.props.size"
          >
            <NuxtLink v-if="view.element.props.logoUrl && view.element.props.link === 'home'" to="/" :aria-label="`${view.element.props.siteName} home`">
              <img :src="view.element.props.logoUrl" :alt="view.element.props.siteName">
            </NuxtLink>
            <img v-else-if="view.element.props.logoUrl" :src="view.element.props.logoUrl" :alt="view.element.props.siteName">
            <span v-else data-layout-element-empty aria-hidden="true" />
          </div>

          <div
            v-else-if="view.element.type === 'site-title'"
            class="layout-site-title"
            data-layout-element="site-title"
            :data-emphasis="view.element.props.emphasis"
          >
            <NuxtLink v-if="view.element.props.link === 'home'" to="/">{{ view.element.props.siteName }}</NuxtLink>
            <span v-else>{{ view.element.props.siteName }}</span>
          </div>

          <nav
            v-else-if="view.element.type === 'menu'"
            class="layout-menu"
            data-layout-element="menu"
            :aria-label="view.element.props.menu.status === 'ready' ? view.element.props.menu.name : 'Site navigation'"
          >
            <UNavigationMenu
              v-if="menuItems(view.element).length"
              :items="menuItems(view.element)"
              :orientation="view.element.props.orientation"
            />
            <span v-else data-layout-element-empty aria-hidden="true" />
          </nav>

          <nav
            v-else-if="view.element.type === 'page-list'"
            class="layout-page-list"
            data-layout-element="page-list"
            aria-label="Pages"
          >
            <ul>
              <li v-for="item in view.element.props.items" :key="item.id">
                <NuxtLink :to="item.path" :aria-current="route.path === item.path ? 'page' : undefined">{{ item.title }}</NuxtLink>
              </li>
            </ul>
          </nav>

          <nav
            v-else-if="view.element.type === 'table-of-contents'"
            class="layout-table-of-contents"
            data-layout-element="table-of-contents"
            aria-label="Table of contents"
          >
            <ol v-if="view.element.props.marker === 'ordered'">
              <li v-for="item in view.element.props.items" :key="item.id" :data-heading-level="item.level">
                <a :href="`#${item.id}`">{{ item.text }}</a>
              </li>
            </ol>
            <ul v-else>
              <li v-for="item in view.element.props.items" :key="item.id" :data-heading-level="item.level">
                <a :href="`#${item.id}`">{{ item.text }}</a>
              </li>
            </ul>
          </nav>

          <small
            v-else-if="view.element.type === 'copyright'"
            class="layout-copyright"
            data-layout-element="copyright"
          >{{ view.element.props.text }}</small>
        </template>
      </section>

      <main v-if="!hasPageContent" class="layout-page-content" data-layout-element="page-content-fallback">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout-runtime {
  min-height: 100dvh;
  color: var(--halo-site-color-text);
  background: var(--halo-site-color-background);
}

.layout-runtime-grid {
  display: grid;
  width: min(100%, 80rem);
  min-width: 0;
  min-height: 100dvh;
  margin-inline: auto;
  padding: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.5rem;
}

.layout-runtime[data-layout-max-width="content"] .layout-runtime-grid { width: min(100%, 64rem); }
.layout-runtime[data-layout-max-width="full"] .layout-runtime-grid { width: 100%; }
.layout-runtime[data-layout-gap="none"] .layout-runtime-grid { gap: 0; }
.layout-runtime[data-layout-gap="compact"] .layout-runtime-grid { gap: 0.75rem; }
.layout-runtime[data-layout-gap="spacious"] .layout-runtime-grid { gap: 2.5rem; }

.layout-runtime-region {
  display: flex;
  min-width: 0;
  grid-row: var(--layout-mobile-row);
  grid-column: var(--layout-mobile-column) / span var(--layout-mobile-span);
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}

.layout-runtime-region[data-mobile-visible="false"] { display: none; }
.layout-runtime-region[data-layout-flow="center"] { justify-content: center; }
.layout-runtime-region[data-layout-flow="end"] { justify-content: flex-end; }
.layout-runtime-region[data-layout-flow="space-between"] { justify-content: space-between; }
.layout-runtime-region[data-layout-region="left-sidebar"],
.layout-runtime-region[data-layout-region="right-sidebar"],
.layout-runtime-region[data-layout-region="content"] { flex-direction: column; }

.layout-runtime-region > *, .layout-page-content { min-width: 0; max-width: 100%; }
.layout-page-content { width: 100%; }
.layout-site-logo img { display: block; width: auto; max-width: min(100%, 14rem); object-fit: contain; }
.layout-site-logo[data-logo-size="small"] img { height: 1.75rem; }
.layout-site-logo[data-logo-size="medium"] img { height: 2.5rem; }
.layout-site-logo[data-logo-size="large"] img { height: 3.5rem; }
.layout-site-title { max-width: 100%; font-size: 1.25rem; }
.layout-site-title[data-emphasis="strong"] { font-weight: 700; }
.layout-menu { max-width: 100%; overflow-x: auto; }
.layout-page-list ul, .layout-table-of-contents ul, .layout-table-of-contents ol { display: grid; gap: 0.5rem; margin: 0; padding-inline-start: 1.25rem; }
.layout-table-of-contents li[data-heading-level="3"] { margin-inline-start: 0.75rem; }
.layout-table-of-contents li[data-heading-level="4"] { margin-inline-start: 1.5rem; }
.layout-copyright { color: var(--halo-site-color-text-muted); }

@media (min-width: 640px) {
  .layout-runtime-grid { padding: 1.5rem; grid-template-columns: repeat(8, minmax(0, 1fr)); }
  .layout-runtime-region {
    grid-row: var(--layout-tablet-row);
    grid-column: var(--layout-tablet-column) / span var(--layout-tablet-span);
  }
  .layout-runtime-region[data-mobile-visible="false"] { display: flex; }
  .layout-runtime-region[data-tablet-visible="false"] { display: none; }
}

@media (min-width: 1024px) {
  .layout-runtime-grid { padding: 2rem; grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .layout-runtime-region {
    grid-row: var(--layout-desktop-row);
    grid-column: var(--layout-desktop-column) / span var(--layout-desktop-span);
  }
  .layout-runtime-region[data-tablet-visible="false"] { display: flex; }
  .layout-runtime-region[data-desktop-visible="false"] { display: none; }
}
</style>
