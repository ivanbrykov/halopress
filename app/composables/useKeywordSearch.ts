import {
  createKeywordSearchClient,
  type KeywordSearchClientState,
  type KeywordSearchInput
} from '~~/shared/keyword-search-client'

export function useKeywordSearch() {
  const client = createKeywordSearchClient({
    loadBrowserTokenizer: async () => {
      if (import.meta.server) throw new Error('Browser search analyzer requires a browser')
      const { createBrowserTokenizer } = await import('@halopress/korean-search-tokenizer/browser')
      return createBrowserTokenizer()
    }
  })
  const state = shallowRef<KeywordSearchClientState>(client.state)
  const unsubscribe = client.subscribe((value) => {
    state.value = value
  })

  onMounted(() => {
    void client.loadCapabilities().catch(() => undefined)
  })
  onScopeDispose(() => {
    unsubscribe()
    client.dispose()
  })

  const pending = computed(() => [
    'loading-capabilities',
    'initializing-analyzer',
    'searching'
  ].includes(state.value.status))

  return {
    state: readonly(state),
    status: computed(() => state.value.status),
    mode: computed(() => state.value.mode),
    query: computed(() => state.value.query),
    items: computed(() => state.value.items),
    nextCursor: computed(() => state.value.nextCursor),
    availability: computed(() => state.value.availability),
    fallback: computed(() => state.value.fallback),
    error: computed(() => state.value.error),
    pending,
    search: (input: KeywordSearchInput) => client.search(input),
    loadMore: () => client.loadMore(),
    retry: () => client.retry(),
    clear: () => client.clear()
  }
}
