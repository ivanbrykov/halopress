<script setup lang="ts">
import { ulid } from 'ulid'
import { z } from 'zod'
import type { SortableEvent } from 'sortablejs'
import { useSortable } from '@vueuse/integrations/useSortable'
import type { BreadcrumbItem, NavigationMenuItem } from '@nuxt/ui'
import { isReservedSchemaKey, PUBLIC_PAGE_ROUTE_PREFIX } from '~~/shared/public-routing'
import {
  defaultSearchModeForFieldKind,
  FILTERABLE_FIELD_KINDS,
  FULL_TEXT_FIELD_KINDS,
  SEARCH_MODES_BY_FIELD_KIND,
  SORTABLE_FIELD_KINDS
} from '~~/shared/search-field-capabilities'

definePageMeta({
  layout: 'desk'
})

type FieldKind =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'url'
  | 'enum'
  | 'richtext'
  | 'reference'
  | 'asset'
  | 'asset_list'

type FieldNode = {
  id: string
  key: string
  kind: FieldKind
  title?: string
  description?: string
  required?: boolean
  enumValues?: { label: string; value: string }[]
  search?: {
    mode?: 'off' | 'exact' | 'range' | 'exact_set'
    filterable?: boolean
    sortable?: boolean
    fullText?: boolean
  }
  rel?: {
    kind: 'ref' | 'ref_list' | 'poly_ref' | 'asset_ref'
    target: string
    cardinality: 'one' | 'many'
  }
  assetList?: { minItems?: number; maxItems?: number }
  system?: boolean
}

type SchemaAst = {
  fields: FieldNode[]
  listing?: {
    titleFieldKey?: string | null
    descriptionFieldKey?: string | null
    imageFieldKey?: string | null
  }
  presentation?: {
    contractVersion: 1
    preset: 'generic' | 'article' | 'catalog'
    collectionTemplate: 'list' | 'cards' | 'catalog-grid'
    detailTemplate: 'document' | 'article' | 'catalog'
    layoutId?: string
    slugFieldId?: string
    structuredDataType?: 'WebPage' | 'Article' | 'BlogPosting' | 'NewsArticle' | 'Product'
    slots: Partial<Record<'title' | 'description' | 'image' | 'body' | 'gallery' | 'price', string>>
  }
}

function stableStringify(value: any): string {
  const seen = new WeakSet()
  const normalize = (v: any): any => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return null
    seen.add(v)
    if (Array.isArray(v)) return v.map(normalize)
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k])
    return out
  }
  return JSON.stringify(normalize(value))
}

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirmDialog()

const routeKey = computed(() => String(route.params.schemaKey))
const isNew = computed(() => routeKey.value === 'new')

const toolbarItems = computed<NavigationMenuItem[]>(() => ([
  {
    label: 'Schema',
    icon: 'i-lucide-braces',
    to: `/_desk/schemas/${routeKey.value}`,
    active: !route.path.endsWith('/settings')
  },
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: `/_desk/schemas/${routeKey.value}/settings`,
    active: route.path.endsWith('/settings'),
    disabled: isNew.value
  }
]))

const schemaMetaFormRef = ref<any>(null)
const addFieldFormRef = ref<any>(null)
const editFieldFormRef = ref<any>(null)

const schemaKeyPattern = /^[a-z0-9][a-z0-9_]*$/
const fieldKeyPattern = /^[a-zA-Z][a-zA-Z0-9_]*$/

const schemaMetaSchema = z.object({
  schemaKey: z.string()
    .min(1, 'Schema key is required')
    .regex(schemaKeyPattern, 'Use lowercase letters, numbers, and underscores.')
    .refine(
      key => !isNew.value || !isReservedSchemaKey(key),
      `The schema key "${PUBLIC_PAGE_ROUTE_PREFIX}" is reserved for standalone pages.`
    ),
  title: z.string().optional(),
  description: z.string().optional()
}).loose()

const fieldDraftSchema = z.object({
  key: z.string().min(1, 'Key is required').regex(fieldKeyPattern, 'Use letters, numbers, and underscores. Must start with a letter.'),
  kind: z.string().min(1, 'Kind is required')
}).loose()

async function validateForm(form: any) {
  if (!form?.validate) return true
  try {
    await form.validate()
    return true
  } catch {
    return false
  }
}

const state = reactive({
  schemaKey: isNew.value ? '' : routeKey.value,
  title: '',
  description: '',
  fields: [] as FieldNode[],
  listing: {
    titleFieldKey: undefined as string | null | undefined,
    descriptionFieldKey: undefined as string | null | undefined,
    imageFieldKey: undefined as string | null | undefined
  },
  presentation: {
    contractVersion: 1 as const,
    preset: 'generic' as 'generic' | 'article' | 'catalog',
    collectionTemplate: 'list' as 'list' | 'cards' | 'catalog-grid',
    detailTemplate: 'document' as 'document' | 'article' | 'catalog',
    layoutId: undefined as string | undefined,
    slugFieldId: undefined as string | undefined,
    structuredDataType: 'WebPage' as 'WebPage' | 'Article' | 'BlogPosting' | 'NewsArticle' | 'Product',
    slots: {} as Partial<Record<'title' | 'description' | 'image' | 'body' | 'gallery' | 'price', string>>
  }
})

const SYSTEM_FIELDS: FieldNode[] = [
  {
    id: '__system_created_at',
    key: 'created_at',
    kind: 'datetime',
    title: 'Created at',
    required: false,
    search: { mode: 'off', filterable: false, sortable: false, fullText: false },
    system: true
  },
  {
    id: '__system_updated_at',
    key: 'updated_at',
    kind: 'datetime',
    title: 'Updated at',
    required: false,
    search: { mode: 'off', filterable: false, sortable: false, fullText: false },
    system: true
  }
]

const SYSTEM_FIELD_KEYS = new Set(SYSTEM_FIELDS.map(field => field.key))

function createDefaultTitleField(): FieldNode {
  return {
    id: ulid(),
    key: 'title',
    kind: 'string',
    title: 'Title',
    required: false,
    search: { mode: 'off', filterable: false, sortable: false, fullText: false },
    system: false
  }
}

