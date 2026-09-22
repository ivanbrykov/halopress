<script setup lang="ts">
import {
  hasRenderableValue,
  isRichTextPresentationField,
  presentationText,
  reservedPresentationFieldIds,
  resolveSchemaPresentation
} from '~/utils/schema-presentation'
const props = defineProps<{
  schema: any
  content: Record<string, unknown>
  fallbackTitle?: string
}>()
const presentation = computed(() => resolveSchemaPresentation(props.schema?.registry))
const slots = computed(() => presentation.value.slots ?? {})
const fields = computed(() => presentation.value.fields ?? [])
const valueFor = (slot: string) => {
  const binding = slots.value[slot]
  return binding?.fieldKey ? props.content[binding.fieldKey] : undefined
}
const fieldFor = (slot: string) => fields.value.find((field: any) => field.fieldId === slots.value[slot]?.fieldId)
const title = computed(() => hasRenderableValue(valueFor('title')) ? String(valueFor('title')) : props.fallbackTitle || 'Untitled')
const descriptionField = computed(() => fieldFor('description'))
const richTextDescription = computed(() => isRichTextPresentationField(descriptionField.value))
const portableDescriptionField = computed(() => richTextDescription.value && descriptionField.value
  ? { ...descriptionField.value, renderer: 'rich_text' }
  : descriptionField.value)
const description = computed(() => richTextDescription.value ? '' : presentationText(valueFor('description')))
const reservedIds = computed(() => reservedPresentationFieldIds(presentation.value))
const remainingFields = computed(() => fields.value.filter((field: any) => !reservedIds.value.has(field.fieldId) && hasRenderableValue(props.content[field.fieldKey])))
</script>

<template>
  <article class="space-y-10">
    <header class="space-y-4" :class="presentation.detailTemplate === 'article' ? 'mx-auto max-w-3xl text-center' : ''">
      <UBadge v-if="presentation.preset !== 'generic'" color="primary" variant="soft">{{ presentation.preset }}</UBadge>
      <h1 class="text-4xl font-bold tracking-tight text-highlighted sm:text-5xl">{{ title }}</h1>
      <PublicFieldRenderer
        v-if="richTextDescription && descriptionField && hasRenderableValue(valueFor('description'))"
        :field="portableDescriptionField"
        :value="valueFor('description')"
      />
      <p v-else-if="description" class="text-lg text-muted">{{ description }}</p>
    </header>

    <div v-if="fieldFor('image') && hasRenderableValue(valueFor('image'))" :class="presentation.detailTemplate === 'catalog' ? 'lg:max-w-2xl' : ''">
      <PublicFieldRenderer :field="fieldFor('image')" :value="valueFor('image')" />
    </div>

    <div v-if="presentation.detailTemplate === 'catalog' && fieldFor('price') && hasRenderableValue(valueFor('price'))" class="text-3xl font-semibold text-highlighted">
      <PublicFieldRenderer :field="fieldFor('price')" :value="valueFor('price')" />
    </div>

    <div v-if="fieldFor('body') && hasRenderableValue(valueFor('body'))" :class="presentation.detailTemplate === 'article' ? 'mx-auto max-w-3xl' : ''">
      <PublicFieldRenderer
        :field="fieldFor('body')"
        :value="valueFor('body')"
      />
    </div>

    <PublicAssetGallery v-if="fieldFor('gallery') && hasRenderableValue(valueFor('gallery'))" :value="valueFor('gallery')" :label="fieldFor('gallery')?.title" />

    <dl v-if="remainingFields.length" class="divide-y divide-default rounded-xl border border-default">
      <div v-for="field in remainingFields" :key="field.fieldId" class="grid gap-2 p-4 sm:grid-cols-[12rem_1fr]">
        <dt class="font-medium text-highlighted">{{ field.title || field.fieldKey }}</dt>
        <dd class="min-w-0 text-muted">
          <PublicFieldRenderer
            :field="field"
            :value="content[field.fieldKey]"
          />
        </dd>
      </div>
    </dl>
  </article>
</template>
