<script setup lang="ts">
import {
  isFilterableFieldKind,
  isFullTextFieldKind
} from '~~/shared/search-field-capabilities'
import {
  applyFullTextFieldIds,
  fullTextFieldIds,
  setFieldFilterable,
  type SchemaSearchField
} from '~/utils/schema-search-configuration'

const props = defineProps<{
  modelValue: SchemaSearchField[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SchemaSearchField[]): void
}>()

const fullTextOptions = computed(() => props.modelValue
  .filter(field => !field.system && isFullTextFieldKind(field.kind))
  .map(field => ({
    label: field.title || field.key,
    value: field.id,
    description: `${field.key} · ${field.kind}`
  })))

const selectedFullTextIds = computed(() => fullTextFieldIds(props.modelValue))
const filterableFields = computed(() => props.modelValue
  .filter(field => !field.system && isFilterableFieldKind(field.kind)))

function updateFullText(value: unknown) {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  emit('update:modelValue', applyFullTextFieldIds(props.modelValue, ids))
}

function updateFilterable(fieldId: string, enabled: boolean) {
  emit('update:modelValue', setFieldFilterable(props.modelValue, fieldId, enabled))
}

function searchMode(field: SchemaSearchField) {
  return field.search?.mode ?? 'off'
}
</script>

<template>
  <section class="min-w-0 space-y-5" aria-labelledby="schema-search-configuration-heading">
    <div>
      <h2 id="schema-search-configuration-heading" class="text-sm font-semibold text-highlighted">
        Search configuration
      </h2>
      <p class="mt-1 text-sm text-muted">
        Review search coverage across the Schema. These values stay in the Schema draft until you publish it.
      </p>
    </div>

    <UFormField
      label="Full-text fields"
      description="Choose every text field whose published values should contribute to full-text search."
    >
      <USelectMenu
        :model-value="selectedFullTextIds"
        :items="fullTextOptions"
        value-key="value"
        label-key="label"
        multiple
        searchable
        class="w-full"
        placeholder="Select full-text fields"
        aria-label="Full-text fields"
        @update:model-value="updateFullText"
      />
    </UFormField>

    <div class="space-y-2">
      <div>
        <h3 class="text-sm font-medium text-highlighted">Filterable fields</h3>
        <p class="text-xs text-muted">
          Enabling a field that is currently off selects the same compatible search mode used by the field editor.
        </p>
      </div>

      <div class="divide-y divide-default rounded-lg border border-default">
        <div
          v-for="field in filterableFields"
          :key="field.id"
          class="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-highlighted">{{ field.title || field.key }}</div>
            <div class="text-xs text-muted">
              <span class="font-mono">{{ field.key }}</span>
              <span aria-hidden="true"> · </span>
              <span>{{ field.kind }}</span>
              <span aria-hidden="true"> · </span>
              <span>Search mode: {{ searchMode(field) }}</span>
            </div>
          </div>
          <USwitch
            :id="`schema-filterable-${field.id}`"
            :model-value="field.search?.filterable === true"
            :label="`Filterable: ${field.title || field.key}`"
            :description="`${field.key}, ${field.kind}, current search mode ${searchMode(field)}`"
            :aria-label="`Filterable for ${field.title || field.key} (${field.key})`"
            @update:model-value="value => updateFilterable(field.id, value)"
          />
        </div>
      </div>
    </div>
  </section>
</template>
