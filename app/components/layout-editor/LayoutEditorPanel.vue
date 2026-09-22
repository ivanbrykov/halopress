<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

import type {
  LayoutDocument,
  LayoutElement,
  LayoutElementDescriptor,
  LayoutElementType,
  LayoutRegionKey
} from '~~/shared/site-layout'
import type { SiteMenuAdminResource } from '~~/shared/site-menu'
import LayoutInspector from '~/components/layout-editor/LayoutInspector.vue'

const props = defineProps<{
  document: LayoutDocument
  descriptors: LayoutElementDescriptor[]
  selectedRegionId: LayoutRegionKey
  selectedElementId?: string
  menuSets: SiteMenuAdminResource[]
  menuPending: boolean
}>()
const emit = defineEmits<{
  requestAdd: [type: LayoutElementType]
  paletteDragstart: [event: DragEvent, type: LayoutElementType]
  updateDocument: [document: LayoutDocument]
  updateElement: [elementId: string, props: any]
  selectRegion: [regionId: LayoutRegionKey]
  moveElement: [elementId: string, regionId: LayoutRegionKey, index: number, direction?: 'up' | 'down']
  duplicateElement: [elementId: string]
  removeElement: [elementId: string]
}>()

const activeTab = defineModel<'elements' | 'inspector'>('activeTab', { default: 'elements' })
const tabs: TabsItem[] = [
  { label: 'Elements', value: 'elements', slot: 'elements' },
  { label: 'Inspector', value: 'inspector', slot: 'inspector' }
]

function alreadyRequired(descriptor: LayoutElementDescriptor) {
  return descriptor.required && props.document.elements.some(element => element.type === descriptor.type)
}

function unavailable(descriptor: LayoutElementDescriptor) {
  return alreadyRequired(descriptor) || allowedLayoutRegions(props.document, descriptor.type).length === 0
}

function forwardElementUpdate(elementId: string, elementProps: LayoutElement['props']) {
  emit('updateElement', elementId, elementProps)
}

function forwardElementMove(
  elementId: string,
  regionId: LayoutRegionKey,
  index: number,
  direction?: 'up' | 'down'
) {
  emit('moveElement', elementId, regionId, index, direction)
}
</script>

<template>
  <UTabs
    v-model="activeTab"
    :items="tabs"
    class="flex h-full min-h-0 flex-1 flex-col"
    :ui="{
      root: 'gap-0',
      list: 'min-h-12 shrink-0 rounded-none border-b border-muted',
      trigger: 'min-h-10',
      content: 'min-h-0 flex-1 overflow-hidden rounded-none p-0'
    }"
    data-layout-editor-panel
  >
    <template #elements>
      <div class="h-full min-h-0 overflow-y-auto p-4" data-layout-elements-panel>
        <div class="mb-4">
          <h3 class="font-semibold text-highlighted">Element palette</h3>
          <p class="text-sm text-muted">Click for a focused picker, or drag a safe default into an explicit region.</p>
        </div>
        <ul class="space-y-2">
          <li
            v-for="descriptor in descriptors"
            :key="descriptor.type"
            class="rounded-md border border-default p-3"
            :draggable="!unavailable(descriptor)"
            :data-layout-palette="descriptor.type"
            @dragstart="emit('paletteDragstart', $event, descriptor.type)"
          >
            <div class="flex items-start gap-3">
              <UIcon :name="descriptor.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-highlighted">{{ descriptor.label }}</p>
                <p class="text-xs text-muted">{{ descriptor.summary }}</p>
              </div>
              <UButton
                type="button"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="unavailable(descriptor)"
                :aria-label="`Add ${descriptor.label}`"
                @click="emit('requestAdd', descriptor.type)"
              />
            </div>
            <p v-if="alreadyRequired(descriptor)" class="mt-2 text-xs text-muted">Required element already present.</p>
            <p v-else-if="!allowedLayoutRegions(document, descriptor.type).length" class="mt-2 text-xs text-warning">No compatible region in this preset.</p>
          </li>
        </ul>
      </div>
    </template>

    <template #inspector>
      <LayoutInspector
        :document="document"
        :selected-region-id="selectedRegionId"
        :selected-element-id="selectedElementId"
        :menu-sets="menuSets"
        :menu-pending="menuPending"
        @update-document="emit('updateDocument', $event)"
        @update-element="forwardElementUpdate"
        @select-region="emit('selectRegion', $event)"
        @move-element="forwardElementMove"
        @duplicate-element="emit('duplicateElement', $event)"
        @remove-element="emit('removeElement', $event)"
      />
    </template>
  </UTabs>
</template>
