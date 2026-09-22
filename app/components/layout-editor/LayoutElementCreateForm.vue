<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

import type {
  LayoutDocument,
  LayoutElementDescriptor,
  LayoutRegionKey
} from '~~/shared/site-layout'
import type { SiteMenuAdminResource } from '~~/shared/site-menu'
import { hasUsableLayoutMenuItems } from '~/utils/layout-editor'

const props = defineProps<{
  formId: string
  document: LayoutDocument
  descriptor: LayoutElementDescriptor
  state: { regionId: LayoutRegionKey, menuSetId: string }
  menuSets: SiteMenuAdminResource[]
  menuPending: boolean
}>()
const emit = defineEmits<{
  submit: [event: FormSubmitEvent<{ regionId: string, menuSetId?: string }>]
  error: [event: FormErrorEvent]
  updateRegion: [value: LayoutRegionKey]
  updateMenuSet: [value: string]
}>()

const allowedRegions = computed(() => allowedLayoutRegions(props.document, props.descriptor.type))
const regionItems = computed(() => allowedRegions.value.map(region => ({
  label: region.replaceAll('-', ' '),
  value: region
})))
const menuItems = computed(() => props.menuSets.map(menu => ({
  label: menu.name,
  value: menu.id,
  description: menu.malformedStoredValue ? 'This Menu set needs repair.' : `Stable ID: ${menu.id}`,
  disabled: menu.malformedStoredValue
})))
const hasUsableMenuItems = computed(() => hasUsableLayoutMenuItems(menuItems.value))
const schema = computed(() => z.object({
  regionId: z.string().refine(value => allowedRegions.value.includes(value as LayoutRegionKey), 'Choose an available region'),
  menuSetId: props.descriptor.type === 'menu'
    ? z.string().trim().min(1, 'Choose a Menu set')
    : z.string().optional()
}))

function updateRegion(value: unknown) {
  if (typeof value === 'string') emit('updateRegion', value as LayoutRegionKey)
}
</script>

<template>
  <UForm
    :id="formId"
    :schema="schema"
    :state="state"
    :loading-auto="false"
    class="space-y-5"
    @submit="emit('submit', $event)"
    @error="emit('error', $event)"
  >
    <UFormField
      name="regionId"
      label="Region"
      description="Only regions present in this Layout and valid for this element are available."
      required
    >
      <USelect
        :model-value="state.regionId"
        :items="regionItems"
        value-key="value"
        class="w-full"
        data-layout-element-region
        @update:model-value="updateRegion"
      />
    </UFormField>

    <UFormField
      v-if="descriptor.type === 'menu'"
      name="menuSetId"
      label="Menu set"
      description="The Layout stores only the stable Menu set ID."
      required
    >
      <USelectMenu
        :model-value="state.menuSetId"
        :items="menuItems"
        value-key="value"
        class="w-full"
        :loading="menuPending"
        placeholder="Choose a Menu set"
        data-layout-element-menu-set
        @update:model-value="emit('updateMenuSet', String($event || ''))"
      />
    </UFormField>

    <UAlert
      v-if="descriptor.type === 'menu' && !menuPending && !hasUsableMenuItems"
      title="No usable Menu sets"
      description="Create or repair a Menu set before adding this element."
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
    />
  </UForm>
</template>
