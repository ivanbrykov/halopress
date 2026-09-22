<script setup lang="ts">
type WidgetItem = {
  id: string
  publicPath: string | null
  schemaKey: string
  schemaVersion: number
  title: string | null
  description: string | null
  image: string | null
  status: string
  createdAt: string
  updatedAt: string
}

const props = withDefaults(defineProps<{
  schema: string
  limit?: number
  status?: string
  sort?: string
  title?: string
  subtitle?: string
  linkBase?: string
  viewAllTo?: string
  viewAllLabel?: string
  refreshInterval?: number
}>(), {
  limit: 6,
  status: 'published',
  sort: '-created',
  title: 'Latest',
  subtitle: 'Recently updated',
  viewAllLabel: 'View all',
  refreshInterval: 60000
})

const slots = useSlots()

const query = computed(() => ({
  schema: props.schema,
  limit: props.limit,
  status: props.status,
  sort: props.sort
}))

const key = computed(() => `widget:recent:${props.schema}:${props.limit}:${props.status}:${props.sort}`)

const { data, pending, error, refresh } = await useAsyncData(
  key.value,
  () => $fetch<{ items: WidgetItem[] }>('/api/widget/recent', { query: query.value }),
  { default: () => ({ items: [] }) }
)

const items = computed(() => data.value?.items ?? [])
const skeletonCount = computed(() => Math.min(props.limit, 6))
const basePath = computed(() => props.linkBase || `/${props.schema}`)
const linkFor = (item: WidgetItem) => item.publicPath || `${basePath.value}/${item.id}`
const slotProps = computed(() => ({
  items: items.value,
  pending: pending.value,
  error: error.value,
  refresh,
  schema: props.schema,
  status: props.status,
  sort: props.sort,
  title: props.title,
  subtitle: props.subtitle,
  viewAllTo: props.viewAllTo,
  viewAllLabel: props.viewAllLabel,
  linkBase: basePath.value
}))
const renderList = computed(() => Boolean(slots.items || slots.item || !slots.default))

watch(query, () => refresh(), { deep: true })

onMounted(() => {
  if (!props.refreshInterval || props.refreshInterval <= 0) return
  const interval = window.setInterval(() => refresh(), props.refreshInterval)
  const onVisible = () => {
    if (!document.hidden) refresh()
  }
  const onOnline = () => refresh()
  window.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  onBeforeUnmount(() => {
    window.clearInterval(interval)
    window.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  })
})
</script>

<template>
  <div class="space-y-3">
    <slot v-if="$slots.default" name="default" v-bind="slotProps" />

    <template v-if="renderList">
      <template v-if="pending && items.length === 0">
        <slot
          v-if="$slots.loading"
          name="loading"
          :count="skeletonCount"
          v-bind="slotProps"
        />
        <div v-else class="space-y-3">
          <div v-for="n in skeletonCount" :key="n" class="flex items-center gap-3">
            <USkeleton class="h-12 w-12 rounded-md" />
            <div class="flex-1 space-y-2">
              <USkeleton class="h-4 w-2/3" />
              <USkeleton class="h-3 w-1/2" />
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="error">
        <slot v-if="$slots.error" name="error" v-bind="slotProps" />
        <UAlert
          v-else
          title="Unable to load"
          description="Please try again in a moment."
          icon="i-lucide-alert-circle"
          color="neutral"
          variant="subtle"
        />
      </template>

      <template v-else-if="items.length === 0">
        <slot v-if="$slots.empty" name="empty" v-bind="slotProps" />
        <UAlert
          v-else
          title="No items yet"
          description="New content will appear here."
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
        />
      </template>

      <template v-else>
        <slot v-if="$slots.items" name="items" v-bind="slotProps" />
        <div v-else class="space-y-3">
          <template v-if="$slots.item">
            <slot
              v-for="item in items"
              :key="item.id"
              name="item"
              v-bind="{ ...item, item, href: linkFor(item) }"
            />
          </template>
          <NuxtLink
            v-else
            v-for="item in items"
            :key="item.id"
            :to="linkFor(item)"
            class="group flex items-center gap-3 rounded-md border border-default px-3 py-2 transition hover:bg-elevated/60"
          >
            <UAvatar :src="item.image || undefined" icon="i-lucide-image" size="lg" class="shrink-0 rounded-md" />
            <div class="min-w-0">
              <div class="text-sm font-medium text-highlighted truncate group-hover:underline">
                {{ item.title || item.id }}
              </div>
              <p v-if="item.description" class="text-xs text-muted line-clamp-2">
                {{ item.description }}
              </p>
            </div>
          </NuxtLink>
        </div>
      </template>
    </template>
  </div>
</template>