function inferListingSelection(fields: FieldNode[]) {
  const contentFields = fields.filter(field => !field.system)

  const findByExactKey = (keys: string[], allowedKinds: FieldKind[]) => {
    for (const key of keys) {
      const match = contentFields.find(field => field.key === key && allowedKinds.includes(field.kind))
      if (match) return match.key
    }
    return null
  }

  const findFirstByKind = (allowedKinds: FieldKind[]) => {
    const match = contentFields.find(field => allowedKinds.includes(field.kind))
    return match?.key ?? null
  }

  return {
    titleFieldKey: findByExactKey(['title'], ['string', 'text'])
      ?? findFirstByKind(['string'])
      ?? findFirstByKind(['text']),
    descriptionFieldKey: findByExactKey(['description', 'summary', 'excerpt'], ['text', 'richtext'])
      ?? findFirstByKind(['text'])
      ?? findFirstByKind(['richtext']),
    imageFieldKey: findByExactKey(['image', 'thumbnail', 'cover', 'gallery'], ['asset', 'asset_list'])
      ?? findFirstByKind(['asset', 'asset_list'])
  }
}

function toListingStateValue(value: string | null) {
  return value ?? undefined
}

function resolveListingPreviewValue(current: string | null | undefined, fallback: string | null) {
  return current === undefined ? fallback : current
}

function applySystemFields(fields: FieldNode[]) {
  const byKey = new Map(fields.map(field => [field.key, field]))
  const systemFields = SYSTEM_FIELDS.map((sys) => {
    const existing = byKey.get(sys.key)
    return {
      ...sys,
      ...(existing ? { required: existing.required, search: existing.search } : {}),
      system: true
    }
  })
  const legacyTitle = fields.find(field => field.key === 'title' && !SYSTEM_FIELD_KEYS.has(field.key))
    ?? fields.find(field => field.key === 'title')
  const normalizedTitle = legacyTitle
    ? {
        ...legacyTitle,
        system: false,
        id: legacyTitle.id || ulid(),
        kind: 'string' as const
      }
    : createDefaultTitleField()
  const nonSystem = fields.filter(field => !SYSTEM_FIELD_KEYS.has(field.key) && field.key !== 'title')
  return [...systemFields, normalizedTitle, ...nonSystem]
}

if (isNew.value) {
  state.fields = applySystemFields([])
  const inferred = inferListingSelection(state.fields)
  Object.assign(state.listing, {
    titleFieldKey: toListingStateValue(inferred.titleFieldKey),
    descriptionFieldKey: toListingStateValue(inferred.descriptionFieldKey),
    imageFieldKey: toListingStateValue(inferred.imageFieldKey)
  })
}

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: 'Schemas', to: '/_desk/schemas' },
  { label: isNew.value ? 'New' : (state.title || state.schemaKey) }
]))

const fieldsRef = toRef(state, 'fields')

const addFieldModalOpen = ref(false)
const editFieldModalOpen = ref(false)
const publishConfirmOpen = ref(false)
const publishMigrate = ref(false)
const editingIndex = ref<number | null>(null)
const historyOpen = ref(false)
const conflictDetails = ref<Record<string, any> | null>(null)

function buildAstFromState() {
  return {
    schemaKey: state.schemaKey,
    title: state.title || state.schemaKey,
    description: state.description || undefined,
    fields: state.fields,
    listing: {
      titleFieldKey: state.listing.titleFieldKey,
      descriptionFieldKey: state.listing.descriptionFieldKey,
      imageFieldKey: state.listing.imageFieldKey
    },
    presentation: deepClone(state.presentation)
  }
}

const lastSavedAstJson = ref<string>(stableStringify(buildAstFromState()))
const currentAstJson = computed(() => stableStringify(buildAstFromState()))
const isDirty = computed(() => currentAstJson.value !== lastSavedAstJson.value)
const canSaveDraft = computed(() => !!state.schemaKey && isDirty.value && !saving.value)
const canPublish = computed(() => !!state.schemaKey && (isDirty.value || hasUnpublishedDraft.value) && !publishing.value)

useUnsavedNavigationGuard(isDirty, 'You have unsaved Schema changes. Leave and discard them?')

const lastSort = ref<{ oldIndex: number | null; newIndex: number | null } | null>(null)

function moveField(from: number, to: number) {
  if (from === to) return
  const list = state.fields
  if (from < 0 || from >= list.length) return
  if (to < 0) to = 0
  if (to > list.length) to = list.length
  const [item] = list.splice(from, 1)
  if (item === undefined) return
  list.splice(to, 0, item)
}

const sortable = useSortable('.hp-sort-list', fieldsRef, {
  handle: '.hp-sort-handle',
  draggable: '.hp-sort-item:not([data-locked="true"])',
  animation: 150,
  ghostClass: 'hp-sort-ghost',
  chosenClass: 'hp-sort-chosen',
  dragClass: 'hp-sort-drag',
  onUpdate: (e: SortableEvent) => {
    lastSort.value = { oldIndex: e.oldIndex ?? null, newIndex: e.newIndex ?? null }
    if (e.oldIndex == null || e.newIndex == null) return
    if (import.meta.dev) console.debug('[schema-sort] update', e.oldIndex, e.newIndex)
    moveField(e.oldIndex, e.newIndex)
  },
  disabled: false
})

onMounted(() => {
  nextTick(() => {
    sortable.start()
    sortable.option('disabled', addFieldModalOpen.value || editFieldModalOpen.value)
  })
})

watch([addFieldModalOpen, editFieldModalOpen], ([addOpen, editOpen]) => {
  sortable.option('disabled', addOpen || editOpen)
})

const { data: activeSchemas } = await useFetch<{ items: Array<{ schemaKey: string; title?: string }> }>('/api/schema/list')

const { data: draft, refresh: refreshDraft } = await useFetch<any>(() => `/api/schema/${routeKey.value}/draft`)
const currentRevision = computed(() => Number(draft.value?.revision ?? 0))

const activeFetch = isNew.value
  ? { data: ref<any>(null), refresh: async () => {} }
  : await useFetch<any>(() => `/api/schema/${routeKey.value}/definition`)

const active = activeFetch.data
const refreshActive = activeFetch.refresh

const hasUnpublishedDraft = computed(() => {
  if (isNew.value) return false
  if (!draft.value) return false
  if (!active.value) return true
  return stableStringify(active.value.ast) !== currentAstJson.value
})

function deepClone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

watch(
  () => draft.value,
  (next) => {
    if (isNew.value) return
    if (!next) return
    state.schemaKey = next.schemaKey
    state.title = next.ast?.title ?? next.title ?? next.schemaKey
    state.description = next.ast?.description ?? ''
    state.fields = applySystemFields(deepClone(next.ast?.fields ?? []))
    const nextListing = next.ast?.listing
    Object.assign(state.listing, {
      titleFieldKey: nextListing?.titleFieldKey,
      descriptionFieldKey: nextListing?.descriptionFieldKey,
      imageFieldKey: nextListing?.imageFieldKey
    })
    const nextPresentation = deepClone(next.ast?.presentation ?? {
      contractVersion: 1,
      preset: 'generic',
      collectionTemplate: 'list',
      detailTemplate: 'document',
      slots: {}
    })
    for (const key of Object.keys(state.presentation)) delete (state.presentation as Record<string, unknown>)[key]
    Object.assign(state.presentation, nextPresentation)
    lastSavedAstJson.value = stableStringify(buildAstFromState())
  },
  { immediate: true }
)

