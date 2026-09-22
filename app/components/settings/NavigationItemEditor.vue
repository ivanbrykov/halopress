<script setup lang="ts">
import type {
  PublicNavigationDestination,
  PublicNavigationLeaf
} from '~~/shared/site-presentation'

const model = defineModel<PublicNavigationLeaf>({ required: true })

const destinationTypes = [
  { label: 'Home', value: 'home' },
  { label: 'Page', value: 'page' },
  { label: 'Collection', value: 'collection' },
  { label: 'Content item', value: 'content' },
  { label: 'External URL', value: 'external' }
]

const destinationType = computed({
  get: () => model.value.destination.type,
  set: (type: PublicNavigationDestination['type']) => {
    if (type === 'home') model.value.destination = { type: 'home' }
    if (type === 'page') model.value.destination = { type: 'page', pageId: '' }
    if (type === 'collection') model.value.destination = { type: 'collection', schemaKey: '' }
    if (type === 'content') model.value.destination = { type: 'content', schemaKey: '', contentId: '' }
    if (type === 'external') model.value.destination = { type: 'external', url: 'https://', newWindow: false }
  }
})
</script>

<template>
  <div class="grid min-w-0 gap-3 sm:grid-cols-2">
    <UFormField label="Label" class="min-w-0">
      <UInput v-model="model.label" class="w-full" placeholder="About" />
    </UFormField>
    <UFormField label="Destination" class="min-w-0">
      <USelect v-model="destinationType" :items="destinationTypes" value-key="value" class="w-full" />
    </UFormField>

    <UFormField v-if="model.destination.type === 'page'" label="Page ID" class="min-w-0 sm:col-span-2">
      <UInput v-model="model.destination.pageId" class="w-full" placeholder="about" />
    </UFormField>
    <UFormField v-if="model.destination.type === 'collection'" label="Schema key" class="min-w-0 sm:col-span-2">
      <UInput v-model="model.destination.schemaKey" class="w-full" placeholder="article" />
    </UFormField>
    <template v-if="model.destination.type === 'content'">
      <UFormField label="Schema key" class="min-w-0">
        <UInput v-model="model.destination.schemaKey" class="w-full" placeholder="article" />
      </UFormField>
      <UFormField label="Content ID" class="min-w-0">
        <UInput v-model="model.destination.contentId" class="w-full" placeholder="welcome" />
      </UFormField>
    </template>
    <template v-if="model.destination.type === 'external'">
      <UFormField label="External URL" class="min-w-0 sm:col-span-2">
        <UInput v-model="model.destination.url" type="url" class="w-full" placeholder="https://example.com" />
      </UFormField>
      <USwitch
        v-model="model.destination.newWindow"
        label="Open in a new window"
        class="sm:col-span-2"
      />
    </template>
  </div>
</template>
