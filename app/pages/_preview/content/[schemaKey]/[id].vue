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
const schemaKey = computed(() => String(route.params.schemaKey))
const id = computed(() => String(route.params.id))
const { data: doc, error: documentError } = await useFetch<any>(
  () => `/api/preview/content/${schemaKey.value}/${id.value}`,
  { query: { rendering: '0' } }
)
const documentState = getPreviewDataState(doc.value, documentError.value)
const schema = computed(() => doc.value?.schema ?? null)
const previewState = documentState === 'ready' && schema.value ? 'ready' : 'not-found'
if (previewState === 'ready') {
  const { presentation: previewPresentation } = await useSitePresentation()
  useAuthenticatedPreviewSiteHead(previewPresentation)
  const { theme: previewTheme } = useSiteTheme()
  const previewColorMode = useColorMode()
  watch(() => previewTheme.value?.colorMode, (preference) => {
    if (preference) previewColorMode.preference = preference
  }, { immediate: true, flush: 'sync' })
}
if (previewState === 'not-found' && import.meta.server) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404, 'Content not found')
}
</script>

<template>
  <LayoutComposition v-if="previewState === 'ready' && doc?.layout" :projection="doc.layout">
    <section class="layout-route-preview-content">
      <p class="layout-route-preview-label">Private preview · {{ schema?.title || schemaKey }}</p>
      <PublicContentDetailRenderer v-if="doc?.content" :schema="schema" :content="doc.content" :fallback-title="doc?.id || id" />
    </section>

    <template #fallback>
      <UContainer class="py-8">
        <UPage>
          <UPageHeader :title="doc?.content?.title || doc?.id || id" :description="`Draft preview · ${schema?.title || schemaKey}`">
            <template #headline><UBadge color="warning" variant="subtle">Private preview</UBadge></template>
          </UPageHeader>
          <UPageBody>
            <PublicContentDetailRenderer v-if="doc?.content" :schema="schema" :content="doc.content" :fallback-title="doc?.id || id" />
            <UAlert v-else title="Unable to render preview" description="The schema or working content is unavailable." color="warning" variant="subtle" />
          </UPageBody>
        </UPage>
      </UContainer>
    </template>
  </LayoutComposition>
  <UContainer v-else class="py-16">
    <main>
      <h1 class="text-2xl font-semibold">
        Content not found
      </h1>
    </main>
  </UContainer>
</template>

<style scoped>
.layout-route-preview-content { display: grid; gap: 1.5rem; width: 100%; }
.layout-route-preview-label { color: var(--halo-site-color-warning); font-weight: 650; }
</style>
