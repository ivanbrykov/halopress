<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

import {
  layoutCreateSchema,
  type LayoutPresetKey,
  type LayoutPresetMetadata
} from '~~/shared/site-layout'

const props = defineProps<{
  formId: string
  state: { name: string, presetKey: LayoutPresetKey }
  presets: LayoutPresetMetadata[]
  nameError?: string
}>()
const emit = defineEmits<{
  submit: [event: FormSubmitEvent<{ name: string, presetKey: LayoutPresetKey }>]
  error: [event: FormErrorEvent]
  updateName: [value: string]
  updatePreset: [value: LayoutPresetKey]
}>()

const presetItems = computed<RadioGroupItem[]>(() => props.presets.map(preset => ({
  label: preset.label,
  description: preset.summary,
  value: preset.key
})))
</script>

<template>
  <UForm
    :id="formId"
    :schema="layoutCreateSchema"
    :state="state"
    :loading-auto="false"
    class="space-y-5"
    @submit="emit('submit', $event)"
    @error="emit('error', $event)"
  >
    <UFormField
      name="name"
      label="Layout name"
      description="Names are unique regardless of case and become part of the public Layout contract."
      required
      :error="nameError"
    >
      <UInput
        :model-value="state.name"
        class="w-full"
        placeholder="Article with sidebar"
        maxlength="80"
        autocomplete="off"
        autofocus
        data-layout-create-name
        @update:model-value="emit('updateName', String($event))"
      />
    </UFormField>

    <UFormField name="presetKey" label="Preset" required>
      <URadioGroup
        :model-value="state.presetKey"
        :items="presetItems"
        value-key="value"
        variant="card"
        class="grid gap-2 sm:grid-cols-2"
        data-layout-create-presets
        @update:model-value="emit('updatePreset', $event as LayoutPresetKey)"
      />
    </UFormField>
  </UForm>
</template>
