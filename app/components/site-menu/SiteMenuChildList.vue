<script setup lang="ts">
import type { MoveEvent, SortableEvent } from 'sortablejs'
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'

import type { SiteMenuChild, SiteMenuValidationIssue } from '~~/shared/site-menu'

const model = defineModel<SiteMenuChild[]>({ required: true })
const emit = defineEmits<{
  announce: [message: string]
  select: [itemId: string]
  remove: [removedId: string, nextId: string]
}>()
const props = defineProps<{
  pathPrefix: string
  parentItemId: string
  selectedId?: string
  validationIssues?: SiteMenuValidationIssue[]
}>()

const listRef = ref<HTMLOListElement | null>(null)
const dropTarget = ref<{ id: string, after: boolean } | null>(null)
const draggedLabel = ref('Child menu item')

function labelAt(index: number) {
  const item = model.value[index]
  return item ? siteMenuAuthoredItemLabel(item) : `Child item ${index + 1}`
}

function issueCount(index: number) {
  const prefix = `${props.pathPrefix}.${index}`
  return (props.validationIssues ?? []).filter(issue => issue.path === prefix || issue.path.startsWith(`${prefix}.`)).length
}

function immutableIdError(index: number) {
  return validationMessageForPath(props.validationIssues ?? [], `${props.pathPrefix}.${index}.id`)
}

function moveWithControls(index: number, direction: -1 | 1) {
  const next = index + direction
  if (next < 0 || next >= model.value.length) return
  const item = model.value[index]
  if (!item) return
  model.value = moveSiteMenuArrayItem(model.value, index, next)
  emit('announce', siteMenuMoveAnnouncement(siteMenuAuthoredItemLabel(item), next + 1, model.value.length, 'child'))
  nextTick(() => focusSiteMenuMoveControl(item.id, direction === -1 ? 'up' : 'down'))
}

function removeItem(index: number) {
  const nextFocusId = siteMenuRemovalFocusId(model.value, index)
  const [removed] = model.value.splice(index, 1)
  if (!removed) return
  emit('announce', `Removed ${siteMenuAuthoredItemLabel(removed)}.`)
  emit('remove', removed.id, nextFocusId ?? props.parentItemId)
  nextTick(() => focusAfterSiteMenuRemoval(nextFocusId, props.parentItemId))
}

function onMove(event: MoveEvent) {
  const related = event.related as HTMLElement
  const id = related.dataset.itemId
  if (!id) return true
  dropTarget.value = { id, after: Boolean(event.willInsertAfter) }
  const targetLabel = related.dataset.itemLabel || 'item'
  emit('announce', `Move ${draggedLabel.value} ${event.willInsertAfter ? 'after' : 'before'} ${targetLabel}.`)
  return true
}

useSortable(listRef, model, {
  watchElement: true,
  handle: '.hp-menu-child-drag-handle',
  draggable: '.hp-menu-child-sort-item',
  animation: 150,
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 3,
  ghostClass: 'opacity-35',
  chosenClass: 'ring-2',
  dragClass: 'shadow-lg',
  delayOnTouchOnly: true,
  delay: 150,
  touchStartThreshold: 3,
  onStart: (event: SortableEvent) => {
    draggedLabel.value = labelAt(event.oldIndex ?? 0)
  },
  onMove,
  onUpdate: (event: SortableEvent) => {
    if (event.oldIndex == null || event.newIndex == null) return
    const label = labelAt(event.oldIndex)
    moveArrayElement(model, event.oldIndex, event.newIndex, event)
    nextTick(() => emit('announce', siteMenuMoveAnnouncement(label, event.newIndex! + 1, model.value.length, 'child')))
  },
  onEnd: () => {
    dropTarget.value = null
  }
})
</script>

<template>
  <ol ref="listRef" class="space-y-2" aria-label="Child menu items">
    <li
      v-for="(item, index) in model"
      :key="item.id"
      :data-item-id="item.id"
      :data-item-label="siteMenuAuthoredItemLabel(item)"
      class="hp-menu-child-sort-item"
    >
      <div
        v-if="dropTarget?.id === item.id && !dropTarget.after"
        class="mb-1 h-0.5 rounded-full bg-primary"
        data-drop-indicator="before"
      />
      <div
        class="flex items-center gap-1 rounded-md border p-2"
        :class="selectedId === item.id ? 'border-primary bg-primary/5' : 'border-muted bg-elevated/30'"
        :data-validation-path="`${pathPrefix}.${index}.id`"
        :aria-invalid="Boolean(immutableIdError(index))"
        tabindex="-1"
      >
        <UButton
          type="button"
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          square
          class="hp-menu-child-drag-handle min-h-11 min-w-11 touch-none cursor-grab active:cursor-grabbing"
          :data-menu-row-focus="item.id"
          :aria-label="`Drag ${siteMenuAuthoredItemLabel(item) || `child item ${index + 1}`}`"
        />
        <button
          type="button"
          class="min-w-0 flex-1 rounded px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
          :data-menu-row-select="item.id"
          :aria-current="selectedId === item.id ? 'true' : undefined"
          @click="emit('select', item.id)"
        >
          <span class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-highlighted">{{ siteMenuAuthoredItemLabel(item) || `Child item ${index + 1}` }}</span>
            <UBadge v-if="issueCount(index)" color="error" variant="soft" size="sm">
              {{ issueCount(index) }}
            </UBadge>
          </span>
          <span class="block truncate text-xs text-muted">{{ siteMenuDestinationSummary(item) }}</span>
        </button>
        <UButton
          type="button"
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="ghost"
          square
          class="min-h-11 min-w-11"
          :data-menu-item-id="item.id"
          data-menu-move="up"
          :disabled="index === 0"
          :aria-label="`Move ${siteMenuAuthoredItemLabel(item) || `child item ${index + 1}`} up`"
          @click="moveWithControls(index, -1)"
        />
        <UButton
          type="button"
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="ghost"
          square
          class="min-h-11 min-w-11"
          :data-menu-item-id="item.id"
          data-menu-move="down"
          :disabled="index === model.length - 1"
          :aria-label="`Move ${siteMenuAuthoredItemLabel(item) || `child item ${index + 1}`} down`"
          @click="moveWithControls(index, 1)"
        />
        <UButton
          type="button"
          icon="i-lucide-x"
          color="error"
          variant="ghost"
          square
          class="min-h-11 min-w-11"
          :aria-label="`Remove ${siteMenuAuthoredItemLabel(item) || `child item ${index + 1}`}`"
          @click="removeItem(index)"
        />
      </div>
      <p v-if="immutableIdError(index)" class="mt-1 text-xs text-error">
        {{ immutableIdError(index) }}
      </p>
      <div
        v-if="dropTarget?.id === item.id && dropTarget.after"
        class="mt-1 h-0.5 rounded-full bg-primary"
        data-drop-indicator="after"
      />
    </li>
  </ol>
</template>
