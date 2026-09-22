<script setup lang="ts">
const route = useRoute()
const requestUrl = useRequestURL()
const { applyPublic } = usePublicPageDeliveryHeaders()
const robots = useResponseHeader('X-Robots-Tag')

function queryText(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : ''
}

const initialQuery = computed(() => queryText(route.query.q))
const operator = computed(() => route.query.operator === 'any' ? 'any' as const : 'all' as const)
const canonicalUrl = `${requestUrl.origin}/search`

applyPublic()
robots.value = 'noindex, follow'
useSeoMeta({
  title: 'Search',
  description: 'Search published content.',
  robots: 'noindex, follow',
  ogTitle: 'Search',
  ogDescription: 'Search published content.'
})
useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }]
})

async function updateQuery(query: string) {
  const nextQuery: Record<string, string> = {}
  if (query) nextQuery.q = query
  if (operator.value === 'any') nextQuery.operator = 'any'
  await navigateTo({ path: '/search', query: nextQuery })
}
</script>

<template>
  <UContainer class="py-10 sm:py-14">
    <UPage>
      <UPageBody>
        <PublicKeywordSearch
          :initial-query="initialQuery"
          :operator="operator"
          :auto-search="Boolean(initialQuery)"
          @submitted="updateQuery"
        />
      </UPageBody>
    </UPage>
  </UContainer>
</template>
