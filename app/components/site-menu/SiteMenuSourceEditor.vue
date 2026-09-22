<script setup lang="ts">
import {
  SITE_MENU_ICONS,
  SITE_MENU_MAX_EXACT_SET_VALUES,
  SITE_MENU_MAX_SOURCE_FILTERS,
  SITE_MENU_MAX_SOURCE_RESULTS,
  SITE_MENU_MIN_SOURCE_RESULTS,
  type SiteMenuDynamicItem,
  type SiteMenuSchemaFilter,
  type SiteMenuSourceFieldOption,
  type SiteMenuSourceOptionsResponse,
  type SiteMenuValidationIssue
} from '~~/shared/site-menu'

const model = defineModel<SiteMenuDynamicItem>({ required: true })
const props = defineProps<{
  pathPrefix: string
  options?: SiteMenuSourceOptionsResponse | null
  optionsPending?: boolean
  optionsError?: boolean
  validationIssues?: SiteMenuValidationIssue[]
  autofocus?: boolean
}>()

const NO_ICON = '__none__'
const SYSTEM_TITLE = 'system:title'

const schemaItems = computed(() => (props.options?.schemas ?? []).map(schema => ({
  label: schema.label,
  value: schema.schemaKey
})))
const selectedSchema = computed(() => {
  const source = model.value.source
  return source.type === 'schemaQuery'
    ? props.options?.schemas.find(schema => schema.schemaKey === source.schemaKey)
    : undefined
})
const schemaFilters = computed(() => model.value.source.type === 'schemaQuery' ? model.value.source.filters : [])
const filterFields = computed(() => (selectedSchema.value?.fields ?? []).filter(field => (
  field.filterable && (field.searchMode === 'exact' || field.searchMode === 'exact_set')
)))
const sortableFields = computed(() => (selectedSchema.value?.fields ?? []).filter(field => field.sortable))
const labelFields = computed(() => (selectedSchema.value?.fields ?? []).filter(field => field.labelEligible))
const sortItems = computed(() => [
  { label: 'Created time', value: 'system:createdAt' },
  { label: 'Updated time', value: 'system:updatedAt' },
  ...sortableFields.value.map(field => ({ label: field.label, value: `field:${field.fieldId}` }))
])
const labelItems = computed(() => [
  { label: 'Published title', value: SYSTEM_TITLE },
  ...labelFields.value.map(field => ({ label: field.label, value: `field:${field.fieldId}` }))
])
const directionItems = [
  { label: 'Descending', value: 'desc' },
  { label: 'Ascending', value: 'asc' }
]
const pageScopeItems = [
  { label: 'Fixed path prefix', value: 'fixed' },
  { label: 'Current Page parent', value: 'currentParent' }
]
const pageSortItems = [
  { label: 'Published title', value: 'title' },
  { label: 'Canonical path', value: 'path' }
]
const iconItems = [
  { label: 'No icon', value: NO_ICON },
  ...SITE_MENU_ICONS.map(icon => ({
    label: icon.replace('i-lucide-', '').replaceAll('-', ' '),
    value: icon,
    icon
  }))
]

function errorAt(suffix: string) {
  return (props.validationIssues ?? []).find(issue => (
    issue.path === `${props.pathPrefix}.${suffix}`
    || issue.path.startsWith(`${props.pathPrefix}.${suffix}.`)
  ))?.message
}

function fieldForFilter(filter: SiteMenuSchemaFilter) {
  return selectedSchema.value?.fields.find(field => field.fieldId === filter.fieldId)
}

function filterFieldItems(index: number) {
  const used = new Set(schemaFilters.value.flatMap((filter, candidateIndex) => (
    candidateIndex === index ? [] : [filter.fieldId]
  )))
  return filterFields.value
    .filter(field => !used.has(field.fieldId))
    .map(field => ({ label: field.label, value: field.fieldId }))
}

function operatorItems(filter: SiteMenuSchemaFilter) {
  const field = fieldForFilter(filter)
  return field?.searchMode === 'exact_set'
    ? [
        { label: 'Equals', value: 'exact' },
        { label: 'Matches any value', value: 'exactSet' }
      ]
    : [{ label: 'Equals', value: 'exact' }]
}

