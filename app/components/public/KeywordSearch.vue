<script setup lang="ts">
import type { KeywordSearchFilter } from '~~/shared/keyword-search'

const props = withDefaults(defineProps<{
  initialQuery?: string
  schemaKeys?: string[]
  fieldIds?: string[]
  filters?: KeywordSearchFilter[]
  operator?: 'all' | 'any'
  autoSearch?: boolean
  title?: string
  description?: string
  headingTag?: 'h1' | 'h2' | 'h3'
}>(), {
  initialQuery: '',
  schemaKeys: () => [],
  fieldIds: () => [],
  filters: () => [],
  operator: 'all',
  autoSearch: false,
  title: 'Search',
  description: 'Find published content with Korean morphology and exact technical terms.',
  headingTag: 'h1'
})

const emit = defineEmits<{
  submitted: [query: string]
}>()

const input = ref(props.initialQuery)
const searchInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('searchInput')
const {
  status,
  mode,
  items,
  nextCursor,
  availability,
  fallback,
  error,
  pending,
  search,
  loadMore,
  retry,
  clear
} = useKeywordSearch()

const hasSubmitted = ref(Boolean(props.autoSearch && props.initialQuery.trim()))
const isInitialLoading = computed(() =>
  hasSubmitted.value
  && items.value.length === 0
  && ['loading-capabilities', 'initializing-analyzer', 'searching'].includes(status.value)
)
const resultSummary = computed(() => {
  if (status.value !== 'ready') return ''
  return items.value.length
    ? `${items.value.length} result${items.value.length === 1 ? '' : 's'} shown`
    : 'No results found'
})
const statusAnnouncement = computed(() => {
  if (status.value === 'loading-capabilities') return 'Checking search availability.'
  if (status.value === 'initializing-analyzer') return 'Preparing the Korean search analyzer.'
  if (status.value === 'searching') return 'Searching published content.'
  if (status.value === 'unavailable') return 'Search is unavailable.'
  if (status.value === 'error') return errorMessage.value
  if (status.value === 'ready' && availability.value === 'partial') {
    return `${resultSummary.value}. Results may be incomplete while indexing continues.`
  }
  return resultSummary.value
})
const errorMessage = computed(() => {
  if (!error.value) return ''
  if (error.value.code === 'rate_limited') return 'Search is busy. Wait a moment, then try again.'
  if (error.value.code === 'generation_mismatch') {
    return 'The search index was updated. Retry to use the latest version.'
  }
  if (error.value.code === 'analyzer_unavailable') {
    return 'The Korean search analyzer could not be loaded. Check your connection and retry.'
  }
  if (error.value.code === 'query_too_large' || error.value.code === 'invalid_request') {
    return 'Use a shorter search phrase and try again.'
  }
  return error.value.message || 'Search could not be completed.'
})

function currentInput() {
  return {
    query: input.value,
    operator: props.operator,
    schemaKeys: props.schemaKeys,
    fieldIds: props.fieldIds,
    filters: props.filters
  }
}

async function submit(options: { updateUrl?: boolean } = {}) {
  const query = input.value.normalize('NFC').replace(/\s+/gu, ' ').trim()
  input.value = query
  if (options.updateUrl !== false) emit('submitted', query)
  if (!query) {
    hasSubmitted.value = false
    clear()
    return
  }
  hasSubmitted.value = true
  await search(currentInput())
}

async function retrySearch() {
  await retry()
  if (status.value === 'error') {
    await nextTick()
    searchInput.value?.inputRef?.focus()
  }
}

watch(() => props.initialQuery, (value) => {
  if (value === input.value) return
  input.value = value
  if (props.autoSearch && value.trim()) void submit({ updateUrl: false })
  else clear()
})

watch(() => JSON.stringify([
  props.schemaKeys,
  props.fieldIds,
  props.filters,
  props.operator
]), () => {
  if (props.autoSearch && input.value.trim()) void submit({ updateUrl: false })
})

onMounted(() => {
  if (props.autoSearch && input.value.trim()) {
    void submit({ updateUrl: false })
  }
})
</script>

