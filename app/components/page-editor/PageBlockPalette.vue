<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { pagePatternRegistry } from '~~/shared/page-patterns'

import { pageBlockLibraryClassification, pageBlockRegistry } from '~/editor/page/registry'
import type { PagePaletteItem } from '~/editor/page/palette'

const props = withDefaults(defineProps<{
  editable?: boolean
}>(), {
  editable: true
})

const emit = defineEmits<{
  insert: [item: PagePaletteItem]
  dragstart: [event: DragEvent, item: PagePaletteItem]
}>()

const entries = computed(() => [
  ...pagePatternRegistry.patterns.map(item => ({ ...item, source: 'pattern' as const })),
  ...pageBlockRegistry.components
    .filter(item => pageBlockLibraryClassification[item.key].showDirectly)
    .map(item => ({ ...item, model: 'configured-block' as const, source: 'block' as const }))
])

const paletteGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const categories = [...new Set(entries.value.map(item => item.category))]
  return categories.map(category => ({
    id: category.toLowerCase(),
    label: category,
    items: entries.value
      .filter(item => item.category === category)
      .map(item => ({
        value: `${item.model}:${item.key}`,
        model: item.model,
        source: item.source,
        entryKey: item.key,
        label: item.label,
        description: item.summary,
        summary: item.summary,
        category: item.category,
        keywords: item.keywords,
        icon: item.icon,
        disabled: !props.editable,
        onSelect: () => emit('insert', { model: item.model, source: item.source, key: item.key } as PagePaletteItem)
      } as CommandPaletteItem))
  }))
})

function paletteItem(item: CommandPaletteItem) {
  return {
    model: (item as any).model,
    source: (item as any).source,
    key: (item as any).entryKey
  } as PagePaletteItem
}

function modelLabel(item: CommandPaletteItem) {
  if ((item as any).model === 'editable-unit') return 'Editable unit'
  if ((item as any).model === 'document-pattern') return 'Editable pattern'
  return 'Configured block'
}

const fuse = {
  fuseOptions: {
    ignoreLocation: true,
    threshold: 0.2,
    keys: ['label', 'summary', 'category', 'keywords']
  },
  resultLimit: 24,
  matchAllWhenSearchEmpty: true
}
</script>

<template>
  <section aria-label="Block Library" class="flex h-full min-h-0 flex-col">
    <UCommandPalette
      :groups="paletteGroups"
      :fuse="fuse"
      :autofocus="false"
      placeholder="Search blocks..."
      class="min-h-0 flex-1"
      :ui="{
        content: 'min-h-0',
        viewport: 'p-2',
        group: 'space-y-1',
        item: 'p-0'
      }"
    >
      <template #item="{ item }">
        <div
          class="flex w-full items-start gap-3 rounded-md p-2"
          :draggable="editable"
          :data-page-library-model="item.model"
          :data-page-library-source="item.source"
          :data-page-library-key="item.entryKey"
          @dragstart="emit('dragstart', $event, paletteItem(item))"
        >
          <UIcon :name="item.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
          <span class="min-w-0 text-left">
            <span class="block text-sm font-medium text-highlighted">{{ item.label }}</span>
            <UBadge :label="modelLabel(item)" color="neutral" variant="subtle" size="xs" class="mt-1" />
            <span class="mt-0.5 block text-xs text-muted">{{ item.description }}</span>
          </span>
        </div>
      </template>
    </UCommandPalette>
  </section>
</template>
