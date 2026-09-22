<script setup lang="ts">
import { h } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { UBadge, UAvatar, NuxtLink } from '#components'

definePageMeta({
  layout: 'desk'
})

const route = useRoute()
const schemaKey = computed(() => String(route.params.schemaKey))
const status = ref<string>('all')
const SORT_DEFAULT = '__default__'
const sortField = ref<string>(SORT_DEFAULT)
const sortDir = ref<'asc' | 'desc'>('desc')
const locale = useDisplayLocale()

const { data: schema } = await useFetch<any>(() => `/api/schema/${schemaKey.value}/active`)

type ContentRow = {
  id: string
  title: string | null
  description: string | null
  image: string | null
  status: string
  createdAt: string
  updatedAt: string
  searchData?: Record<string, string | number | null>
}

type SearchMode = 'off' | 'exact' | 'range' | 'exact_set'
type SearchField = {
  fieldId: string
  key: string
  kind: string
  title?: string
  enumValues?: Array<{ label: string; value: string }>
  search?: { mode?: SearchMode; filterable?: boolean; sortable?: boolean }
}

type NormalizedField = SearchField & {
  searchMode: SearchMode
  filterable: boolean
  sortable: boolean
}

type FilterInput = {
  field: string
  op?: 'exact' | 'range' | 'exact_set'
  value?: unknown
  values?: unknown
  min?: unknown
  max?: unknown
}

type FieldState = {
  value: string
  values: string
  min: string
  max: string
  bool: 'any' | 'true' | 'false'
  enumValues: string[]
}

const SEARCH_MODES_BY_KIND: Record<string, SearchMode[]> = {
  string: ['off', 'exact', 'exact_set'],
  text: ['off', 'exact', 'exact_set'],
  richtext: ['off'],
  url: ['off', 'exact', 'exact_set'],
  enum: ['off', 'exact', 'exact_set'],
  boolean: ['off', 'exact', 'exact_set'],
  number: ['off', 'exact', 'range'],
  integer: ['off', 'exact', 'range'],
  date: ['off', 'exact', 'range'],
  datetime: ['off', 'exact', 'range'],
  reference: ['off'],
  asset: ['off']
}

const FILTERABLE_KINDS = new Set([
  'string',
  'text',
  'url',
  'enum',
  'boolean',
  'number',
  'integer',
  'date',
  'datetime'
])

const SORTABLE_KINDS = new Set([
  'string',
  'url',
  'enum',
  'boolean',
  'number',
  'integer',
  'date',
  'datetime'
])

function normalizeSearchMode(kind: string, mode?: SearchMode): SearchMode {
  const allowed = SEARCH_MODES_BY_KIND[kind] ?? ['off']
  if (mode && allowed.includes(mode)) return mode
  return 'off'
}

function normalizeSearchConfig(field: SearchField): NormalizedField {
  const searchMode = normalizeSearchMode(field.kind, field.search?.mode)
  const filterable = FILTERABLE_KINDS.has(field.kind) && !!field.search?.filterable && searchMode !== 'off'
  const sortable = SORTABLE_KINDS.has(field.kind) && !!field.search?.sortable && searchMode !== 'off'
  return { ...field, searchMode, filterable, sortable }
}

const normalizedFields = computed<NormalizedField[]>(() => {
  const raw = (schema.value?.registry?.fields ?? []) as SearchField[]
  return raw.map(normalizeSearchConfig)
})

const filterableFields = computed(() => normalizedFields.value.filter(field => field.filterable))
const sortableFields = computed(() => normalizedFields.value.filter(field => field.sortable))
const displayFields = computed(() => normalizedFields.value.filter(field => {
  const enabled = field.searchMode !== 'off' || field.filterable || field.sortable
  if (!enabled) return false
  if (field.key === 'title' || field.key === 'created_at' || field.key === 'updated_at') return false
  return true
}))
const displayFieldKeys = computed(() => displayFields.value.map(field => field.key))

const filterState = reactive<Record<string, FieldState>>({})

function ensureFieldState(field: NormalizedField): FieldState {
  if (!filterState[field.key]) {
    filterState[field.key] = { value: '', values: '', min: '', max: '', bool: 'any', enumValues: [] }
  }
  return filterState[field.key]!
}