function valueItems(field: SiteMenuSourceFieldOption | undefined) {
  if (!field) return []
  if (field.enumValues.length) return field.enumValues
  if (field.kind === 'boolean') {
    return [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' }
    ]
  }
  return []
}

function valueInputType(field: SiteMenuSourceFieldOption | undefined) {
  return field?.kind === 'number' || field?.kind === 'integer' ? 'number' : 'text'
}

function updateSchemaKey(value: unknown) {
  if (model.value.source.type !== 'schemaQuery' || typeof value !== 'string') return
  model.value.source = {
    ...model.value.source,
    schemaKey: value,
    filters: [],
    sort: { type: 'system', field: 'createdAt', direction: 'desc' },
    label: { type: 'systemTitle' }
  }
}

function addFilter() {
  if (model.value.source.type !== 'schemaQuery'
    || model.value.source.filters.length >= SITE_MENU_MAX_SOURCE_FILTERS) return
  const used = new Set(model.value.source.filters.map(filter => filter.fieldId))
  const field = filterFields.value.find(candidate => !used.has(candidate.fieldId))
  if (!field) return
  model.value.source.filters.push({ fieldId: field.fieldId, operator: 'exact', value: '' })
}

function removeFilter(index: number) {
  if (model.value.source.type !== 'schemaQuery') return
  model.value.source.filters.splice(index, 1)
}

function updateFilterField(index: number, value: unknown) {
  if (model.value.source.type !== 'schemaQuery' || typeof value !== 'string') return
  const current = model.value.source.filters[index]
  if (!current) return
  model.value.source.filters[index] = { fieldId: value, operator: 'exact', value: '' }
}

function updateFilterOperator(index: number, value: unknown) {
  if (model.value.source.type !== 'schemaQuery' || (value !== 'exact' && value !== 'exactSet')) return
  const current = model.value.source.filters[index]
  if (!current) return
  model.value.source.filters[index] = value === 'exact'
    ? { fieldId: current.fieldId, operator: 'exact', value: '' }
    : { fieldId: current.fieldId, operator: 'exactSet', values: [''] }
}

function updateExactValue(index: number, value: unknown) {
  if (model.value.source.type !== 'schemaQuery') return
  const filter = model.value.source.filters[index]
  if (!filter || filter.operator !== 'exact') return
  filter.value = siteMenuTypedFilterValue(fieldForFilter(filter), value)
}

function updateSetValue(filterIndex: number, valueIndex: number, value: unknown) {
  if (model.value.source.type !== 'schemaQuery') return
  const filter = model.value.source.filters[filterIndex]
  if (!filter || filter.operator !== 'exactSet') return
  filter.values[valueIndex] = siteMenuTypedFilterValue(fieldForFilter(filter), value)
}

function addSetValue(filterIndex: number) {
  if (model.value.source.type !== 'schemaQuery') return
  const filter = model.value.source.filters[filterIndex]
  if (!filter || filter.operator !== 'exactSet' || filter.values.length >= SITE_MENU_MAX_EXACT_SET_VALUES) return
  filter.values.push('')
}

function removeSetValue(filterIndex: number, valueIndex: number) {
  if (model.value.source.type !== 'schemaQuery') return
  const filter = model.value.source.filters[filterIndex]
  if (!filter || filter.operator !== 'exactSet' || filter.values.length <= 1) return
  filter.values.splice(valueIndex, 1)
}

const sortTarget = computed({
  get() {
    if (model.value.source.type !== 'schemaQuery') return 'system:createdAt'
    return model.value.source.sort.type === 'system'
      ? `system:${model.value.source.sort.field}`
      : `field:${model.value.source.sort.fieldId}`
  },
  set(value: string) {
    if (model.value.source.type !== 'schemaQuery') return
    const direction = model.value.source.sort.direction
    model.value.source.sort = value.startsWith('field:')
      ? { type: 'field', fieldId: value.slice('field:'.length), direction }
      : { type: 'system', field: value === 'system:updatedAt' ? 'updatedAt' : 'createdAt', direction }
  }
})

