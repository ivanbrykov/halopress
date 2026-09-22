<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'

import {
  isSiteMenuDynamicItem,
  siteMenuChildSchema,
  type SiteMenuChild,
  type SiteMenuSourceOptionsResponse
} from '~~/shared/site-menu'

const props = defineProps<{
  formId: string
  draft: SiteMenuChild
  itemKind: SiteMenuCreateItemKind
  allowDynamic: boolean
  options?: SiteMenuSourceOptionsResponse | null
  optionsPending?: boolean
  optionsError?: boolean
}>()
const emit = defineEmits<{
  submit: [event: FormSubmitEvent<SiteMenuChild>]
  error: [event: FormErrorEvent]
  selectKind: [kind: SiteMenuCreateItemKind]
  updateDraft: [draft: SiteMenuChild]
}>()

const kindItems = computed(() => [
  { label: 'Static link', value: 'static' },
  ...(props.allowDynamic
    ? [
        { label: 'Content query', value: 'schemaQuery' },
        { label: 'Page list', value: 'pagePrefix' }
      ]
    : [])
])
</script>

<template>
  <UForm
    :id="formId"
    :schema="siteMenuChildSchema"
    :state="draft"
    :loading-auto="false"
    class="space-y-5"
    @submit="emit('submit', $event)"
    @error="emit('error', $event)"
  >
    <UFormField
      label="Item type"
      description="Choose a typed source. Menu items never store query expressions or executable text."
      required
    >
      <USelect
        :model-value="itemKind"
        :items="kindItems"
        value-key="value"
        class="w-full"
        data-menu-item-kind
        @update:model-value="emit('selectKind', $event as SiteMenuCreateItemKind)"
      />
    </UFormField>

    <UAlert
      v-if="!allowDynamic"
      title="Dynamic source limit reached"
      description="This Menu already contains the maximum number of dynamic sources. Static links can still be added."
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
    />

    <SiteMenuSourceEditor
      v-if="isSiteMenuDynamicItem(draft)"
      :model-value="draft"
      path-prefix="create"
      :options="options"
      :options-pending="optionsPending"
      :options-error="optionsError"
      autofocus
      @update:model-value="emit('updateDraft', $event)"
    />
    <SiteMenuItemEditor
      v-else
      :model-value="draft"
      path-prefix="create"
      autofocus-label
      @update:model-value="emit('updateDraft', $event)"
    />
  </UForm>
</template>