watch(filterableFields, (fields) => {
  for (const field of fields) ensureFieldState(field)
}, { immediate: true })

const appliedFilters = ref<FilterInput[]>([])
const appliedStatus = ref<string>('all')
const appliedSortField = ref<string>('')
const appliedSortDir = ref<'asc' | 'desc'>('desc')

const query = computed(() => ({
  schemaKey: schemaKey.value,
  status: appliedStatus.value !== 'all' ? appliedStatus.value : undefined,
  sortField: appliedSortField.value || undefined,
  sortDir: appliedSortField.value ? appliedSortDir.value : undefined,
  filters: appliedFilters.value.length ? JSON.stringify(appliedFilters.value) : undefined,
  fields: displayFieldKeys.value.length ? displayFieldKeys.value.join(',') : undefined,
  limit: 50
}))

const { data, pending, refresh } = await useFetch<{ items: ContentRow[]; nextCursor: string | null }>(
  () => '/api/search',
  { query }
)

const items = computed(() => data.value?.items ?? [])

const statusOptions = [
  { label: 'all', value: 'all' },
  { label: 'draft', value: 'draft' },
  { label: 'published', value: 'published' },
  { label: 'archived', value: 'archived' },
  { label: 'deleted', value: 'deleted' }
]

const sortOptions = computed(() => [
  { label: 'Updated (default)', value: SORT_DEFAULT },
  ...sortableFields.value.map(field => ({
    label: field.title || field.key,
    value: field.key
  }))
])

const sortDirOptions = [
  { label: 'Newest first', value: 'desc' },
  { label: 'Oldest first', value: 'asc' }
]

const booleanOptions = [
  { label: 'Any', value: 'any' },
  { label: 'True', value: 'true' },
  { label: 'False', value: 'false' }
]

type EnumOption = { label: string; value: string }

function enumOptions(fieldKey: string): EnumOption[] {
  const astField = (schema.value?.ast?.fields ?? []).find((f: any) => f?.key === fieldKey)
  const fromAst = Array.isArray(astField?.enumValues) ? astField.enumValues : null
  if (fromAst?.length) {
    return fromAst
      .map((opt: any) => ({
        label: opt?.label || opt?.value || String(opt ?? ''),
        value: String(opt?.value ?? opt ?? '')
      }))
      .filter((opt: EnumOption) => opt.value)
  }

  const regField = (schema.value?.registry?.fields ?? []).find((f: any) => f?.key === fieldKey)
  const fromRegistry = Array.isArray(regField?.enumValues) ? regField.enumValues : null
  if (fromRegistry?.length) {
    return fromRegistry
      .map((opt: any) => ({
        label: opt?.label || opt?.value || String(opt ?? ''),
        value: String(opt?.value ?? opt ?? '')
      }))
      .filter((opt: EnumOption) => opt.value)
  }

  const enums = schema.value?.jsonSchema?.properties?.[fieldKey]?.enum
  if (!Array.isArray(enums)) return []
  return enums.map((value: string) => ({ label: value, value }))
}

const enumLabelMap = computed(() => {
  const map = new Map<string, Map<string, string>>()
  for (const field of normalizedFields.value) {
    if (field.kind !== 'enum') continue
    const options = enumOptions(field.key)
    map.set(field.key, new Map(options.map((opt) => [String(opt.value), opt.label])))
  }
  return map
})

function formatSearchValue(field: NormalizedField, value: string | number | null | undefined) {
  if (value == null || value === '') return ''
  if (field.kind === 'boolean') {
    const bool = typeof value === 'number' ? value !== 0 : value === 'true'
    return bool ? 'True' : 'False'
  }
  if (field.kind === 'enum') {
    const label = enumLabelMap.value.get(field.key)?.get(String(value))
    return label || String(value)
  }
  if (field.kind === 'date' || field.kind === 'datetime') {
    const formatted = field.kind === 'date'
      ? formatDate(value as any, locale.value)
      : formatDateTime(value as any, locale.value)
    return formatted || String(value)
  }
  return String(value)
}

function isRangeField(field: NormalizedField) {
  return field.searchMode === 'range'
}

