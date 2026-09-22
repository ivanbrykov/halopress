<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { PUBLIC_PAGE_ROUTE_PREFIX, publicPathFromDecodedSegments, publicPathToHref } from '~~/shared/public-routing'
import {
  collectionKeywordFilterFields,
  collectionKeywordFilters
} from '~~/shared/collection-keyword-search'
import { resolveSchemaPresentation } from '~/utils/schema-presentation'
import BuiltInLayoutRenderer from '~/components/layout-renderer/BuiltInLayoutRenderer.vue'
import LayoutComposition from '~/components/layout-renderer/LayoutComposition.vue'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const { applyPublic, applyPrivateNoindex } = usePublicPageDeliveryHeaders()
let requestedPath = ''
try {
  requestedPath = publicPathFromDecodedSegments([String(route.params.schema)])
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
if (!isAlias && !['schema', 'page'].includes(resolvedRoute.documentKind)) {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const schemaKey = computed(() => String(resolvedRoute.documentId))

const standalonePage = ref<any>(null)
if (!isAlias && resolvedRoute?.documentKind === 'page') {
  const { data, error } = await useFetch<any>(
    () => `/api/delivery/page/${resolvedRoute.documentId}`,
    { query: { rendering: '0' } }
  )
  if (error.value || !data.value) {
    applyPrivateNoindex()
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  standalonePage.value = data.value
}

const schema = ref<any>(null)
if (!isAlias && !standalonePage.value) {
  const result = await useFetch<any>(() => `/api/schema/${schemaKey.value}/active`)
  if (result.error.value || !result.data.value) {
    applyPrivateNoindex()
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  schema.value = result.data.value
}
const pageSize = computed(() => {
  const raw = Number(route.query.pageSize ?? 20)
  if (!Number.isFinite(raw)) return 20
  return Math.min(Math.max(raw, 1), 50)
})
const order = computed(() => (route.query.order === 'asc' ? 'asc' : 'desc'))
const cursor = computed(() => (typeof route.query.cursor === 'string' && route.query.cursor.length ? route.query.cursor : null))
const keywordQuery = computed(() => {
  const value = Array.isArray(route.query.q) ? route.query.q[0] : route.query.q
  return typeof value === 'string' ? value : ''
})
const collectionFilterFields = computed(() =>
  collectionKeywordFilterFields(schema.value?.registry?.fields ?? [])
)
const keywordFilters = computed(() =>
  collectionKeywordFilters(
    collectionFilterFields.value,
    route.query as Record<string, unknown>
  )
)

let queryResult: Awaited<ReturnType<typeof useHalopressQuery>> | null = null
if (!isAlias && !standalonePage.value) {
  queryResult = await useHalopressQuery(schemaKey, {
    status: 'published',
    pageSize,
    order,
    cursor,
    respectStandalonePageClaims: computed(() => schemaKey.value === PUBLIC_PAGE_ROUTE_PREFIX)
  })
}
const items = computed(() => queryResult?.items.value ?? [])
const nextCursor = computed(() => queryResult?.nextCursor.value ?? null)
const contentError = computed(() => queryResult?.error.value ?? null)
if (contentError.value) {
  applyPrivateNoindex()
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const itemLinks = computed(() =>
  items.value.map((item: any) => ({
    label: item.title || item.id,
    to: item.publicPath || `/${schemaKey.value}/${item.id}`,
    icon: 'i-lucide-file-text'
  }))
)
const presentation = computed(() => resolveSchemaPresentation(schema.value?.registry))

const cursorStack = ref<string[]>([])
const hasPrev = computed(() => cursorStack.value.length > 0 || Boolean(cursor.value))
const hasNext = computed(() => Boolean(nextCursor.value))

const heroDescription = computed(() => {
  const count = items.value.length
  return schema.value?.ast?.description || `${count} published ${count === 1 ? 'entry' : 'entries'}`
})
if (!isAlias) {
  applyPublic()
  usePublicRouteSeo(computed(() => resolvedRoute?.seo))
}

const heroLinks = [
  { label: 'Back to Schemas', to: '/', variant: 'outline' },
  { label: 'Open Desk', to: '/_desk', color: 'primary' }
] satisfies ButtonProps[]

function normalizeQuery(overrides: Record<string, string | number | undefined | null>) {
  const next = { ...route.query, ...overrides } as Record<string, any>
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null || value === '') delete next[key]
  }
  return next
}

function goNext() {
  if (!nextCursor.value) return
  cursorStack.value.push(cursor.value ?? '')
  router.replace({ query: normalizeQuery({ cursor: nextCursor.value, pageSize: pageSize.value, order: order.value }) })
}

function goPrev() {
  const prev = cursorStack.value.pop()
  if (prev !== undefined) {
    router.replace({ query: normalizeQuery({ cursor: prev || undefined, pageSize: pageSize.value, order: order.value }) })
    return
  }
  if (cursor.value) {
    router.replace({ query: normalizeQuery({ cursor: undefined, pageSize: pageSize.value, order: order.value }) })
  }
}

async function updateKeywordQuery(query: string) {
  await navigateTo({
    path: route.path,
    query: normalizeQuery({
      q: query || undefined,
      cursor: undefined
    })
  })
}
</script>

<template>
  <LayoutComposition v-if="resolvedRoute?.layout" :projection="resolvedRoute.layout">
    <article v-if="standalonePage" class="layout-route-page-content">
      <header><h1>{{ standalonePage.title || 'Untitled page' }}</h1></header>
      <PageDocumentRenderer :document="standalonePage.content" />
    </article>

    <section v-else class="layout-route-collection">
      <header>
        <p class="layout-route-eyebrow">Collection</p>
        <h1>{{ schema?.title || schemaKey }}</h1>
        <p>{{ heroDescription }}</p>
      </header>
      <div>
        <h2>Published entries</h2>
        <p>Recently published content for this schema.</p>
      </div>
      <PublicKeywordSearch
        :initial-query="keywordQuery"
        :schema-keys="[schemaKey]"
        :filters="keywordFilters"
        :auto-search="Boolean(keywordQuery)"
        title="Search this collection"
        description="Search this collection and combine the keyword with filterable field parameters in the URL."
        heading-tag="h2"
        @submitted="updateKeywordQuery"
      />
      <PublicContentCollectionRenderer
        v-if="!keywordQuery"
        :items="items"
        :schema-key="schemaKey"
        :template="presentation.collectionTemplate"
      />
      <nav v-if="!keywordQuery" class="layout-route-pagination" aria-label="Collection pages">
        <UButton icon="i-lucide-arrow-left" variant="outline" color="neutral" :disabled="!hasPrev" @click="goPrev">Previous</UButton>
        <UButton trailing-icon="i-lucide-arrow-right" :disabled="!hasNext" @click="goNext">Next</UButton>
      </nav>
    </section>

    <template #fallback>
      <BuiltInLayoutRenderer>
        <UContainer v-if="standalonePage" class="py-8">
          <UPage>
            <UPageHeader :title="standalonePage.title || 'Untitled page'" />
            <UPageBody><PageDocumentRenderer :document="standalonePage.content" /></UPageBody>
          </UPage>
        </UContainer>

        <UContainer v-else>
          <UPage class="space-y-8">
            <template #left>
              <UPageAside>
                <UPageLinks title="Entries" :links="itemLinks" />
                <UAlert v-if="itemLinks.length === 0" title="No entries yet" description="Publish your first entry in Desk." icon="i-lucide-info" variant="subtle" class="mt-4" />
              </UPageAside>
            </template>
            <template #right />
            <UPageBody>
              <UPageHero headline="Collection" :title="schema?.title || schemaKey" :description="heroDescription" :links="heroLinks" />
              <UPageSection title="Search this collection" description="Use q with any configured filterable field parameters.">
                <PublicKeywordSearch
                  :initial-query="keywordQuery"
                  :schema-keys="[schemaKey]"
                  :filters="keywordFilters"
                  :auto-search="Boolean(keywordQuery)"
                  title="Search this collection"
                  description="Search this collection and combine the keyword with filterable field parameters in the URL."
                  heading-tag="h3"
                  @submitted="updateKeywordQuery"
                />
              </UPageSection>
              <UPageSection v-if="!keywordQuery" title="Published entries" description="Recently published content for this schema.">
                <PublicContentCollectionRenderer :items="items" :schema-key="schemaKey" :template="presentation.collectionTemplate" />
                <div class="mt-8 flex items-center justify-between">
                  <UButton icon="i-lucide-arrow-left" variant="outline" color="neutral" :disabled="!hasPrev" @click="goPrev">Previous</UButton>
                  <UButton trailing-icon="i-lucide-arrow-right" :disabled="!hasNext" @click="goNext">Next</UButton>
                </div>
              </UPageSection>
            </UPageBody>
          </UPage>
        </UContainer>
      </BuiltInLayoutRenderer>
    </template>
  </LayoutComposition>
</template>

<style scoped>
.layout-route-page-content, .layout-route-collection { display: grid; gap: 2rem; width: 100%; }
.layout-route-page-content h1, .layout-route-collection h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
.layout-route-collection h2 { font-size: 1.5rem; font-weight: 650; }
.layout-route-eyebrow { color: var(--halo-site-color-primary); font-weight: 650; }
.layout-route-pagination { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
</style>