watch(
  () => state.fields.map(field => `${field.key}:${field.kind}:${field.system ? '1' : '0'}`),
  () => {
    const inferred = inferListingSelection(state.fields)
    const fieldKeys = new Set(state.fields.filter(field => !field.system).map(field => field.key))

    if (state.listing.titleFieldKey !== null && (!state.listing.titleFieldKey || !fieldKeys.has(state.listing.titleFieldKey))) {
      state.listing.titleFieldKey = toListingStateValue(inferred.titleFieldKey)
    }
    if (state.listing.descriptionFieldKey !== null && (!state.listing.descriptionFieldKey || !fieldKeys.has(state.listing.descriptionFieldKey))) {
      state.listing.descriptionFieldKey = toListingStateValue(inferred.descriptionFieldKey)
    }
    if (state.listing.imageFieldKey !== null && (!state.listing.imageFieldKey || !fieldKeys.has(state.listing.imageFieldKey))) {
      state.listing.imageFieldKey = toListingStateValue(inferred.imageFieldKey)
    }
    const fieldIds = new Set(state.fields.filter(field => !field.system).map(field => field.id))
    if (state.presentation.slugFieldId && !fieldIds.has(state.presentation.slugFieldId)) {
      state.presentation.slugFieldId = undefined
    }
  },
  { immediate: true }
)

const fieldDraft = reactive<any>({
  id: '',
  key: '',
  kind: 'string',
  title: '',
  description: '',
  required: false,
  enumValues: [] as any[],
  search: { mode: 'off', filterable: false, sortable: false, fullText: false },
  relTarget: 'system:User',
  relCardinality: 'one',
  minItems: 0,
  maxItems: undefined as number | undefined,
  system: false
})

const editDraft = reactive<any>({
  id: '',
  key: '',
  kind: 'string',
  title: '',
  description: '',
  required: false,
  enumValues: [] as any[],
  search: { mode: 'off', filterable: false, sortable: false, fullText: false },
  relTarget: 'system:User',
  relCardinality: 'one',
  minItems: 0,
  maxItems: undefined as number | undefined,
  system: false
})

const editKindSnapshot = ref<string | null>(null)
const skipKindConfirm = ref(false)

watch(editFieldModalOpen, (open) => {
  if (!open) {
    editingIndex.value = null
    editKindSnapshot.value = null
    return
  }
  editKindSnapshot.value = editDraft.kind
})

watch(publishConfirmOpen, (open) => {
  if (!open) publishMigrate.value = false
})

watch(
  () => editDraft.kind,
  async (next) => {
    if (!editFieldModalOpen.value) return
    if (skipKindConfirm.value) {
      skipKindConfirm.value = false
      return
    }
    if (!editKindSnapshot.value) {
      editKindSnapshot.value = next
      return
    }
    if (next === editKindSnapshot.value) return
    const ok = await confirm({
      title: 'Change field kind?',
      body: 'Changing the field kind can invalidate existing content. You can optionally migrate existing content when publishing.',
      confirmLabel: 'Change',
      confirmColor: 'warning'
    })
    if (!ok) {
      skipKindConfirm.value = true
      editDraft.kind = editKindSnapshot.value
      return
    }
    editKindSnapshot.value = next
  }
)

