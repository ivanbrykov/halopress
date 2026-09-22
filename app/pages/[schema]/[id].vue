<script setup lang="ts">
import { PUBLIC_PAGE_ROUTE_PREFIX, publicPathFromDecodedSegments, publicPathToHref } from '~~/shared/public-routing'
import BuiltInLayoutRenderer from '~/components/layout-renderer/BuiltInLayoutRenderer.vue'
import LayoutComposition from '~/components/layout-renderer/LayoutComposition.vue'

definePageMeta({ layout: false, key: route => `${String(route.params.schema)}/${String(route.params.id)}` })

const route = useRoute()
const { applyPublic, applyPrivateNoindex } = usePublicPageDeliveryHeaders()
let requestedPath = ''
try {
  requestedPath = publicPathFromDecodedSegments([String(route.params.schema), String(route.params.id)])
} catch {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const routeResult = await useFetch<any>('/api/delivery/route', { query: { path: requestedPath, includeLayout: 1 } })
if (routeResult.error.value || !routeResult.data.value) {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const resolvedRoute = routeResult.data.value
const isAlias = resolvedRoute?.routeKind === 'alias'
if (isAlias) {
  applyPublic()
  await navigateTo(publicPathToHref(resolvedRoute.canonicalPath), { redirectCode: 301 })
}
if (!isAlias && !['content', 'page'].includes(resolvedRoute.documentKind)) {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const schemaKey = computed(() => String(resolvedRoute.schemaKey || route.params.schema))
const id = computed(() => String(resolvedRoute.documentId))

const standalonePage = ref<any>(null)
if (!isAlias && resolvedRoute.documentKind === 'page') {
  const pageId = String(resolvedRoute.documentId)
  const { data, error } = await useFetch<any>(
    () => `/api/delivery/page/${pageId}`,
    { query: { rendering: '0' } }
  )
  const statusCode = Number((error.value as any)?.statusCode ?? (error.value as any)?.status ?? 0)
  if (error.value || !data.value) {
    applyPrivateNoindex()
    throw createError({
      statusCode: statusCode && statusCode !== 404 ? statusCode : 404,
      statusMessage: statusCode && statusCode !== 404 ? 'Unable to load page' : 'Not Found'
    })
  }
  standalonePage.value = data.value
}

const doc = ref<any>(null)
const schema = ref<any>(null)
if (!isAlias && !standalonePage.value) {
  const { data: permission, error: permissionError } = await useFetch<{ canRead: boolean }>(
    () => `/api/schema/${schemaKey.value}/permission`,
    { server: true }
  )
  if (permissionError.value || !permission.value?.canRead) {
    applyPrivateNoindex()
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const result = await useHalopressContent(schemaKey, {
    id,
    status: 'published',
    includeRendering: false,
    respectStandalonePageClaim: schemaKey.value === PUBLIC_PAGE_ROUTE_PREFIX
  })
  if (result.error.value || !result.content.value) {
    applyPrivateNoindex()
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  doc.value = result.content.value
  schema.value = result.schema.value
}

const content = computed<Record<string, unknown>>(() => doc.value?.content ?? doc.value?.extra ?? {})
if (!isAlias) {
  applyPublic()
  usePublicRouteSeo(computed(() => resolvedRoute?.seo))
}
</script>

<template>
  <LayoutComposition v-if="resolvedRoute?.layout" :projection="resolvedRoute.layout">
    <article v-if="standalonePage" class="layout-route-page-content">
      <header><h1>{{ standalonePage.title || 'Untitled page' }}</h1></header>
      <PageDocumentRenderer :document="standalonePage.content" />
    </article>
    <PublicContentDetailRenderer
      v-else
      :schema="schema"
      :content="content"
      :fallback-title="doc?.title || doc?.id || id"
    />

    <template #fallback>
      <BuiltInLayoutRenderer>
        <UContainer v-if="standalonePage" class="py-8">
          <UPage>
            <UPageHeader :title="standalonePage.title || 'Untitled page'" />
            <UPageBody><PageDocumentRenderer :document="standalonePage.content" /></UPageBody>
          </UPage>
        </UContainer>
        <UContainer v-else class="py-10 sm:py-14">
          <PublicContentDetailRenderer :schema="schema" :content="content" :fallback-title="doc?.title || doc?.id || id" />
        </UContainer>
      </BuiltInLayoutRenderer>
    </template>
  </LayoutComposition>
</template>

<style scoped>
.layout-route-page-content { display: grid; gap: 2rem; width: 100%; }
.layout-route-page-content h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
</style>
