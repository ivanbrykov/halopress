<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'

import {
  siteMenuCreateSchema,
  type SiteMenuCreate
} from '~~/shared/site-menu'

defineProps<{
  formId: string
  state: SiteMenuCreate
  errorMessage?: string
}>()
const emit = defineEmits<{
  submit: [event: FormSubmitEvent<SiteMenuCreate>]
  error: [event: FormErrorEvent]
  updateName: [name: string]
}>()
</script>

<template>
  <UForm
    :id="formId"
    :schema="siteMenuCreateSchema"
    :state="state"
    :loading-auto="false"
    @submit="emit('submit', $event)"
    @error="emit('error', $event)"
  >
    <UFormField
      name="name"
      label="Menu name"
      description="Names are Unicode-aware and unique regardless of case."
      required
      :error="errorMessage"
    >
      <UInput
        :model-value="state.name"
        class="w-full"
        placeholder="Footer links"
        maxlength="80"
        autocomplete="off"
        autofocus
        data-menu-create-name
        @update:model-value="emit('updateName', String($event))"
      />
    </UFormField>
  </UForm>
</template>