function isExactSetField(field: NormalizedField) {
  return field.searchMode === 'exact_set'
}

function inputTypeForField(field: NormalizedField, exactSet = false) {
  if (exactSet) return 'text'
  if (field.kind === 'number' || field.kind === 'integer') return 'number'
  if (field.kind === 'date') return 'date'
  if (field.kind === 'datetime') return 'datetime-local'
  return 'text'
}

function buildExactSetValues(field: NormalizedField, raw: string) {
  const values = raw.split(',').map(v => v.trim()).filter(Boolean)
  if (field.kind !== 'boolean') return values
  return values
    .map(v => (v === 'true' ? true : v === 'false' ? false : null))
    .filter(v => v != null)
}

function buildFilters(): FilterInput[] {
  const filters: FilterInput[] = []
  for (const field of filterableFields.value) {
    const state = ensureFieldState(field)

    if (field.kind === 'boolean' && field.searchMode !== 'range') {
      if (state.bool === 'true') {
        filters.push({ field: field.key, op: 'exact', value: true })
      } else if (state.bool === 'false') {
        filters.push({ field: field.key, op: 'exact', value: false })
      }
      continue
    }

    if (field.kind === 'enum') {
      if (state.enumValues.length) {
        filters.push({ field: field.key, op: 'exact_set', values: state.enumValues })
      }
      continue
    }

    if (isRangeField(field)) {
      const min = state.min.trim()
      const max = state.max.trim()
      if (min || max) {
        filters.push({
          field: field.key,
          op: 'range',
          min: min || undefined,
          max: max || undefined
        })
      }
      continue
    }

    if (isExactSetField(field)) {
      const raw = state.values.trim()
      if (!raw) continue
      const values = buildExactSetValues(field, raw)
      if (values.length) {
        filters.push({ field: field.key, op: 'exact_set', values })
      }
      continue
    }

    const value = state.value.trim()
    if (!value) continue
    filters.push({ field: field.key, op: 'exact', value })
  }
  return filters
}

function fieldState(field: NormalizedField): FieldState {
  return ensureFieldState(field)
}

function applySearch() {
  appliedStatus.value = status.value
  appliedSortField.value = sortField.value === SORT_DEFAULT ? '' : sortField.value
  appliedSortDir.value = sortField.value === SORT_DEFAULT ? 'desc' : sortDir.value
  appliedFilters.value = buildFilters()
}

function resetFilters() {
  status.value = 'all'
  sortField.value = SORT_DEFAULT
  sortDir.value = 'desc'
  for (const key of Object.keys(filterState)) {
    filterState[key] = { value: '', values: '', min: '', max: '', bool: 'any', enumValues: [] }
  }
  appliedFilters.value = []
  appliedStatus.value = 'all'
  appliedSortField.value = ''
  appliedSortDir.value = 'desc'
}

const columns = computed<TableColumn<ContentRow>[]>(() => {
  const base: TableColumn<ContentRow>[] = [
    {
      accessorKey: 'title',
      header: 'Title',
      meta: {
        class: { td: 'max-w-[28rem] sm:max-w-[36rem] lg:max-w-[44rem]' }
      },
      cell: ({ row }) => {
        const title = row.original.title || row.original.id
        return h('div', { class: 'flex items-center gap-3 min-w-0' }, [
          h(UAvatar, {
            size: 'lg',
            src: row.original.image || undefined,
            icon: 'i-lucide-image',
            loading: 'lazy',
            class: 'shrink-0'
          }),
          h('div', { class: 'min-w-0 flex-1' }, [
            h(NuxtLink, {
              to: `/_desk/content/${schemaKey.value}/${row.original.id}`,
              class: 'block text-highlighted hover:underline font-medium truncate'
            }, () => title),
            row.original.description
              ? h('p', { class: 'max-w-full line-clamp-2 whitespace-normal text-sm text-muted' }, row.original.description)
              : null
          ])
        ])
      }
    }
  ]

  const dynamic: TableColumn<ContentRow>[] = displayFields.value.map((field) => ({
    id: `field-${field.key}`,
    header: field.title || field.key,
    meta: { class: { td: 'max-w-[14rem] truncate' } },
    cell: ({ row }) => {
      const searchData = row.original.searchData ?? {}
      const value = searchData[field.key] ?? null
      const label = formatSearchValue(field, value)
      return h('span', { class: 'text-sm text-muted truncate' }, label)
    }
  }))

  const tail: TableColumn<ContentRow>[] = [
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const current = row.getValue('status') as string
        const color = ({
          published: 'success',
          draft: 'warning',
          archived: 'neutral',
          deleted: 'error'
        } as const)[current] ?? 'neutral'

        return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () => current)
      }
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ row }) => formatDateTime(row.getValue('updatedAt') as string, locale.value)
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      meta: { class: { th: 'text-right', td: 'text-right' } },
      cell: ({ row }) => h('time', {
        datetime: row.original.createdAt,
        class: 'text-sm text-muted'
      }, formatDateTime(row.getValue('createdAt') as string, locale.value))
    }
  ]

  return [...base, ...dynamic, ...tail]
})
</script>

