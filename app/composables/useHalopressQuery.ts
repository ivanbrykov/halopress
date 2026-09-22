import { computed, unref } from 'vue'
import type { MaybeRef } from 'vue'

export type HalopressItem = {
  id: string
  publicPath?: string | null
  schemaKey: string
  schemaVersion: number
  title: string | null
  description: string | null
  image: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type HalopressQueryOptions = {
  cursor?: MaybeRef<string | number | null>
  pageSize?: MaybeRef<number>
  order?: MaybeRef<'asc' | 'desc'>
  status?: MaybeRef<string | null>
  respectStandalonePageClaims?: MaybeRef<boolean>
}

type HalopressQueryResponse = {
  items: Array<HalopressItem & { assetId?: string | null }>
  nextCursor: string | null
}

export async function useHalopressQuery(schemaKey: MaybeRef<string>, options: HalopressQueryOptions = {}) {
  const schemaKeyValue = computed(() => {
    const raw = unref(schemaKey)
    return raw == null ? '' : String(raw)
  })
  const query = computed(() => ({
    cursor: unref(options.cursor) ?? undefined,
    pageSize: unref(options.pageSize) ?? undefined,
    order: unref(options.order) ?? undefined,
    status: unref(options.status) ?? undefined,
    routeScope: unref(options.respectStandalonePageClaims) ? 'public-page' : undefined
  }))

  const { data, refresh, pending, error } = await useFetch<HalopressQueryResponse>(
    () => `/api/content/${schemaKeyValue.value}`,
    { query }
  )

  const items = computed(() => data.value?.items ?? [])
  const nextCursor = computed(() => data.value?.nextCursor ?? null)
  const hasNext = computed(() => Boolean(nextCursor.value))
  const hasPrev = computed(() => Boolean(unref(options.cursor)))

  return {
    items,
    nextCursor,
    hasPrev,
    hasNext,
    reload: refresh,
    pending,
    error
  }
}
