<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { ulid } from 'ulid'

import {
  SITE_MENU_MAX_DYNAMIC_SOURCES,
  siteMenuChildSchema,
  type SiteMenuChild,
  type SiteMenuSourceOptionsResponse
} from '~~/shared/site-menu'

const props = withDefaults(defineProps<{
  kind: 'parent' | 'child'
  resourceId: string
  wide: boolean
  dynamicSourceCount: number
  sourceOptions?: SiteMenuSourceOptionsResponse | null
  sourceOptionsPending?: boolean
  sourceOptionsError?: boolean
  parentLabel?: string
}>(), {
  sourceOptions: undefined,
  sourceOptionsPending: false,
  sourceOptionsError: false,
  parentLabel: undefined
})
const emit = defineEmits<{
  create: [item: SiteMenuChild, resourceId: string]
}>()

const open = ref(false)
const deliveryPending = ref(false)
const pendingCreation = ref<{
  item: SiteMenuChild
  resourceId: string
  generation: number
} | null>(null)
const formId = `site-menu-item-create-${useId()}`
const draftKind = ref<SiteMenuCreateItemKind>('static')
const draft = ref<SiteMenuChild>(newDraft('static'))
let active = true
let lifecycleGeneration = 0
const creationFinalizationFallback = createSiteMenuOverlayFinalizationFallback()
const allowDynamic = computed(() => props.dynamicSourceCount < SITE_MENU_MAX_DYNAMIC_SOURCES)

const title = computed(() => props.kind === 'parent' ? 'Add menu item' : 'Add child item')
const description = computed(() => props.kind === 'parent'
  ? 'Choose a static link, typed content query, or Page list. You can continue editing it in the inspector.'
  : `Choose a static link or typed dynamic source${props.parentLabel ? ` for ${props.parentLabel}` : ''}.`)

function newDraft(kind: SiteMenuCreateItemKind): SiteMenuChild {
  return createSiteMenuItemDraft(kind, `menu-${ulid()}`, props.sourceOptions)
}

onBeforeUnmount(() => {
  creationFinalizationFallback.cancel()
  active = false
  lifecycleGeneration++
})

function handleOpenChange(nextOpen: boolean) {
  if (!shouldAcceptSiteMenuItemCreateOpenChange(deliveryPending.value, nextOpen)) return
  open.value = nextOpen
  if (!nextOpen) return
  draftKind.value = 'static'
  draft.value = newDraft('static')
  pendingCreation.value = null
}

function openOverlay() {
  handleOpenChange(true)
}

function selectKind(kind: SiteMenuCreateItemKind) {
  if (kind !== 'static' && !allowDynamic.value) return
  draftKind.value = kind
  draft.value = newDraft(kind)
}

function submit(event: FormSubmitEvent<SiteMenuChild>) {
  if (deliveryPending.value || pendingCreation.value) return
  const generation = ++lifecycleGeneration
  pendingCreation.value = {
    item: siteMenuChildSchema.parse(event.data),
    resourceId: props.resourceId,
    generation
  }
  deliveryPending.value = true
  open.value = false
  creationFinalizationFallback.schedule(finalizePendingCreation)
}

async function focusInvalidField(_event: FormErrorEvent) {
  await nextTick()
  document.querySelector<HTMLElement>('[data-menu-item-create-focus], [data-menu-item-create-label]')?.focus()
}

function cancel() {
  handleOpenChange(false)
}

function finalizePendingCreation() {
  const created = pendingCreation.value
  if (!created) return
  pendingCreation.value = null
  creationFinalizationFallback.cancel()
  // Let Reka finish restoring the trigger before the new inspector or mobile
  // Slideover takes focus, otherwise close-autofocus can steal it back.
  afterSiteMenuOverlayFocusRestored(() => {
    if (!shouldEmitDeferredSiteMenuCreation(
      active,
      created.generation,
      lifecycleGeneration
    )) return
    deliveryPending.value = false
    emit('create', created.item, created.resourceId)
  })
}

function afterLeave() {
  finalizePendingCreation()
}
</script>

<template>
  <slot :open="openOverlay" />

  <UModal
    v-if="wide"
    :open="open"
    :title="title"
    :description="description"
    :ui="{ content: 'max-w-2xl', footer: 'justify-end' }"
    data-menu-item-create-modal
    @update:open="handleOpenChange"
    @after:leave="afterLeave"
  >
    <template #body>
      <SiteMenuItemCreateForm
        :form-id="formId"
        :draft="draft"
        :item-kind="draftKind"
        :allow-dynamic="allowDynamic"
        :options="sourceOptions"
        :options-pending="sourceOptionsPending"
        :options-error="sourceOptionsError"
        @select-kind="selectKind"
        @update-draft="draft = $event"
        @submit="submit"
        @error="focusInvalidField"
      />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          @click="cancel"
        >
          Cancel
        </UButton>
        <UButton
          type="submit"
          :form="formId"
          icon="i-lucide-plus"
        >
          {{ kind === 'parent' ? 'Add item' : 'Add child' }}
        </UButton>
      </div>
    </template>
  </UModal>

  <USlideover
    v-else
    :open="open"
    :title="title"
    :description="description"
    side="right"
    :ui="{ content: 'w-full max-w-none', footer: 'justify-end' }"
    data-menu-item-create-slideover
    @update:open="handleOpenChange"
    @after:leave="afterLeave"
  >
    <template #body>
      <SiteMenuItemCreateForm
        :form-id="formId"
        :draft="draft"
        :item-kind="draftKind"
        :allow-dynamic="allowDynamic"
        :options="sourceOptions"
        :options-pending="sourceOptionsPending"
        :options-error="sourceOptionsError"
        @select-kind="selectKind"
        @update-draft="draft = $event"
        @submit="submit"
        @error="focusInvalidField"
      />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" @click="cancel">
          Cancel
        </UButton>
        <UButton type="submit" :form="formId" icon="i-lucide-plus">
          {{ kind === 'parent' ? 'Add item' : 'Add child' }}
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
