<script setup lang="ts">
import { setResponseHeader, setResponseStatus } from 'h3'
import LayoutComposition from '~/components/layout-renderer/LayoutComposition.vue'

definePageMeta({
  layout: false
})

useSeoMeta({
  robots: 'noindex, nofollow, noarchive'
})

if (import.meta.server) {
  const event = useRequestEvent()
  if (event) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'Vary', 'Cookie')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
}

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: page, error: pageError } = await useFetch<any>(
  () => `/api/preview/page/${id.value}`,
  { query: { rendering: '0' } }
)
const pageState = getPreviewDataState(page.value, pageError.value)
if (pageState === 'ready') {
  const { presentation: previewPresentation } = await useSitePresentation()
  useAuthenticatedPreviewSiteHead(previewPresentation)
  const { theme: previewTheme } = useSiteTheme()
  const previewColorMode = useColorMode()
  watch(() => previewTheme.value?.colorMode, (preference) => {
    if (preference) previewColorMode.preference = preference
  }, { immediate: true, flush: 'sync' })
}
if (pageState === 'not-found' && import.meta.server) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404, 'Page not found')
}
</script>

<template>
  <LayoutComposition v-if="pageState === 'ready' && page?.layout" :projection="page.layout">
    <article class="layout-route-preview-content">
      <header>
        <p>Private preview</p>
        <h1>{{ page?.title || 'Untitled page' }}</h1>
        <p>Draft preview</p>
      </header>
      <PageDocumentRenderer :document="page?.content" />
    </article>

    <template #fallback>
      <UContainer class="py-8">
        <UPage>
          <UPageHeader :title="page?.title || 'Untitled page'" description="Draft preview">
            <template #headline><UBadge color="warning" variant="subtle">Private preview</UBadge></template>
          </UPageHeader>
          <UPageBody><PageDocumentRenderer :document="page?.content" /></UPageBody>
        </UPage>
      </UContainer>
    </template>
  </LayoutComposition>
  <UContainer v-else class="py-16">
    <main>
      <h1 class="text-2xl font-semibold">
        Page not found
      </h1>
    </main>
  </UContainer>
</template>

<style scoped>
.layout-route-preview-content { display: grid; gap: 2rem; width: 100%; }
.layout-route-preview-content h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
.layout-route-preview-content header > p:first-child { color: var(--halo-site-color-warning); font-weight: 650; }
</style>