const sortDirection = computed({
  get: () => model.value.source.type === 'schemaQuery' ? model.value.source.sort.direction : 'desc',
  set(value: 'asc' | 'desc') {
    if (model.value.source.type === 'schemaQuery') model.value.source.sort.direction = value
  }
})

const labelTarget = computed({
  get() {
    if (model.value.source.type !== 'schemaQuery' || model.value.source.label.type === 'systemTitle') return SYSTEM_TITLE
    return `field:${model.value.source.label.fieldId}`
  },
  set(value: string) {
    if (model.value.source.type !== 'schemaQuery') return
    model.value.source.label = value.startsWith('field:')
      ? { type: 'field', fieldId: value.slice('field:'.length) }
      : { type: 'systemTitle' }
  }
})

const sourceLimit = computed({
  get: () => model.value.source.limit,
  set(value: number | undefined) {
    if (typeof value === 'number') model.value.source.limit = value
  }
})

const sourceIcon = computed({
  get: () => model.value.source.icon ?? NO_ICON,
  set(value: string) {
    if (SITE_MENU_ICONS.includes(value as typeof SITE_MENU_ICONS[number])) {
      model.value.source.icon = value as typeof SITE_MENU_ICONS[number]
    } else {
      delete model.value.source.icon
    }
  }
})

const sourceBadge = computed({
  get: () => model.value.source.badge === undefined ? '' : String(model.value.source.badge),
  set(value: string) {
    const normalized = value.trim()
    if (normalized) model.value.source.badge = normalized
    else delete model.value.source.badge
  }
})

const pageScope = computed({
  get: () => model.value.source.type === 'pagePrefix' ? model.value.source.scope.type : 'fixed',
  set(value: 'fixed' | 'currentParent') {
    if (model.value.source.type !== 'pagePrefix') return
    model.value.source.scope = value === 'currentParent'
      ? { type: 'currentParent' }
      : { type: 'fixed', prefix: '/' }
  }
})

const pagePrefix = computed({
  get: () => model.value.source.type === 'pagePrefix' && model.value.source.scope.type === 'fixed'
    ? model.value.source.scope.prefix
    : '/',
  set(value: string) {
    if (model.value.source.type === 'pagePrefix' && model.value.source.scope.type === 'fixed') {
      model.value.source.scope.prefix = value
    }
  }
})

const pageSort = computed({
  get: () => model.value.source.type === 'pagePrefix' ? model.value.source.sort : 'title',
  set(value: 'title' | 'path') {
    if (model.value.source.type === 'pagePrefix') model.value.source.sort = value
  }
})
</script>

