<script setup lang="ts">
import type { LayoutAssignmentOption } from '~~/shared/layout-assignment'
import { layoutIdSchema } from '~~/shared/site-layout'

type AssignmentSelectItem = {
  id: string
  label: string
  description: string
  status: 'ready' | 'invalid' | 'missing' | 'repair-required' | 'loading' | 'error'
  disabled?: boolean
  icon?: string
}

const props = withDefaults(defineProps<{
  name?: string
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean
  modeEnabled?: boolean
}>(), {
  name: 'layoutId',
  label: 'Layout',
  description: 'Assignments follow the current Layout revision.',
  placeholder: 'Use inherited or built-in Layout',
  disabled: false,
  modeEnabled: undefined
})

const model = defineModel<string | null>({ default: null })
const {
  data,
  pending,
  error,
  refresh
} = useLayoutAssignmentOptions()

const effectiveModeEnabled = computed(() => props.modeEnabled ?? data.value?.modeEnabled === true)
const requestErrorMessage = computed(() => {
  const value = error.value as { statusMessage?: string, message?: string } | null
  return value?.statusMessage || value?.message || 'Refresh the Layout list and try again.'
})

function readySelectItem(item: LayoutAssignmentOption): AssignmentSelectItem {
  return {
    id: item.id,
    label: item.name,
    description: `Revision ${item.revision} · follows current Layout revision`,
    status: 'ready',
    icon: 'i-lucide-panels-top-left'
  }
}

const readyItems = computed(() => (
  data.value?.items
    .filter(item => item.status === 'ready')
    .map(readySelectItem) ?? []
))
const readyIds = computed(() => new Set(readyItems.value.map(item => item.id)))
const selectedResource = computed(() => (
  data.value?.items.find(item => item.id === model.value) ?? null
))
const selectedStatus = computed<AssignmentSelectItem['status'] | 'none'>(() => {
  if (!model.value) return 'none'
  if (!layoutIdSchema.safeParse(model.value).success) return 'invalid'
  if (pending.value && !data.value) return 'loading'
  if (error.value && !data.value) return 'error'
  if (!selectedResource.value) return 'missing'
  return selectedResource.value.status
})
const diagnosticItem = computed<AssignmentSelectItem | null>(() => {
  if (!model.value || selectedStatus.value === 'ready') return null

  if (selectedStatus.value === 'repair-required' && selectedResource.value) {
    return {
      id: model.value,
      label: selectedResource.value.name,
      description: selectedResource.value.reason || 'This Layout must be repaired before it can be assigned.',
      status: 'repair-required',
      disabled: true,
      icon: 'i-lucide-triangle-alert'
    }
  }
  if (selectedStatus.value === 'invalid') {
    return {
      id: model.value,
      label: `Invalid Layout assignment (${model.value})`,
      description: 'The stored Layout ID is invalid. Public rendering uses the built-in fallback.',
      status: 'invalid',
      disabled: true,
      icon: 'i-lucide-shield-alert'
    }
  }
  if (selectedStatus.value === 'loading') {
    return {
      id: model.value,
      label: `Stored Layout (${model.value})`,
      description: 'Checking the stored Layout assignment…',
      status: 'loading',
      disabled: true,
      icon: 'i-lucide-loader-circle'
    }
  }
  if (selectedStatus.value === 'error') {
    return {
      id: model.value,
      label: `Stored Layout (${model.value})`,
      description: 'The stored assignment is preserved while Layouts are unavailable.',
      status: 'error',
      disabled: true,
      icon: 'i-lucide-circle-alert'
    }
  }
  return {
    id: model.value,
    label: `Missing Layout (${model.value})`,
    description: 'The assigned Layout no longer exists. Public rendering uses the built-in fallback.',
    status: 'missing',
    disabled: true,
    icon: 'i-lucide-file-question-mark'
  }
})
const selectItems = computed(() => (
  diagnosticItem.value ? [diagnosticItem.value, ...readyItems.value] : readyItems.value
))
const controlsDisabled = computed(() => (
  props.disabled || !effectiveModeEnabled.value || pending.value || Boolean(error.value)
))

function updateModel(value: unknown) {
  if (controlsDisabled.value) return
  if (typeof value === 'string' && readyIds.value.has(value)) {
    model.value = value
    return
  }
  model.value = null
}
</script>

<template>
  <div class="space-y-3" :data-layout-assignment-status="selectedStatus">
    <UFormField
      :name="name"
      :label="label"
      :description="description"
      :error="error ? requestErrorMessage : undefined"
    >
      <USelectMenu
        :model-value="model ?? undefined"
        :items="selectItems"
        value-key="id"
        label-key="label"
        description-key="description"
        :filter-fields="['label', 'description']"
        :search-input="{ placeholder: 'Search Layouts…' }"
        :placeholder="placeholder"
        :clear="effectiveModeEnabled && !controlsDisabled && model !== null"
        :loading="pending"
        :disabled="controlsDisabled"
        class="w-full"
        @update:model-value="updateModel"
      />
    </UFormField>

    <UAlert
      v-if="error"
      title="Layouts are unavailable"
      :description="requestErrorMessage"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-rotate-cw" @click="refresh()">
          Refresh
        </UButton>
      </template>
    </UAlert>
    <UAlert
      v-else-if="!effectiveModeEnabled && !pending"
      title="Site features are disabled"
      description="The stored Layout assignment is preserved and read-only. Enable Site features to change or clear it."
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock-keyhole"
    />
    <UAlert
      v-else-if="selectedStatus === 'invalid'"
      title="Assigned Layout ID is invalid"
      :description="diagnosticItem?.description"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
    />
    <UAlert
      v-else-if="selectedStatus === 'repair-required'"
      title="Assigned Layout needs repair"
      :description="diagnosticItem?.description"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
    />
    <UAlert
      v-else-if="selectedStatus === 'missing'"
      title="Assigned Layout is missing"
      :description="diagnosticItem?.description"
      color="warning"
      variant="subtle"
      icon="i-lucide-file-question-mark"
    />
    <p v-else-if="!pending && !readyItems.length" class="text-sm text-muted" role="status">
      No ready Layouts are available. Create or repair a Layout before assigning one.
    </p>
  </div>
</template>
