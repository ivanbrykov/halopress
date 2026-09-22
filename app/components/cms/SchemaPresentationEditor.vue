<script setup lang="ts">
import {
  buildSchemaPresentationPreset,
  presentationFieldLabel,
  schemaPresentationPresetReplacements,
  type SchemaPresentation,
  type SchemaPresentationField
} from '~/utils/schema-presentation-settings'

const props = defineProps<{
  modelValue: SchemaPresentation
  fields: SchemaPresentationField[]
  schemaKey: string
  publishedPresentation?: SchemaPresentation | null
  publishedVersion?: number | null
  draftDiffersFromPublished?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SchemaPresentation): void
}>()

const { confirm } = useConfirmDialog()

const presetOptions = [
  {
    label: 'Generic',
    value: 'generic',
    description: 'A simple collection list and document-style detail that works for any Schema.'
  },
  {
    label: 'Article',
    value: 'article',
    description: 'Media-friendly collection cards and a long-form article detail.'
  },
  {
    label: 'Catalog',
    value: 'catalog',
    description: 'A visual collection grid and product-style detail with price emphasis.'
  }
]

const collectionOptions = [
  { label: 'List', value: 'list', description: 'A compact row-based collection.' },
  { label: 'Cards', value: 'cards', description: 'Media-friendly cards using the Schema Listing Fields.' },
  { label: 'Catalog grid', value: 'catalog-grid', description: 'A visual product-oriented grid.' }
]

const detailOptions = [
  { label: 'Document', value: 'document', description: 'A general-purpose detail with fallback fields.' },
  { label: 'Article', value: 'article', description: 'Long-form reading with prominent title, image, and body.' },
  { label: 'Catalog', value: 'catalog', description: 'Product detail with an emphasized price region.' }
]

const structuredDataOptions = [
  { label: 'Web page', value: 'WebPage' },
  { label: 'Article', value: 'Article' },
  { label: 'Blog post', value: 'BlogPosting' },
  { label: 'News article', value: 'NewsArticle' },
  { label: 'Product', value: 'Product' }
]

const roleDescriptions = {
  title: 'Primary heading on collection and detail surfaces.',
  description: 'Collection summary and detail introduction.',
  image: 'Lead image used by visual collection and detail templates.',
  body: 'Long-form detail content.',
  gallery: 'Additional visual media on supported detail templates.',
  price: 'Emphasized by Catalog detail; otherwise shown with fallback fields.'
}

function options(kinds: string[]) {
  return props.fields
    .filter(field => !field.system && kinds.includes(field.kind))
    .map(field => ({
      label: field.title || field.key,
      value: field.id,
      description: `${field.key} · ${field.kind}`
    }))
}

const slotOptions = computed(() => ({
  title: options(['string', 'text']),
  description: options(['string', 'text', 'richtext']),
  image: options(['asset', 'asset_list']),
  body: options(['text', 'richtext']),
  gallery: options(['asset_list', 'asset']),
  price: options(['number', 'integer', 'string'])
}))

const slugOptions = computed(() => options(['string', 'text']))

const layoutId = computed<string | null>({
  get: () => props.modelValue.layoutId ?? null,
  set: (value) => {
    const next = { ...props.modelValue }
    if (value) next.layoutId = value
    else delete next.layoutId
    emit('update:modelValue', next)
  }
})

const layoutDescription = computed(() => {
  if (!layoutId.value) {
    return 'Collection and detail routes inherit the Site default Layout after this Schema draft is published.'
  }
  if (layoutId.value !== (props.publishedPresentation?.layoutId ?? null)) {
    return 'This Schema Layout overrides the Site default after publication. Public routes keep their published assignment until then.'
  }
  return 'This Schema overrides the Site default and follows the current revision of the selected Layout.'
})

const collectionRoute = computed(() => `/${props.schemaKey}`)
const detailRoute = computed(() => `/${props.schemaKey}/:slug`)
const selectedLayoutLabel = computed(() => props.modelValue.layoutId || 'Site default Layout')
const slugLabel = computed(() => presentationFieldLabel(props.fields, props.modelValue.slugFieldId))