const fieldKindOptions = [
  { label: 'String', value: 'string' },
  { label: 'Text', value: 'text' },
  { label: 'Richtext (u-editor)', value: 'richtext' },
  { label: 'Enum', value: 'enum' },
  { label: 'Number', value: 'number' },
  { label: 'Integer', value: 'integer' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Date', value: 'date' },
  { label: 'Datetime', value: 'datetime' },
  { label: 'URL', value: 'url' },
  { label: 'Reference', value: 'reference' },
  { label: 'Asset', value: 'asset' },
  { label: 'Asset list', value: 'asset_list' }
]

const fieldKindIcon: Record<string, string> = {
  string: 'i-lucide-text-cursor-input',
  text: 'i-lucide-align-left',
  richtext: 'i-lucide-pen-line',
  enum: 'i-lucide-list',
  number: 'i-lucide-hash',
  integer: 'i-lucide-binary',
  boolean: 'i-lucide-toggle-left',
  date: 'i-lucide-calendar',
  datetime: 'i-lucide-calendar-clock',
  url: 'i-lucide-link',
  reference: 'i-lucide-link',
  asset: 'i-lucide-image',
  asset_list: 'i-lucide-images'
}

function getFieldKindIcon(kind: string) {
  return fieldKindIcon[kind] ?? 'i-lucide-square-library'
}

const searchModeLabel = {
  off: 'Off',
  exact: 'Exact',
  exact_set: 'Exact set',
  range: 'Range'
}

const searchModeOptionsByKind = Object.fromEntries(
  Object.entries(SEARCH_MODES_BY_FIELD_KIND).map(([kind, modes]) => [
    kind,
    modes.map(value => ({ label: searchModeLabel[value], value }))
  ])
)

const filterableKinds = FILTERABLE_FIELD_KINDS
const sortableKinds = SORTABLE_FIELD_KINDS
const fullTextKinds = FULL_TEXT_FIELD_KINDS

function fieldOptionsByKind(kinds: FieldKind[]) {
  return state.fields
    .filter(field => !field.system && kinds.includes(field.kind))
    .map(field => ({
      label: field.title || field.key,
      value: field.key,
      description: field.title && field.title !== field.key ? field.key : field.kind
    }))
}

const listingFieldOptions = computed(() => ({
  title: fieldOptionsByKind(['string', 'text']),
  description: fieldOptionsByKind(['text', 'richtext']),
  image: fieldOptionsByKind(['asset', 'asset_list'])
}))

const listingPreview = computed(() => {
  const inferred = inferListingSelection(state.fields)
  return {
    titleFieldKey: resolveListingPreviewValue(state.listing.titleFieldKey, inferred.titleFieldKey),
    descriptionFieldKey: resolveListingPreviewValue(state.listing.descriptionFieldKey, inferred.descriptionFieldKey),
    imageFieldKey: resolveListingPreviewValue(state.listing.imageFieldKey, inferred.imageFieldKey)
  }
})

function findListingPreviewField(key: string | null) {
  if (!key) return null
  return state.fields.find(field => field.key === key) ?? null
}

const listingPreviewFields = computed(() => ({
  title: findListingPreviewField(listingPreview.value.titleFieldKey),
  description: findListingPreviewField(listingPreview.value.descriptionFieldKey),
  image: findListingPreviewField(listingPreview.value.imageFieldKey)
}))

function getSearchModeOptions(kind: string) {
  return searchModeOptionsByKind[kind] ?? [{ label: 'Off', value: 'off' }]
}

function normalizeSearchDraft(draft: any) {
  if (!draft.search) draft.search = { mode: 'off', filterable: false, sortable: false, fullText: false }
  const allowed = getSearchModeOptions(draft.kind).map(o => o.value)
  if (!allowed.includes(draft.search.mode)) draft.search.mode = 'off'
  if (!filterableKinds.has(draft.kind)) draft.search.filterable = false
  if (!sortableKinds.has(draft.kind)) draft.search.sortable = false
  if (!fullTextKinds.has(draft.kind)) draft.search.fullText = false
  if (draft.search.mode === 'off') {
    draft.search.filterable = false
    draft.search.sortable = false
  }
}

function formatKindLabel(kind: string, cardinality?: string) {
  if (kind === 'reference') return `reference (${cardinality || 'one'})`
  return kind
}

type KindChange = {
  id: string
  key: string
  title: string
  fromKind: FieldNode['kind']
  toKind: FieldNode['kind']
  fromCardinality: string
  toCardinality: string
  fromLabel: string
  toLabel: string
}

const kindChanges = computed(() => {
  const prevAst = active.value?.ast as SchemaAst | undefined
  if (!prevAst) return []
  const prevById = new Map<string, FieldNode>(prevAst.fields.map(field => [field.id, field]))

  return state.fields
    .map((field): KindChange | null => {
      const prev = prevById.get(field.id)
      if (!prev) return null
      const prevCardinality = prev.rel?.cardinality ?? 'one'
      const nextCardinality = field.rel?.cardinality ?? 'one'
      const refCardinalityChanged = prev.kind === 'reference' && field.kind === 'reference' && prevCardinality !== nextCardinality
      if (prev.kind === field.kind && !refCardinalityChanged) return null
      return {
        id: field.id,
        key: field.key,
        title: field.title || field.key,
        fromKind: prev.kind,
        toKind: field.kind,
        fromCardinality: prevCardinality,
        toCardinality: nextCardinality,
        fromLabel: formatKindLabel(prev.kind, prevCardinality),
        toLabel: formatKindLabel(field.kind, nextCardinality)
      }
    })
    .filter((change): change is KindChange => Boolean(change))
})

const contentSchemaOptions = computed(() => (activeSchemas.value?.items ?? []).map((s: any) => ({
  label: s.title ?? s.schemaKey,
  value: s.schemaKey
})))

function openNewField() {
  Object.assign(fieldDraft, {
    id: ulid(),
    key: '',
    kind: 'string',
    title: '',
    description: '',
    required: false,
    enumValues: [],
    search: { mode: 'off', filterable: false, sortable: false, fullText: false },
    relTarget: 'system:User',
    relCardinality: 'one',
    minItems: 0,
    maxItems: undefined,
    system: false
  })
  normalizeSearchDraft(fieldDraft)
  addFieldModalOpen.value = true
}

function startEditField(index: number) {
  const f = state.fields[index]!
  const cloned = JSON.parse(JSON.stringify(f))
  Object.assign(editDraft, {
    id: cloned.id,
    key: cloned.key,
    kind: cloned.kind,
    title: cloned.title ?? '',
    description: cloned.description ?? '',
    required: !!cloned.required,
    enumValues: cloned.enumValues ?? [],
    search: cloned.search ?? { mode: 'off', filterable: false, sortable: false, fullText: false },
    relTarget: cloned.rel?.target ?? 'system:User',
    relCardinality: cloned.rel?.cardinality ?? 'one',
    minItems: cloned.assetList?.minItems ?? 0,
    maxItems: cloned.assetList?.maxItems,
    system: !!cloned.system
  })
  normalizeSearchDraft(editDraft)
  editingIndex.value = index
  editFieldModalOpen.value = true
}

function closeEditModal() {
  editFieldModalOpen.value = false
  editingIndex.value = null
}

function removeField(index: number) {
  if (editingIndex.value === index) closeEditModal()
  if (editingIndex.value !== null && editingIndex.value > index) editingIndex.value -= 1
  if (state.fields[index]?.system) return
  state.fields.splice(index, 1)
}

async function confirmRemoveField(index: number) {
  const field = state.fields[index]
  if (!field || field.system) return
  const ok = await confirm({
    title: 'Remove field',
    body: 'This change only affects the draft until you publish.',
    confirmLabel: 'Remove',
    confirmColor: 'error'
  })
  if (!ok) return
  removeField(index)
}

function normalizeFieldDraft(draft: any) {
  if (!draft.key) {
    toast.add({ title: 'Field key required', color: 'error' })
    return null
  }
  if (!draft.system && SYSTEM_FIELD_KEYS.has(draft.key)) {
    toast.add({ title: 'Reserved field key', description: `The key "${draft.key}" is reserved.`, color: 'error' })
    return null
  }
  const next = JSON.parse(JSON.stringify(draft))
  if (next.system) {
    const systemField = SYSTEM_FIELDS.find(field => field.key === next.key)
    if (systemField) {
      next.id = systemField.id
      next.kind = systemField.kind
      next.title = systemField.title
      next.description = systemField.description
      next.enumValues = systemField.enumValues
      next.rel = systemField.rel
    }
  }

  if (next.kind !== 'enum') delete next.enumValues
  if (next.kind !== 'reference' && next.kind !== 'asset' && next.kind !== 'asset_list') {
    delete next.relTarget
    delete next.relCardinality
  }
  if (next.kind !== 'asset_list') {
    delete next.assetList
    delete next.minItems
    delete next.maxItems
  }

  if (next.search) {
    normalizeSearchDraft(next)
    if (next.search.mode === 'off' && !next.search.filterable && !next.search.sortable && !next.search.fullText) {
      delete next.search
    }
  }

  if (next.kind === 'asset') {
    next.rel = { kind: 'asset_ref', target: 'system:Asset', cardinality: 'one', editMode: 'pick' }
    delete next.relTarget
    delete next.relCardinality
  }
  if (next.kind === 'asset_list') {
    next.rel = { kind: 'asset_ref', target: 'system:Asset', cardinality: 'many', editMode: 'pick' }
    next.assetList = {
      ...(Number.isInteger(next.minItems) && next.minItems > 0 ? { minItems: next.minItems } : {}),
      ...(Number.isInteger(next.maxItems) && next.maxItems > 0 ? { maxItems: next.maxItems } : {})
    }
    delete next.relTarget
    delete next.relCardinality
    delete next.minItems
    delete next.maxItems
  }
  if (next.kind === 'reference') {
    next.rel = {
      kind: next.relCardinality === 'many' ? 'ref_list' : 'ref',
      target: next.relTarget,
      cardinality: next.relCardinality,
      editMode: 'pick'
    }
    delete next.relTarget
    delete next.relCardinality
  }

  return next
}

watch(() => fieldDraft.kind, () => normalizeSearchDraft(fieldDraft))
watch(() => editDraft.kind, () => normalizeSearchDraft(editDraft))

watch(() => fieldDraft.search?.mode, (mode) => {
  if (!fieldDraft.search) return
  if (mode === 'off') {
    fieldDraft.search.filterable = false
    fieldDraft.search.sortable = false
  }
})

watch(() => editDraft.search?.mode, (mode) => {
  if (!editDraft.search) return
  if (mode === 'off') {
    editDraft.search.filterable = false
    editDraft.search.sortable = false
  }
})

watch(() => fieldDraft.search?.filterable, (val) => {
  if (!fieldDraft.search) return
  if (val && fieldDraft.search.mode === 'off') fieldDraft.search.mode = defaultSearchModeForFieldKind(fieldDraft.kind)
})

watch(() => fieldDraft.search?.sortable, (val) => {
  if (!fieldDraft.search) return
  if (val && fieldDraft.search.mode === 'off') fieldDraft.search.mode = defaultSearchModeForFieldKind(fieldDraft.kind)
})

watch(() => editDraft.search?.filterable, (val) => {
  if (!editDraft.search) return
  if (val && editDraft.search.mode === 'off') editDraft.search.mode = defaultSearchModeForFieldKind(editDraft.kind)
})

watch(() => editDraft.search?.sortable, (val) => {
  if (!editDraft.search) return
  if (val && editDraft.search.mode === 'off') editDraft.search.mode = defaultSearchModeForFieldKind(editDraft.kind)
})

async function addField() {
  if (!(await validateForm(addFieldFormRef.value))) return
  const next = normalizeFieldDraft(fieldDraft)
  if (!next) return
  state.fields.push(next)
  addFieldModalOpen.value = false
}

async function saveEdit() {
  if (!(await validateForm(editFieldFormRef.value))) return
  if (editingIndex.value === null) return
  const next = normalizeFieldDraft(editDraft)
  if (!next) return
  state.fields.splice(editingIndex.value, 1, next)
  closeEditModal()
}

const saving = ref(false)

function isConflict(error: any) {
  return error?.statusCode === 409 || error?.status === 409 || error?.response?.status === 409
}

function recordConflict(error: any) {
  const details = error?.data?.data ?? error?.data ?? {}
  conflictDetails.value = typeof details === 'object' ? details : {}
}

function handleMutationError(action: string, error: any) {
  if (isConflict(error)) {
    recordConflict(error)
    return
  }
  toast.add({ title: `${action} failed`, description: error?.statusMessage || 'Error', color: 'error' })
}

async function reloadLatest() {
  if (isDirty.value) {
    const ok = await confirm({
      title: 'Reload latest schema draft?',
      body: 'Your unsaved local changes will be discarded.',
      confirmLabel: 'Reload latest',
      confirmColor: 'warning'
    })
    if (!ok) return
  }
  await refreshDraft()
  conflictDetails.value = null
}

async function handleHistoryRestored() {
  await refreshDraft()
  conflictDetails.value = null
}

async function saveDraft() {
  if (!(await validateForm(schemaMetaFormRef.value))) return
  if (!state.schemaKey) {
    toast.add({ title: 'schemaKey required', color: 'error' })
    return
  }
  if (!isDirty.value) return
  saving.value = true
  try {
    const ast = buildAstFromState()
    await $fetch(`/api/schema/${state.schemaKey}/draft`, {
      method: 'POST',
      body: { revision: currentRevision.value, title: ast.title, ast, layoutId: state.presentation.layoutId ?? null }
    })
    lastSavedAstJson.value = stableStringify(ast)
    toast.add({ title: 'Draft saved' })
    if (isNew.value) await navigateTo(`/_desk/schemas/${state.schemaKey}`)
    await refreshDraft()
  } catch (e: any) {
    handleMutationError('Save', e)
  } finally {
    saving.value = false
  }
}

const publishing = ref(false)
async function performPublish(migrate: boolean) {
  if (!(await validateForm(schemaMetaFormRef.value))) return
  if (!state.schemaKey) {
    toast.add({ title: 'schemaKey required', color: 'error' })
    return
  }
  if (!isDirty.value && !hasUnpublishedDraft.value) return
  publishing.value = true
  try {
    const ast = buildAstFromState()
    let revision = currentRevision.value
    // If there are unsaved changes, persist them first so publish always reflects the latest editor state.
    if (isDirty.value) {
      const saved = await $fetch<{ revision?: number }>(`/api/schema/${state.schemaKey}/draft`, {
        method: 'POST',
        body: { revision, title: ast.title, ast, layoutId: state.presentation.layoutId ?? null }
      })
      revision = Number(saved?.revision ?? revision + 1)
      lastSavedAstJson.value = stableStringify(ast)
    }

    const res = await $fetch(`/api/schema/${state.schemaKey}/publish`, {
      method: 'POST',
      body: { revision, note: 'publish from desk', migrate }
    })
    toast.add({ title: 'Published', description: `v${(res as any).version}` })
    const targetPath = `/_desk/schemas/${state.schemaKey}`
    reloadNuxtApp({ path: targetPath })
    await Promise.allSettled([refreshDraft(), refreshActive()])
  } catch (e: any) {
    handleMutationError('Publish', e)
  } finally {
    publishing.value = false
  }
}

async function publish() {
  if (!(await validateForm(schemaMetaFormRef.value))) return
  if (!state.schemaKey) {
    toast.add({ title: 'schemaKey required', color: 'error' })
    return
  }
  if (!isDirty.value && !hasUnpublishedDraft.value) return
  if (kindChanges.value.length) {
    publishConfirmOpen.value = true
    return
  }
  await performPublish(false)
}

async function confirmPublish() {
  publishConfirmOpen.value = false
  await performPublish(publishMigrate.value)
}
</script>

<template>
  <UDashboardPanel id="desk-schema-editor">
    <template #header>
      <DeskNavbar
        :title="isNew ? 'New Schema' : `Schema: ${state.schemaKey}`"
      >
        <template #title>
          <div class="flex flex-col min-w-0">
            <UBreadcrumb :items="breadcrumbItems" />
            <span class="text-xs text-muted truncate">Set up the fields editors will use, then publish your changes.</span>
          </div>
        </template>

        <template #actions>
          <UButton
            v-if="!isNew"
            color="neutral"
            variant="ghost"
            icon="i-lucide-history"
            aria-label="Revision history"
            @click="historyOpen = true;"
          />
          <UButton
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!canSaveDraft"
            aria-label="Save Draft"
            @click="saveDraft"
          >
            <span class="hidden sm:inline">Save Draft</span>
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-upload"
            :loading="publishing"
            :disabled="!canPublish"
            aria-label="Publish"
            @click="publish"
          >
            <span class="hidden sm:inline">Publish</span>
          </UButton>
        </template>
      </DeskNavbar>

      <UDashboardToolbar :ui="{ left: 'flex w-full' }">
        <template #left>
          <div class="w-full px-2">
            <UNavigationMenu
              :items="toolbarItems"
              highlight
              highlight-color="primary"
              variant="link"
              class="w-full data-[orientation=horizontal]:border-b border-default"
            />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <UAlert
        v-if="active?.status === 'inactive'"
        class="mb-6"
        title="This schema is inactive"
        description="Its versions and content are preserved, but content creation and delivery stay blocked until an administrator reactivates it from the Schema inventory."
        icon="i-lucide-circle-pause"
        color="warning"
        variant="subtle"
      >
        <template #actions>
          <UButton to="/_desk/schemas" color="warning" variant="soft">
            Open Schema inventory
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-if="conflictDetails"
        title="A newer schema draft is available"
        :description="conflictDetails.message || `Revision ${conflictDetails.currentRevision || 'newer'} was saved${conflictDetails.updatedBy ? ` by ${conflictDetails.updatedBy}` : ''}. Your local edits are still here.`"
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="subtle"
      >
        <template #actions>
          <UButton label="Review history" color="neutral" variant="outline" size="xs" @click="historyOpen = true;" />
          <UButton label="Reload latest" color="warning" variant="soft" size="xs" @click="reloadLatest" />
        </template>
      </UAlert>

      <UForm
        ref="schemaMetaFormRef"
        :schema="schemaMetaSchema"
        :state="state"
        @submit.prevent="saveDraft"
      >
        <fieldset class="min-w-0 space-y-4">
          <legend class="mb-4 text-sm font-semibold text-highlighted">
            Basic information
          </legend>
          <UFormField v-if="isNew" name="schemaKey" label="Schema Key" help="lowercase, URL-friendly" required>
            <UInput
              v-model="state.schemaKey"
              name="schemaKey"
              required
              pattern="[a-z0-9][a-z0-9_]*"
              title="Use lowercase letters, numbers, and underscores. Must start with a letter/number."
              placeholder="article"
              autocapitalize="none"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Title">
            <UInput v-model="state.title" placeholder="Article" class="w-full" />
          </UFormField>

          <UFormField label="Description">
            <UInput v-model="state.description" placeholder="Optional" class="w-full" />
          </UFormField>
        </fieldset>
      </UForm>

      <section class="min-w-0 space-y-3" aria-labelledby="schema-fields-heading">
        <div class="flex items-center justify-between gap-4">
          <h2 id="schema-fields-heading" class="text-sm font-semibold text-highlighted">
            Fields
          </h2>
          <UButton icon="i-lucide-plus" size="sm" @click="openNewField">
            Add field
          </UButton>
        </div>
        <UPageList divide class="hp-sort-list">
          <div
            v-for="(f, i) in state.fields"
            :key="f.id"
            class="hp-sort-item py-2 w-full"
            :data-locked="f.system ? 'true' : undefined"
          >
            <div class="w-full flex items-start justify-between gap-2">
              <div class="min-w-0 flex items-start gap-2">
                <div
                  class="hp-sort-handle mt-0.5 flex items-center justify-center text-muted select-none"
                  :class="f.system ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'"
                >
                  <UIcon :name="f.system ? 'i-lucide-lock' : 'i-lucide-grip-vertical'" size="16" />
                </div>
                <UAvatar
                  :icon="getFieldKindIcon(f.kind)"
                  size="sm"
                  class="shrink-0"
                  :ui="{ root: 'bg-elevated', icon: 'text-muted' }"
                />
                <div class="min-w-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-medium truncate">{{ f.title || f.key }}</span>
                    <UBadge v-if="f.system" size="xs" color="primary" variant="soft" class="shrink-0">
                      system
                    </UBadge>
                    <UBadge
                      v-if="!f.title"
                      size="xs"
                      color="neutral"
                      variant="soft"
                      class="shrink-0"
                    >
                      {{ f.kind }}
                    </UBadge>
                  </div>
                  <div v-if="f.title && f.title !== f.key" class="min-w-0 flex items-center gap-2 text-xs text-muted">
                    <span class="truncate">{{ f.key }}</span>
                    <UBadge size="xs" color="neutral" variant="soft" class="shrink-0">
                      {{ f.kind }}
                    </UBadge>
                  </div>
                </div>
              </div>

              <div class="flex gap-2 shrink-0">
                <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" @click="startEditField(i)">
                  Edit
                </UButton>
                <UButton
                  v-if="!f.system"
                  size="xs"
                  color="error"
                  variant="outline"
                  icon="i-lucide-trash"
                  @click="confirmRemoveField(i)"
                >
                  Remove
                </UButton>
              </div>
            </div>
          </div>
        </UPageList>
      </section>

      <UAlert
        v-if="!isNew"
        title="Public presentation is configured in Settings"
        description="Choose collection and detail behavior, field roles, Layout inheritance, URLs, and discovery metadata without leaving the shared Schema draft."
        icon="i-lucide-panels-top-left"
        variant="subtle"
      >
        <template #actions>
          <UButton :to="`/_desk/schemas/${routeKey}/settings`" color="neutral" variant="outline">
            Open presentation Settings
          </UButton>
        </template>
      </UAlert>

      <fieldset class="min-w-0 space-y-4">
        <legend class="text-sm font-semibold text-highlighted">
          Listing Fields
        </legend>
        <p class="text-sm text-muted">
          Choose the fields used for each content row. Common field names are selected automatically.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UFormField label="Title field">
            <USelectMenu
              :model-value="state.listing.titleFieldKey ?? undefined"
              :items="listingFieldOptions.title"
              value-key="value"
              label-key="label"
              clear
              placeholder="Select a title field"
              class="w-full"
              @update:model-value="state.listing.titleFieldKey = $event || null"
            />
          </UFormField>
          <UFormField label="Description field">
            <USelectMenu
              :model-value="state.listing.descriptionFieldKey ?? undefined"
              :items="listingFieldOptions.description"
              value-key="value"
              label-key="label"
              clear
              placeholder="Select a description field"
              class="w-full"
              @update:model-value="state.listing.descriptionFieldKey = $event || null"
            />
          </UFormField>
          <UFormField label="Image field">
            <USelectMenu
              :model-value="state.listing.imageFieldKey ?? undefined"
              :items="listingFieldOptions.image"
              value-key="value"
              label-key="label"
              clear
              placeholder="Select an image field"
              class="w-full"
              @update:model-value="state.listing.imageFieldKey = $event || null"
            />
          </UFormField>
        </div>

        <div class="overflow-hidden rounded-lg border border-default" aria-label="Listing row preview">
          <div class="flex items-center justify-between gap-3 border-b border-default bg-elevated/40 px-3 py-2">
            <span class="text-xs font-medium text-highlighted">Row preview</span>
            <span class="text-xs text-muted">Created is always shown</span>
          </div>
          <div class="flex items-center gap-3 px-3 py-3">
            <div class="size-10 shrink-0" aria-hidden="true">
              <UAvatar
                v-if="listingPreviewFields.image"
                icon="i-lucide-image"
                size="lg"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ listingPreviewFields.title?.title || listingPreviewFields.title?.key || 'Content ID' }}
              </p>
              <p v-if="listingPreviewFields.description" class="line-clamp-2 text-sm text-muted">
                {{ listingPreviewFields.description.title || listingPreviewFields.description.key }}
              </p>
              <p v-else class="text-sm text-dimmed">
                No description field selected
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-xs font-medium text-muted">Created</p>
              <p class="text-xs text-dimmed">Local date and time</p>
            </div>
          </div>
        </div>
      </fieldset>
      <UModal
        v-model:open="addFieldModalOpen"
        title="New Field"
        description="Add a field to this schema."
      >
        <template #body>
          <UForm
            id="desk-add-field-form"
            ref="addFieldFormRef"
            :schema="fieldDraftSchema"
            :state="fieldDraft"
            class="space-y-4"
            @submit.prevent="addField"
          >
            <fieldset class="min-w-0 space-y-4">
              <legend class="mb-4 text-sm font-medium text-highlighted">
                Basic information
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <UFormField name="key" label="Key" help="JSON key (a-zA-Z0-9_)" required>
                  <UInput
                    v-model="fieldDraft.key"
                    name="key"
                    required
                    pattern="[a-zA-Z][a-zA-Z0-9_]*"
                    title="Use letters, numbers, and underscores. Must start with a letter."
                    placeholder="body"
                    autocapitalize="none"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </UFormField>
                <UFormField name="kind" label="Kind" class="md:col-span-2" required>
                  <USelect v-model="fieldDraft.kind" :items="fieldKindOptions" class="w-full" />
                </UFormField>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UFormField label="Title">
                  <UInput v-model="fieldDraft.title" placeholder="Body" />
                </UFormField>
                <UFormField label="Required">
                  <USwitch v-model="fieldDraft.required" />
                </UFormField>
              </div>
            </fieldset>

            <fieldset class="min-w-0 space-y-2">
              <legend class="mb-2 text-sm font-medium text-highlighted">
                Search / Filter / Sort
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UFormField label="Search mode">
                  <USelect v-model="fieldDraft.search.mode" :items="getSearchModeOptions(fieldDraft.kind)" class="w-full" />
                </UFormField>
                <UFormField label="Filterable">
                  <USwitch
                    v-model="fieldDraft.search.filterable"
                    :disabled="!filterableKinds.has(fieldDraft.kind) || fieldDraft.search.mode === 'off'"
                  />
                </UFormField>
                <UFormField label="Sortable">
                  <USwitch
                    v-model="fieldDraft.search.sortable"
                    :disabled="!sortableKinds.has(fieldDraft.kind) || fieldDraft.search.mode === 'off'"
                  />
                </UFormField>
                <UFormField label="Full-text" help="Lazy Korean keyword indexing for published content.">
                  <USwitch
                    v-model="fieldDraft.search.fullText"
                    :disabled="!fullTextKinds.has(fieldDraft.kind)"
                  />
                </UFormField>
              </div>
            </fieldset>

            <fieldset v-if="fieldDraft.kind === 'enum'" class="min-w-0 space-y-2">
              <legend class="text-sm font-medium text-highlighted">
                Enum values
              </legend>
              <div class="flex justify-end">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  @click="fieldDraft.enumValues.push({ label: '', value: '' })"
                >
                  Add
                </UButton>
              </div>
              <div v-for="(ev, i) in fieldDraft.enumValues" :key="i" class="grid grid-cols-2 gap-2">
                <UInput v-model="ev.label" placeholder="Label" />
                <UInput v-model="ev.value" placeholder="value" />
              </div>
            </fieldset>

            <fieldset v-if="fieldDraft.kind === 'asset_list'" class="min-w-0 space-y-3">
              <legend class="text-sm font-medium text-highlighted">Asset list constraints</legend>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <UFormField label="Minimum items"><UInput v-model.number="fieldDraft.minItems" type="number" min="0" step="1" class="w-full" /></UFormField>
                <UFormField label="Maximum items"><UInput v-model.number="fieldDraft.maxItems" type="number" min="1" step="1" placeholder="Unlimited" class="w-full" /></UFormField>
              </div>
            </fieldset>

            <fieldset v-if="fieldDraft.kind === 'reference'" class="min-w-0 space-y-3">
              <legend class="mb-3 text-sm font-medium text-highlighted">
                Reference
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UFormField label="Target">
                  <USelect
                    v-model="fieldDraft.relTarget"
                    :items="[
                      { label: 'system:User', value: 'system:User' },
                      { label: 'system:Asset', value: 'system:Asset' },
                      ...contentSchemaOptions.map((o: any) => ({ label: `content:${o.value}`, value: `content:${o.value}` }))
                    ]"
                  />
                </UFormField>
                <UFormField label="Cardinality">
                  <USelect
                    v-model="fieldDraft.relCardinality"
                    :items="[
                      { label: 'one', value: 'one' },
                      { label: 'many', value: 'many' }
                    ]"
                  />
                </UFormField>
              </div>
              <UAlert
                title="MVP limitation"
                description="Only top-level reference fields are supported."
                icon="i-lucide-info"
                variant="subtle"
              />
            </fieldset>
          </UForm>
        </template>

        <template #footer="{ close }">
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="close()">
              Cancel
            </UButton>
            <UButton icon="i-lucide-check" type="submit" form="desk-add-field-form">
              Add
            </UButton>
          </div>
        </template>
      </UModal>
      <CmsRevisionHistorySlideover
        v-if="!isNew"
        v-model:open="historyOpen"
        :history-url="`/api/schema/${routeKey}/draft/history`"
        :current-revision="currentRevision"
        can-restore
        title="Schema draft history"
        @restored="handleHistoryRestored"
        @conflict="recordConflict"
      />

      <UModal
        v-model:open="editFieldModalOpen"
        title="Edit Field"
        description="Update field properties."
      >
        <template #body>
          <UForm
            id="desk-edit-field-form"
            ref="editFieldFormRef"
            :schema="fieldDraftSchema"
            :state="editDraft"
            class="space-y-4"
            @submit.prevent="saveEdit"
          >
            <fieldset class="min-w-0 space-y-4">
              <legend class="mb-4 text-sm font-medium text-highlighted">
                Basic information
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <UFormField name="key" label="Key" help="JSON key (a-zA-Z0-9_)" required>
                  <UInput
                    v-model="editDraft.key"
                    name="key"
                    required
                    pattern="[a-zA-Z][a-zA-Z0-9_]*"
                    title="Use letters, numbers, and underscores. Must start with a letter."
                    placeholder="body"
                    autocapitalize="none"
                    autocomplete="off"
                    spellcheck="false"
                    :disabled="editDraft.system"
                  />
                </UFormField>
                <UFormField name="kind" label="Kind" class="md:col-span-2" required>
                  <USelect v-model="editDraft.kind" :items="fieldKindOptions" class="w-full" :disabled="editDraft.system" />
                </UFormField>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UFormField label="Title">
                  <UInput v-model="editDraft.title" placeholder="Body" :disabled="editDraft.system" />
                </UFormField>
                <UFormField label="Required">
                  <USwitch v-model="editDraft.required" />
                </UFormField>
              </div>
            </fieldset>

            <fieldset class="min-w-0 space-y-2">
              <legend class="mb-2 text-sm font-medium text-highlighted">
                Search / Filter / Sort
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UFormField label="Search mode">
                  <USelect v-model="editDraft.search.mode" :items="getSearchModeOptions(editDraft.kind)" class="w-full" />
                </UFormField>
                <UFormField label="Filterable">
                  <USwitch
                    v-model="editDraft.search.filterable"
                    :disabled="!filterableKinds.has(editDraft.kind) || editDraft.search.mode === 'off'"
                  />
                </UFormField>
                <UFormField label="Sortable">
                  <USwitch
                    v-model="editDraft.search.sortable"
                    :disabled="!sortableKinds.has(editDraft.kind) || editDraft.search.mode === 'off'"
                  />
                </UFormField>
                <UFormField label="Full-text" help="Lazy Korean keyword indexing for published content.">
                  <USwitch
                    v-model="editDraft.search.fullText"
                    :disabled="!fullTextKinds.has(editDraft.kind)"
                  />
                </UFormField>
              </div>
            </fieldset>

            <fieldset v-if="editDraft.kind === 'enum' && !editDraft.system" class="min-w-0 space-y-2">
              <legend class="text-sm font-medium text-highlighted">
                Enum values
              </legend>
              <div class="flex justify-end">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  @click="editDraft.enumValues.push({ label: '', value: '' })"
                >
                  Add
                </UButton>
              </div>
              <div v-for="(ev, i) in editDraft.enumValues" :key="i" class="grid grid-cols-2 gap-2">
                <UInput v-model="ev.label" placeholder="Label" />
                <UInput v-model="ev.value" placeholder="value" />
              </div>
            </fieldset>

            <fieldset v-if="editDraft.kind === 'asset_list' && !editDraft.system" class="min-w-0 space-y-3">
              <legend class="text-sm font-medium text-highlighted">Asset list constraints</legend>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <UFormField label="Minimum items"><UInput v-model.number="editDraft.minItems" type="number" min="0" step="1" class="w-full" /></UFormField>
                <UFormField label="Maximum items"><UInput v-model.number="editDraft.maxItems" type="number" min="1" step="1" placeholder="Unlimited" class="w-full" /></UFormField>
              </div>
            </fieldset>

            <fieldset v-if="editDraft.kind === 'reference' && !editDraft.system" class="min-w-0 space-y-3">
              <legend class="mb-3 text-sm font-medium text-highlighted">
                Reference
              </legend>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UFormField label="Target">
                  <USelect
                    v-model="editDraft.relTarget"
                    :items="[
                      { label: 'system:User', value: 'system:User' },
                      { label: 'system:Asset', value: 'system:Asset' },
                      ...contentSchemaOptions.map((o: any) => ({ label: `content:${o.value}`, value: `content:${o.value}` }))
                    ]"
                  />
                </UFormField>
                <UFormField label="Cardinality">
                  <USelect
                    v-model="editDraft.relCardinality"
                    :items="[
                      { label: 'one', value: 'one' },
                      { label: 'many', value: 'many' }
                    ]"
                  />
                </UFormField>
              </div>
              <UAlert
                title="MVP limitation"
                description="Only top-level reference fields are supported."
                icon="i-lucide-info"
                variant="subtle"
              />
            </fieldset>
          </UForm>
        </template>

        <template #footer="{ close }">
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="closeEditModal(); close()">
              Cancel
            </UButton>
            <UButton icon="i-lucide-check" type="submit" form="desk-edit-field-form">
              Save
            </UButton>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="publishConfirmOpen"
        title="Review breaking changes"
        description="Field kind changes affect existing content."
      >
        <template #body>
          <div class="flex flex-col gap-4">
            <UAlert
              title="Existing content is not automatically converted."
              description="You can publish without migration, or apply a best-effort migration to update existing content to the new schema version."
              icon="i-lucide-info"
              variant="subtle"
            />
            <div class="space-y-2">
              <div class="text-sm font-medium">Changed fields</div>
              <div class="flex flex-col gap-2">
                <div
                  v-for="change in kindChanges"
                  :key="change.id"
                  class="flex items-center justify-between gap-3 rounded-md border border-muted/30 px-3 py-2 text-sm"
                >
                  <div class="min-w-0">
                    <div class="font-medium truncate">{{ change.title }}</div>
                    <div class="text-xs text-muted truncate">{{ change.key }}</div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <UBadge size="xs" color="neutral" variant="soft">{{ change.fromLabel }}</UBadge>
                    <UIcon name="i-lucide-arrow-right" size="14" class="text-muted" />
                    <UBadge size="xs" color="primary" variant="soft">{{ change.toLabel }}</UBadge>
                  </div>
                </div>
              </div>
            </div>
            <UCheckbox
              v-model="publishMigrate"
              label="Apply migration to existing content"
              description="Best-effort conversion and schemaVersion update."
            />
          </div>
        </template>

        <template #footer="{ close }">
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="close()">
              Cancel
            </UButton>
            <UButton icon="i-lucide-upload" color="primary" :loading="publishing" @click="confirmPublish()">
              Publish
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