<template>
  <UDashboardPanel id="desk-content-list">
    <template #header>
      <DeskNavbar
        :title="schema?.title || schemaKey"
        description="Create, review, and publish entries."
      >
        <template #actions>
          <UButton
            :to="`/_desk/content/${schemaKey}/new`"
            icon="i-lucide-plus"
            aria-label="New"
          >
            <span class="hidden sm:inline">New {{ schema?.title || schemaKey }}</span>
          </UButton>
        </template>
      </DeskNavbar>

      <UDashboardToolbar :ui="{ left: 'flex flex-wrap items-start gap-2' }">
        <template #left>
          <div class="flex flex-wrap items-center gap-2 p-2">
            <USelect
              v-model="status"
              :items="statusOptions"
              class="w-40"
            />
            <USelect
              v-model="sortField"
              :items="sortOptions"
              class="w-56"
            />
            <USelect
              v-model="sortDir"
              :items="sortDirOptions"
              class="w-40"
              :disabled="sortField === SORT_DEFAULT"
            />
            <UButton color="primary" @click="applySearch">
              Search
            </UButton>
            <UButton color="neutral" variant="outline" @click="resetFilters">
              Reset
            </UButton>
          </div>

          <div v-if="filterableFields.length" class="flex flex-wrap gap-4 p-2">
            <div
              v-for="field in filterableFields"
              :key="field.fieldId"
              class="flex min-w-[12rem] flex-col gap-1"
            >
              <UFormField :label="field.title || field.key">
                <template v-if="field.kind === 'boolean' && field.searchMode !== 'range'">
                  <USelect
                    v-model="fieldState(field).bool"
                    :items="booleanOptions"
                    class="w-full"
                  />
                </template>
                <template v-else-if="isRangeField(field)">
                  <div class="flex items-center gap-2">
                    <UInput
                      v-model="fieldState(field).min"
                      :type="inputTypeForField(field)"
                      placeholder="Min"
                      class="w-28"
                    />
                    <span class="text-muted">~</span>
                    <UInput
                      v-model="fieldState(field).max"
                      :type="inputTypeForField(field)"
                      placeholder="Max"
                      class="w-28"
                    />
                  </div>
                </template>
                <template v-else-if="field.kind === 'enum'">
                  <UCheckboxGroup
                    v-model="fieldState(field).enumValues"
                    :items="enumOptions(field.key)"
                    value-key="value"
                    label-key="label"
                    orientation="horizontal"
                    variant="list"
                  />
                </template>
                <template v-else-if="isExactSetField(field)">
                  <UInput
                    v-model="fieldState(field).values"
                    :type="inputTypeForField(field, true)"
                    placeholder="Comma-separated"
                    class="w-full"
                  />
                </template>
                <template v-else>
                  <UInput
                    v-model="fieldState(field).value"
                    :type="inputTypeForField(field)"
                    placeholder="Value"
                    class="w-full"
                  />
                </template>
              </UFormField>
            </div>
          </div>
        </template>
        <template #right>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-cw"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <UTable
        :data="items || []"
        :columns="columns"
        :loading="pending"
        empty="No content found."
        class="w-full"
      />
    </template>
  </UDashboardPanel>
</template>