function update(patch: Partial<SchemaPresentation>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function updateSlot(slot: keyof SchemaPresentation['slots'], fieldId: unknown) {
  const slots = { ...props.modelValue.slots }
  if (typeof fieldId === 'string' && fieldId) slots[slot] = fieldId
  else delete slots[slot]
  update({ slots })
}

async function applyPreset(value: unknown) {
  if (value !== 'generic' && value !== 'article' && value !== 'catalog') return
  if (value === props.modelValue.preset) return
  const replacements = schemaPresentationPresetReplacements(props.modelValue, props.fields)
  if (replacements.length) {
    const accepted = await confirm({
      title: `Apply the ${value} starting presentation?`,
      body: `This replaces ${replacements.join(', ')}. Layout, slug source, and structured-data type stay unchanged.`,
      confirmLabel: 'Apply preset',
      confirmColor: 'warning'
    })
    if (!accepted) return
  }
  emit('update:modelValue', buildSchemaPresentationPreset(value, props.fields, props.modelValue))
}
</script>

<template>
  <section class="min-w-0 space-y-6" aria-labelledby="schema-public-presentation-heading">
    <div>
      <h2 id="schema-public-presentation-heading" class="text-sm font-semibold text-highlighted">
        Public presentation
      </h2>
      <p class="mt-1 text-sm text-muted">
        Configure the public collection route <code>{{ collectionRoute }}</code> and each published detail route
        <code>{{ detailRoute }}</code>. Saving changes updates only this Schema draft; public routes change after explicit publication.
      </p>
    </div>

    <div class="space-y-3">
      <div>
        <h3 class="text-sm font-medium text-highlighted">1. Choose a starting presentation</h3>
        <p class="text-xs text-muted">A preset supplies understandable template and field-role defaults that you can refine below.</p>
      </div>
      <URadioGroup
        :model-value="modelValue.preset"
        :items="presetOptions"
        value-key="value"
        variant="card"
        orientation="horizontal"
        legend="Starting presentation"
        class="grid gap-3 md:grid-cols-3"
        @update:model-value="applyPreset"
      />
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <fieldset class="min-w-0 space-y-4 rounded-lg border border-default p-4">
        <legend class="px-1 text-sm font-medium text-highlighted">2. Collection behavior</legend>
        <p class="text-xs text-muted">
          Controls {{ collectionRoute }}. The renderer also uses the Schema's Listing Fields.
          <NuxtLink :to="`/_desk/schemas/${schemaKey}`" class="text-primary underline">Review Listing Fields</NuxtLink>.
        </p>
        <UFormField label="Collection template" :description="collectionOptions.find(item => item.value === modelValue.collectionTemplate)?.description">
          <USelect
            :model-value="modelValue.collectionTemplate"
            :items="collectionOptions"
            class="w-full"
            aria-label="Collection template"
            @update:model-value="update({ collectionTemplate: $event as SchemaPresentation['collectionTemplate'] })"
          />
        </UFormField>
      </fieldset>

      <fieldset class="min-w-0 space-y-4 rounded-lg border border-default p-4">
        <legend class="px-1 text-sm font-medium text-highlighted">3. Detail behavior</legend>
        <p class="text-xs text-muted">
          Controls {{ detailRoute }}. Populated fields without a role remain available through fallback field rendering.
        </p>
        <UFormField label="Detail template" :description="detailOptions.find(item => item.value === modelValue.detailTemplate)?.description">
          <USelect
            :model-value="modelValue.detailTemplate"
            :items="detailOptions"
            class="w-full"
            aria-label="Detail template"
            @update:model-value="update({ detailTemplate: $event as SchemaPresentation['detailTemplate'] })"
          />
        </UFormField>
      </fieldset>
    </div>

    <fieldset class="min-w-0 space-y-4 rounded-lg border border-default p-4">
      <legend class="px-1 text-sm font-medium text-highlighted">4. Visible field roles</legend>
      <p class="text-xs text-muted">Bind stable Schema field identities to the regions visitors see.</p>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <UFormField
          v-for="slot in (['title', 'description', 'image', 'body', 'gallery', 'price'] as const)"
          :key="slot"
          :label="`${slot[0]?.toUpperCase()}${slot.slice(1)} field`"
          :description="roleDescriptions[slot]"
        >
          <USelectMenu
            :model-value="modelValue.slots[slot]"
            :items="slotOptions[slot]"
            value-key="value"
            label-key="label"
            clear
            :placeholder="`Auto-select ${slot}`"
            :aria-label="`${slot} presentation field`"
            class="w-full"
            @update:model-value="updateSlot(slot, $event)"
          />
        </UFormField>
      </div>
    </fieldset>

    <fieldset class="min-w-0 space-y-4 rounded-lg border border-default p-4">
      <legend class="px-1 text-sm font-medium text-highlighted">5. Layout inheritance</legend>
      <p class="text-xs text-muted">
        A Schema Layout overrides the Site default for both public surfaces. Clearing it restores Site inheritance.
      </p>
      <LayoutAssignmentSelect
        v-model="layoutId"
        label="Presentation Layout"
        :description="layoutDescription"
        placeholder="Inherit the Site default Layout"
      />
    </fieldset>

    <fieldset class="min-w-0 space-y-4 rounded-lg border border-default p-4">
      <legend class="px-1 text-sm font-medium text-highlighted">6. URLs and discovery</legend>
      <p class="text-xs text-muted">These choices stay draft-only until publication and do not directly change the visible template.</p>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="Slug source" description="Compatible future values generate stable public paths after publication.">
          <USelectMenu
            :model-value="modelValue.slugFieldId"
            :items="slugOptions"
            value-key="value"
            label-key="label"
            clear
            placeholder="Use the title mapping"
            aria-label="Slug source"
            class="w-full"
            @update:model-value="update({ slugFieldId: typeof $event === 'string' ? $event : undefined })"
          />
        </UFormField>
        <UFormField label="Structured data type" description="Changes allowlisted search-engine metadata, not the visible template.">
          <USelect
            :model-value="modelValue.structuredDataType || 'WebPage'"
            :items="structuredDataOptions"
            aria-label="Structured data type"
            class="w-full"
            @update:model-value="update({ structuredDataType: $event as SchemaPresentation['structuredDataType'] })"
          />
        </UFormField>
      </div>
    </fieldset>

    <section class="min-w-0 space-y-4 rounded-lg border border-default p-4" aria-labelledby="schema-presentation-effect-heading" aria-live="polite">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="schema-presentation-effect-heading" class="text-sm font-medium text-highlighted">Current draft effect</h3>
          <p class="text-xs text-muted">A text summary of the selected runtime contract, not a separate preview renderer.</p>
        </div>
          <UBadge
          :label="draftDiffersFromPublished ? 'Draft differs from published' : 'Matches published'"
          :color="draftDiffersFromPublished ? 'warning' : 'success'"
          variant="soft"
        />
      </div>
      <dl class="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt class="text-xs text-muted">Collection</dt>
          <dd>{{ collectionRoute }} · {{ modelValue.collectionTemplate }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Detail</dt>
          <dd>{{ detailRoute }} · {{ modelValue.detailTemplate }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Layout</dt>
          <dd>{{ selectedLayoutLabel }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Slug source</dt>
          <dd>{{ slugLabel }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Structured data</dt>
          <dd>{{ modelValue.structuredDataType || 'WebPage' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Published comparison</dt>
          <dd>{{ publishedVersion ? `Schema v${publishedVersion}` : 'Never published' }}</dd>
        </div>
        <div class="md:col-span-2">
          <dt class="text-xs text-muted">Visible field roles</dt>
          <dd class="mt-1 flex flex-wrap gap-2">
            <UBadge
              v-for="slot in (['title', 'description', 'image', 'body', 'gallery', 'price'] as const)"
              :key="slot"
              color="neutral"
              variant="soft"
              :label="`${slot}: ${presentationFieldLabel(fields, modelValue.slots[slot])}`"
            />
          </dd>
        </div>
      </dl>
    </section>

    <UAlert
      title="Bindings are checked on publish"
      description="Removed fields and incompatible field kinds are rejected before this presentation version becomes public."
      icon="i-lucide-shield-check"
      variant="subtle"
    />
  </section>
</template>
