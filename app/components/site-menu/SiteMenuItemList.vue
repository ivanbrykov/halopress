<script setup lang="ts">
import type { MoveEvent, SortableEvent } from 'sortablejs'
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'

import {
  SITE_MENU_MAX_CHILDREN,
  isSiteMenuStaticItem,
  type SiteMenuChild,
  type SiteMenuItem,
  type SiteMenuSourceOptionsResponse,
  type SiteMenuValidationIssue
} from '~~/shared/site-menu'

const model = defineModel<SiteMenuItem[]>({ required: true })
const emit = defineEmits<{
  announce: [message: string]
  createChild: [parentId: string, draft: SiteMenuChild, resourceId: string]
  select: [itemId: string]
  remove: [removedId: string, nextId?: string]
}>()
const props = defineProps<{
  resourceId: string
  selectedId?: string
  validationIssues?: SiteMenuValidationIssue[]
  wideCreateOverlay: boolean
  dynamicSourceCount: number
  sourceOptions?: SiteMenuSourceOptionsResponse | null
  sourceOptionsPending?: boolean
  sourceOptionsError?: boolean
}>()

const listRef = ref<HTMLOListElement | null>(null)
const dropTarget = ref<{ id: string, after: boolean } | null>(null)
const draggedLabel = ref('Menu item')

function labelAt(index: number) {
  const item = model.value[index]
  return item ? siteMenuAuthoredItemLabel(item) : `Item ${index + 1}`
}

function issueCount(index: number) {
  const prefix = `document.items.${index}`
  return (props.validationIssues ?? []).filter(issue => issue.path === prefix || issue.path.startsWith(`${prefix}.`)).length
}

function immutableIdError(index: number) {
  return validationMessageForPath(props.validationIssues ?? [], `document.items.${index}.id`)
}

function moveWithControls(index: number, direction: -1 | 1) {
  const next = index + direction
  if (next < 0 || next >= model.value.length) return
  const item = model.value[index]
  if (!item) return
  model.value = moveSiteMenuArrayItem(model.value, index, next)
  emit('announce', siteMenuMoveAnnouncement(siteMenuAuthoredItemLabel(item), next + 1, model.value.length, 'parent'))
  nextTick(() => focusSiteMenuMoveControl(item.id, direction === -1 ? 'up' : 'down'))
}

function removeItem(index: number) {
  const nextFocusId = siteMenuRemovalFocusId(model.value, index)
  const [removed] = model.value.splice(index, 1)
  if (!removed) return
  emit('announce', `Removed ${siteMenuAuthoredItemLabel(removed)}.`)
  emit('remove', removed.id, nextFocusId)
  nextTick(() => focusAfterSiteMenuRemoval(nextFocusId))
}

function addChild(parentId: string, draft: SiteMenuChild, submittedMenuId: string) {
  emit('createChild', parentId, draft, submittedMenuId)
}

function onChildRemoved(removedId: string, nextId: string) {
  emit('remove', removedId, nextId)
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
  handle: '.hp-menu-drag-handle',
  draggable: '.hp-menu-sort-item',
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
    nextTick(() => emit('announce', siteMenuMoveAnnouncement(label, event.newIndex! + 1, model.value.length, 'parent')))
  },
  onEnd: () => {
    dropTarget.value = null
  }
})
</script>

<template>
  <ol ref="listRef" class="space-y-3" aria-label="Menu items">
    <li
      v-for="(item, index) in model"
      :key="item.id"
      :data-item-id="item.id"
      :data-item-label="siteMenuAuthoredItemLabel(item)"
      class="hp-menu-sort-item"
    >
      <div
        v-if="dropTarget?.id === item.id && !dropTarget.after"
        class="mb-2 h-0.5 rounded-full bg-primary"
        data-drop-indicator="before"
      />
      <div
        class="space-y-3 rounded-lg border p-3"
        :class="selectedId === item.id ? 'border-primary bg-primary/5' : 'border-default'"
        :data-validation-path="`document.items.${index}.id`"
        :aria-invalid="Boolean(immutableIdError(index))"
        tabindex="-1"
      >
        <div class="flex items-center gap-1">
          <UButton
            type="button"
            icon="i-lucide-grip-vertical"
            color="neutral"
            variant="ghost"
            square
            class="hp-menu-drag-handle min-h-11 min-w-11 touch-none cursor-grab active:cursor-grabbing"
            :data-menu-row-focus="item.id"
            :aria-label="`Drag ${siteMenuAuthoredItemLabel(item) || `item ${index + 1}`}`"
          />
          <button
            type="button"
            class="min-w-0 flex-1 rounded px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
            :data-menu-row-select="item.id"
            :aria-current="selectedId === item.id ? 'true' : undefined"
            @click="emit('select', item.id)"
          >
            <span class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-highlighted">{{ siteMenuAuthoredItemLabel(item) || `Item ${index + 1}` }}</span>
              <UBadge v-if="issueCount(index)" color="error" variant="soft" size="sm">
                {{ issueCount(index) }}
              </UBadge>
            </span>
            <span class="block truncate text-xs text-muted">
              {{ siteMenuDestinationSummary(item) }}
              <template v-if="isSiteMenuStaticItem(item) && item.children.length"> · {{ item.children.length }} children</template>
            </span>
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
            :aria-label="`Move ${siteMenuAuthoredItemLabel(item) || `item ${index + 1}`} up`"
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
            :aria-label="`Move ${siteMenuAuthoredItemLabel(item) || `item ${index + 1}`} down`"
            @click="moveWithControls(index, 1)"
          />
          <UButton
            type="button"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            square
            class="min-h-11 min-w-11"
            :aria-label="`Remove ${siteMenuAuthoredItemLabel(item) || `item ${index + 1}`}`"
            @click="removeItem(index)"
          />
        </div>

        <p v-if="immutableIdError(index)" class="text-xs text-error">
          {{ immutableIdError(index) }}
        </p>

        <div v-if="isSiteMenuStaticItem(item) && item.children.length" class="space-y-2 border-l border-muted pl-3">
          <p class="text-xs font-medium text-muted">Child links</p>
          <SiteMenuChildList
            v-model="item.children"
            :path-prefix="`document.items.${index}.children`"
            :parent-item-id="item.id"
            :selected-id="selectedId"
            :validation-issues="validationIssues"
            @announce="emit('announce', $event)"
            @select="emit('select', $event)"
            @remove="onChildRemoved"
          />
        </div>

        <SiteMenuItemCreateModal
          v-if="isSiteMenuStaticItem(item)"
          kind="child"
          :resource-id="resourceId"
          :parent-label="item.label"
          :wide="wideCreateOverlay"
          :dynamic-source-count="dynamicSourceCount"
          :source-options="sourceOptions"
          :source-options-pending="sourceOptionsPending"
          :source-options-error="sourceOptionsError"
          @create="(draft, submittedMenuId) => addChild(item.id, draft, submittedMenuId)"
        >
          <template #default="{ open }">
            <UButton
              type="button"
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="item.children.length >= SITE_MENU_MAX_CHILDREN"
              :data-menu-add-child="item.id"
              @click="open"
            >
              Add child item
            </UButton>
          </template>
        </SiteMenuItemCreateModal>
      </div>
      <div
        v-if="dropTarget?.id === item.id && dropTarget.after"
        class="mt-2 h-0.5 rounded-full bg-primary"
        data-drop-indicator="after"
      />
    </li>
  </ol>
</template>
