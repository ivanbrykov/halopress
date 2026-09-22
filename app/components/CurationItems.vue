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
  field: string
  values?: string[] | string
  ownerId?: string
  limit?: number
  status?: string
  title?: string
  subtitle?: string
  linkBase?: string
  viewAllTo?: string
  viewAllLabel?: string
  refreshInterval?: number
}>(), {
  limit: 6,
  status: 'published',
  title: 'Curated',
  subtitle: 'Hand-picked items',
  viewAllLabel: 'View all',
  refreshInterval: 300000
})

const valueList = computed(() => {
  if (Array.isArray(props.values)) return props.values.map(v => String(v).trim()).filter(Boolean)
  if (typeof props.values === 'string') return props.values.split(',').map(v => v.trim()).filter(Boolean)
  return []
})

const canFetch = computed(() => Boolean(props.schema && props.field && (props.ownerId || valueList.value.length)))

const slots = useSlots()

const query = computed(() => {
  const base: Record<string, any> = {
    schema: props.schema,
    field: props.field,
    limit: props.limit,
    status: props.status
  }
  if (props.ownerId) base.ownerId = props.ownerId
  else if (valueList.value.length) base.values = valueList.value.join(',')
  return base
})

const key = computed(() => {
  const valuesKey = props.ownerId ? `owner:${props.ownerId}` : valueList.value.join('|')
  return `widget:curation:${props.schema}:${props.field}:${valuesKey}:${props.limit}:${props.status}`
})

const { data, pending, error, refresh } = await useAsyncData(
  key.value,
  async () => {
    if (!canFetch.value) return { items: [] as WidgetItem[] }
    return $fetch<{ items: WidgetItem[] }>('/api/widget/curation', { query: query.value })
  },
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
  field: props.field,
  ownerId: props.ownerId,
  values: valueList.value,
  canFetch: canFetch.value,
  status: props.status,
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
      <template v-if="!canFetch">
        <slot v-if="$slots.invalid" name="invalid" v-bind="slotProps" />
        <UAlert
          v-else
          title="Missing configuration"
          description="Provide values or an owner id to load curated items."
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
        />
      </template>

      <template v-else-if="pending && items.length === 0">
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
          title="No curated items"
          description="This collection is empty right now."
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
            <UAvatar
              :src="item.image || undefined"
              icon="i-lucide-image"
              size="lg"
              class="shrink-0"
            />
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
