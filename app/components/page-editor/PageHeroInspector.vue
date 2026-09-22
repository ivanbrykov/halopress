<script setup lang="ts">
import type { PageHeroAttrs } from '~~/shared/page-hero'

const props = withDefaults(defineProps<{
  attrs: PageHeroAttrs
  editable?: boolean
}>(), {
  editable: true
})

const emit = defineEmits<{
  update: [attrs: Partial<PageHeroAttrs>]
}>()

const orientationItems = [
  { label: 'Centered', value: 'vertical' },
  { label: 'Split', value: 'horizontal' }
]
</script>

<template>
  <div class="space-y-5 overflow-y-auto p-4">
    <div>
      <h2 class="text-sm font-semibold text-highlighted">Editable Hero</h2>
      <p class="mt-1 text-xs text-muted">
        Edit the headline, copy, links, and image directly on the canvas. Only the grouping controls live here.
      </p>
    </div>

    <UFormField label="Layout">
      <USelect
        :model-value="props.attrs.orientation"
        :items="orientationItems"
        value-key="value"
        class="w-full"
        :disabled="!editable"
        @update:model-value="emit('update', { orientation: $event as PageHeroAttrs['orientation'] })"
      />
    </UFormField>

    <USwitch
      :model-value="props.attrs.reverse"
      label="Reverse media order"
      description="Place an inserted image before the text on wide screens."
      :disabled="!editable || props.attrs.orientation !== 'horizontal'"
      @update:model-value="emit('update', { reverse: $event })"
    />
  </div>
</template>