<template>
  <div class="space-y-5" data-menu-source-editor>
    <UAlert
      v-if="optionsError"
      title="Source choices are unavailable"
      description="Static links remain editable. Refresh the page before configuring a dynamic source."
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
    />

    <template v-if="model.source.type === 'schemaQuery'">
      <div class="grid min-w-0 gap-3 sm:grid-cols-2">
        <UFormField
          name="source.schemaKey"
          label="Schema"
          description="Only active Schemas with anonymous read access are available."
          required
          class="min-w-0 sm:col-span-2"
          :error="errorAt('source.schemaKey')"
        >
          <USelect
            :model-value="model.source.schemaKey"
            :items="schemaItems"
            value-key="value"
            class="w-full"
            :loading="optionsPending"
            placeholder="Choose a Schema"
            :autofocus="autofocus"
            :data-menu-item-create-focus="autofocus ? '' : undefined"
            :data-validation-path="`${pathPrefix}.source.schemaKey`"
            @update:model-value="updateSchemaKey"
          />
        </UFormField>

        <UFormField name="source.sort" label="Sort by" required class="min-w-0" :error="errorAt('source.sort')">
          <USelect v-model="sortTarget" :items="sortItems" value-key="value" class="w-full" :data-validation-path="`${pathPrefix}.source.sort`" />
        </UFormField>
        <UFormField name="source.sort.direction" label="Direction" required class="min-w-0" :error="errorAt('source.sort.direction')">
          <USelect v-model="sortDirection" :items="directionItems" value-key="value" class="w-full" :data-validation-path="`${pathPrefix}.source.sort.direction`" />
        </UFormField>
        <UFormField name="source.label" label="Item label" required class="min-w-0" :error="errorAt('source.label')">
          <USelect v-model="labelTarget" :items="labelItems" value-key="value" class="w-full" :data-validation-path="`${pathPrefix}.source.label`" />
        </UFormField>
        <UFormField name="source.limit" label="Maximum results" required class="min-w-0" :error="errorAt('source.limit')">
          <UInputNumber
            v-model="sourceLimit"
            :min="SITE_MENU_MIN_SOURCE_RESULTS"
            :max="SITE_MENU_MAX_SOURCE_RESULTS"
            class="w-full"
            :data-validation-path="`${pathPrefix}.source.limit`"
          />
        </UFormField>
      </div>

      <section class="space-y-3 rounded-lg border border-muted p-3" aria-labelledby="menu-source-filters-heading">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 id="menu-source-filters-heading" class="font-medium text-highlighted">Filters</h4>
            <p class="text-xs text-muted">Use configured exact fields only. Each field can appear once.</p>
          </div>
          <UButton
            type="button"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="schemaFilters.length >= SITE_MENU_MAX_SOURCE_FILTERS || filterFields.length <= schemaFilters.length"
            data-menu-add-filter
            @click="addFilter"
          >
            Add filter
          </UButton>
        </div>

        <UAlert
          v-if="!schemaFilters.length"
          title="No filters"
          description="The source includes recent published content from the selected Schema."
          variant="subtle"
          icon="i-lucide-info"
        />

        <div
          v-for="(filter, filterIndex) in schemaFilters"
          :key="`${filter.fieldId}:${filterIndex}`"
          class="space-y-3 rounded-md border border-default p-3"
          :data-menu-source-filter="filterIndex"
        >
          <div class="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <UFormField :name="`source.filters.${filterIndex}.fieldId`" label="Field" required class="min-w-0" :error="errorAt(`source.filters.${filterIndex}.fieldId`)">
              <USelect
                :model-value="filter.fieldId"
                :items="filterFieldItems(filterIndex)"
                value-key="value"
                class="w-full"
                :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.fieldId`"
                @update:model-value="updateFilterField(filterIndex, $event)"
              />
            </UFormField>
            <UFormField :name="`source.filters.${filterIndex}.operator`" label="Operator" required class="min-w-0" :error="errorAt(`source.filters.${filterIndex}.operator`)">
              <USelect
                :model-value="filter.operator"
                :items="operatorItems(filter)"
                value-key="value"
                class="w-full"
                :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.operator`"
                @update:model-value="updateFilterOperator(filterIndex, $event)"
              />
            </UFormField>
            <UButton
              type="button"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              square
              class="self-end"
              :aria-label="`Remove filter ${filterIndex + 1}`"
              @click="removeFilter(filterIndex)"
            />
          </div>

          <UFormField
            v-if="filter.operator === 'exact'"
            :name="`source.filters.${filterIndex}.value`"
            label="Value"
            required
            :error="errorAt(`source.filters.${filterIndex}.value`)"
          >
            <USelect
              v-if="valueItems(fieldForFilter(filter)).length"
              :model-value="String(filter.value)"
              :items="valueItems(fieldForFilter(filter))"
              value-key="value"
              class="w-full"
              :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.value`"
              @update:model-value="updateExactValue(filterIndex, $event)"
            />
            <UInput
              v-else
              :model-value="String(filter.value)"
              :type="valueInputType(fieldForFilter(filter))"
              class="w-full"
              :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.value`"
              @update:model-value="updateExactValue(filterIndex, $event)"
            />
          </UFormField>

          <div v-else class="space-y-2">
            <div
              v-for="(value, valueIndex) in filter.values"
              :key="valueIndex"
              class="flex items-end gap-2"
            >
              <UFormField
                :name="`source.filters.${filterIndex}.values.${valueIndex}`"
                :label="`Value ${valueIndex + 1}`"
                required
                class="min-w-0 flex-1"
                :error="errorAt(`source.filters.${filterIndex}.values.${valueIndex}`)"
              >
                <USelect
                  v-if="valueItems(fieldForFilter(filter)).length"
                  :model-value="String(value)"
                  :items="valueItems(fieldForFilter(filter))"
                  value-key="value"
                  class="w-full"
                  :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.values.${valueIndex}`"
                  @update:model-value="updateSetValue(filterIndex, valueIndex, $event)"
                />
                <UInput
                  v-else
                  :model-value="String(value)"
                  :type="valueInputType(fieldForFilter(filter))"
                  class="w-full"
                  :data-validation-path="`${pathPrefix}.source.filters.${filterIndex}.values.${valueIndex}`"
                  @update:model-value="updateSetValue(filterIndex, valueIndex, $event)"
                />
              </UFormField>
              <UButton
                type="button"
                icon="i-lucide-x"
                color="error"
                variant="ghost"
                square
                :disabled="filter.values.length <= 1"
                :aria-label="`Remove value ${valueIndex + 1}`"
                @click="removeSetValue(filterIndex, valueIndex)"
              />
            </div>
            <UButton
              type="button"
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="filter.values.length >= SITE_MENU_MAX_EXACT_SET_VALUES"
              @click="addSetValue(filterIndex)"
            >
              Add value
            </UButton>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
      <div class="grid min-w-0 gap-3 sm:grid-cols-2">
        <UFormField name="source.scope.type" label="Page scope" required class="min-w-0 sm:col-span-2" :error="errorAt('source.scope')">
          <USelect
            v-model="pageScope"
            :items="pageScopeItems"
            value-key="value"
            class="w-full"
            :autofocus="autofocus"
            :data-menu-item-create-focus="autofocus ? '' : undefined"
            :data-validation-path="`${pathPrefix}.source.scope`"
          />
        </UFormField>
        <UFormField
          v-if="model.source.scope.type === 'fixed'"
          name="source.scope.prefix"
          label="Canonical path prefix"
          description="Returns canonical published Pages that are direct children of this path."
          required
          class="min-w-0 sm:col-span-2"
          :error="errorAt('source.scope.prefix')"
        >
          <UInput v-model="pagePrefix" class="w-full" placeholder="/guides/" :data-validation-path="`${pathPrefix}.source.scope.prefix`" />
        </UFormField>
        <UAlert
          v-else
          title="Uses the current Page parent"
          description="For /foo/bar this lists direct children of /foo, including the current Page. Root-level Pages use the Site root. Non-Page previews return an empty result."
          class="sm:col-span-2"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
        />
        <UFormField name="source.sort" label="Sort by" required class="min-w-0" :error="errorAt('source.sort')">
          <USelect v-model="pageSort" :items="pageSortItems" value-key="value" class="w-full" :data-validation-path="`${pathPrefix}.source.sort`" />
        </UFormField>
        <UFormField name="source.limit" label="Maximum results" required class="min-w-0" :error="errorAt('source.limit')">
          <UInputNumber
            v-model="sourceLimit"
            :min="SITE_MENU_MIN_SOURCE_RESULTS"
            :max="SITE_MENU_MAX_SOURCE_RESULTS"
            class="w-full"
            :data-validation-path="`${pathPrefix}.source.limit`"
          />
        </UFormField>
      </div>
    </template>

    <div class="grid min-w-0 gap-3 sm:grid-cols-2">
      <UFormField name="source.icon" label="Result icon" description="Optional allowlisted Lucide icon." class="min-w-0" :error="errorAt('source.icon')">
        <USelect v-model="sourceIcon" :items="iconItems" value-key="value" class="w-full" :data-validation-path="`${pathPrefix}.source.icon`" />
      </UFormField>
      <UFormField name="source.badge" label="Result badge" description="Optional bounded text shared by expanded results." class="min-w-0" :error="errorAt('source.badge')">
        <UInput v-model="sourceBadge" class="w-full" maxlength="24" placeholder="New" :data-validation-path="`${pathPrefix}.source.badge`" />
      </UFormField>
    </div>
  </div>
</template>
