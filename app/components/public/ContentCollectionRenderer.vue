<script setup lang="ts">
const props = defineProps<{ items: any[]; schemaKey: string; template?: 'list' | 'cards' | 'catalog-grid' }>()
const layoutClass = computed(() => props.template === 'list'
  ? 'divide-y divide-default rounded-xl border border-default'
  : props.template === 'catalog-grid'
    ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3'
    : 'grid gap-5 md:grid-cols-2')
</script>

<template>
  <div v-if="items.length" :class="layoutClass">
    <NuxtLink
      v-for="item in items"
      :key="item.id"
      :to="item.publicPath || `/${schemaKey}/${item.id}`"
      class="group block overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="template === 'list' ? 'flex items-center gap-4 p-4' : 'rounded-xl border border-default bg-default'"
    >
      <div v-if="template !== 'list'" class="aspect-[4/3] overflow-hidden bg-elevated">
        <AssetImage v-if="item.image" :src="item.image" :alt="item.title || ''" preset="card" sizes="(max-width: 640px) 100vw, 50vw" class="h-full w-full object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transition-none" />
        <div v-else class="flex h-full items-center justify-center" aria-hidden="true"><UIcon name="i-lucide-image" class="size-10 text-dimmed" /></div>
      </div>
      <div class="min-w-0 p-4" :class="template === 'list' ? 'p-0' : ''">
        <h2 class="text-lg font-semibold text-highlighted group-hover:text-primary">{{ item.title || 'Untitled' }}</h2>
        <p v-if="item.description" class="mt-1 line-clamp-3 text-sm text-muted">{{ item.description }}</p>
        <p v-else class="mt-1 text-sm text-dimmed">Open published entry</p>
      </div>
    </NuxtLink>
  </div>
  <UAlert v-else title="Nothing published" description="Published entries will appear here." icon="i-lucide-info" variant="subtle" />
</template>