<template>
  <section class="space-y-6" aria-labelledby="keyword-search-title">
    <header class="space-y-2">
      <component
        :is="headingTag"
        id="keyword-search-title"
        class="text-3xl font-bold tracking-tight text-highlighted sm:text-4xl"
      >
        {{ title }}
      </component>
      <p class="max-w-2xl text-muted">
        {{ description }}
      </p>
    </header>

    <form class="flex flex-col gap-3 sm:flex-row" role="search" @submit.prevent="submit()">
      <label for="keyword-search-input" class="sr-only">Search published content</label>
      <UInput
        ref="searchInput"
        id="keyword-search-input"
        v-model="input"
        type="search"
        name="q"
        icon="i-lucide-search"
        placeholder="Search published content"
        autocomplete="off"
        enterkeyhint="search"
        :maxlength="512"
        :loading="pending"
        :aria-describedby="resultSummary ? 'keyword-search-status' : undefined"
        size="xl"
        class="min-w-0 flex-1"
      />
      <UButton
        type="submit"
        size="xl"
        icon="i-lucide-search"
        :loading="pending"
        :disabled="!input.trim()"
      >
        Search
      </UButton>
    </form>

    <p id="keyword-search-status" class="sr-only" aria-live="polite" aria-atomic="true">
      {{ statusAnnouncement }}
    </p>

    <UAlert
      v-if="fallback"
      color="info"
      variant="subtle"
      icon="i-lucide-monitor-down"
      title="Using browser search"
      description="The search service was unavailable, so this browser analyzed the query locally."
    />

    <UAlert
      v-if="availability === 'partial'"
      color="warning"
      variant="subtle"
      icon="i-lucide-clock-3"
      title="Results may be incomplete"
      description="Some published content is still being indexed. You can continue using the available results."
    />

    <div v-if="status === 'error'" class="space-y-3">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Search failed"
        :description="errorMessage"
      />
      <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="retrySearch">
        Retry
      </UButton>
    </div>

    <UAlert
      v-else-if="status === 'unavailable'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-search-x"
      title="Search is unavailable"
      description="No searchable published fields are ready yet. Please check again later."
    />

    <div v-else-if="isInitialLoading" class="space-y-4" aria-hidden="true">
      <UProgress v-if="status === 'initializing-analyzer'" animation="carousel" />
      <USkeleton v-for="index in 3" :key="index" class="h-32 w-full rounded-lg" />
    </div>

    <UEmpty
      v-else-if="status === 'ready' && items.length === 0"
      icon="i-lucide-file-search"
      title="No results"
      description="Try a different phrase or fewer terms."
    />

    <UEmpty
      v-else-if="!hasSubmitted"
      icon="i-lucide-search"
      title="Search published content"
      description="Enter a phrase above to search titles and configured full-text fields."
      variant="naked"
    />

    <div v-if="items.length" class="space-y-4">
      <div class="grid gap-4">
        <UPageCard
          v-for="item in items"
          :key="`${item.schemaKey}:${item.id}`"
          :to="item.to"
          :title="item.title || item.id"
          :description="item.description || undefined"
          orientation="horizontal"
          variant="outline"
          class="group"
        >
          <template #leading>
            <UAvatar
              :src="item.image || undefined"
              icon="i-lucide-file-text"
              size="xl"
              class="rounded-md"
            />
          </template>
          <template #footer>
            <div class="flex items-center gap-2 text-xs text-muted">
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ item.schemaKey }}
              </UBadge>
              <span class="truncate">{{ item.to }}</span>
            </div>
          </template>
        </UPageCard>
      </div>

      <div v-if="nextCursor" class="flex justify-center pt-2">
        <UButton
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-chevron-down"
          :loading="pending"
          @click="loadMore"
        >
          Load more
        </UButton>
      </div>
    </div>

    <p v-if="mode" class="text-center text-xs text-dimmed">
      Search mode: {{ fallback ? 'browser fallback' : mode }}
    </p>
  </section>
</template>
