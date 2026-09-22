<script setup lang="ts">
const publicPath = defineModel<string>('publicPath', { default: '' })
const title = defineModel<string>('title', { default: '' })
const description = defineModel<string>('description', { default: '' })
const imageAssetId = defineModel<string>('imageAssetId', { default: '' })
const structuredDataType = defineModel<string>('structuredDataType', { default: '' })
const schemaDefaultValue = '__schema_default__'
const structuredDataTypeValue = computed({
  get: () => structuredDataType.value || schemaDefaultValue,
  set: value => {
    structuredDataType.value = value === schemaDefaultValue ? '' : value
  }
})

withDefaults(defineProps<{
  showPath?: boolean
  disabled?: boolean
  compact?: boolean
}>(), {
  showPath: false,
  disabled: false,
  compact: false
})

const structuredDataTypes = [
  { label: 'Schema default', value: schemaDefaultValue },
  { label: 'Web page', value: 'WebPage' },
  { label: 'Article', value: 'Article' },
  { label: 'Blog posting', value: 'BlogPosting' },
  { label: 'News article', value: 'NewsArticle' },
  { label: 'Product', value: 'Product' }
]
</script>

<template>
  <section class="space-y-4 rounded-lg border border-default bg-default p-4">
    <div>
      <h3 class="font-medium text-highlighted">Public route and SEO</h3>
      <p class="text-xs text-muted">Overrides are published with the canonical route. Blank fields use site and schema defaults.</p>
    </div>

    <div class="grid gap-4" :class="compact ? 'grid-cols-1' : 'md:grid-cols-2'">
      <UFormField
        v-if="showPath"
        label="Custom public path"
        description="Optional. Use a path such as /about or /company/about. Previous published paths remain redirects."
        :class="{ 'md:col-span-2': !compact }"
      >
        <UInput v-model="publicPath" placeholder="Generated from the page title" class="w-full" :disabled="disabled" />
      </UFormField>

      <UFormField label="SEO title">
        <UInput v-model="title" maxlength="120" placeholder="Use the mapped public title" class="w-full" :disabled="disabled" />
      </UFormField>

      <UFormField label="Structured data type">
        <USelect
          v-model="structuredDataTypeValue"
          :items="structuredDataTypes"
          value-key="value"
          label-key="label"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>

      <UFormField label="SEO description" :class="{ 'md:col-span-2': !compact }">
        <UTextarea
          v-model="description"
          maxlength="320"
          :rows="3"
          autoresize
          placeholder="Use the mapped description or site default"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>

      <UFormField
        label="Social image asset ID"
        description="Optional asset ID used for Open Graph, Twitter cards, and structured data."
        :class="{ 'md:col-span-2': !compact }"
      >
        <UInput v-model="imageAssetId" placeholder="Asset ID" class="w-full" :disabled="disabled" />
      </UFormField>
    </div>
  </section>
</template>
