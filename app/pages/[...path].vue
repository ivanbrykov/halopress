<script setup lang="ts">
import { publicPathFromDecodedSegments, publicPathToHref } from '~~/shared/public-routing'
import BuiltInLayoutRenderer from '~/components/layout-renderer/BuiltInLayoutRenderer.vue'
import LayoutComposition from '~/components/layout-renderer/LayoutComposition.vue'

definePageMeta({ layout: false })

const route = useRoute()
const { applyPublic, applyPrivateNoindex } = usePublicPageDeliveryHeaders()
let requestedPath = ''
try {
  requestedPath = publicPathFromDecodedSegments(
    Array.isArray(route.params.path) ? route.params.path.map(String) : [String(route.params.path)]
  )
} catch {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const { data: resolved, error } = await useFetch<any>('/api/delivery/route', { query: { path: requestedPath, includeLayout: 1 } })
if (error.value || !resolved.value) {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const isAlias = resolved.value.routeKind === 'alias'
if (isAlias) {
  applyPublic()
  await navigateTo(publicPathToHref(resolved.value.canonicalPath), { redirectCode: 301 })
}
if (!isAlias && resolved.value.documentKind !== 'page') {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const page = ref<any>(null)
if (!isAlias) {
  const { data, error: pageError } = await useFetch<any>(
    () => `/api/delivery/page/${resolved.value.documentId}`,
    { query: { rendering: '0' } }
  )
  if (pageError.value || !data.value) {
    applyPrivateNoindex()
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  page.value = data.value
  applyPublic()
  usePublicRouteSeo(computed(() => resolved.value?.seo))
}
</script>

<template>
  <LayoutComposition v-if="resolved?.layout" :projection="resolved.layout">
    <article class="layout-route-page-content">
      <header><h1>{{ page?.title || 'Untitled page' }}</h1></header>
      <PageDocumentRenderer :document="page?.content" />
    </article>

    <template #fallback>
      <BuiltInLayoutRenderer>
        <UContainer class="py-8">
          <UPage>
            <UPageHeader :title="page?.title || 'Untitled page'" />
            <UPageBody><PageDocumentRenderer :document="page?.content" /></UPageBody>
          </UPage>
        </UContainer>
      </BuiltInLayoutRenderer>
    </template>
  </LayoutComposition>
</template>

<style scoped>
.layout-route-page-content { display: grid; gap: 2rem; }
.layout-route-page-content h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
</style>
