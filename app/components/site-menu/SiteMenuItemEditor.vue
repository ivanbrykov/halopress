<script setup lang="ts">
import {
  SITE_MENU_ICONS,
  type SiteMenuLeaf,
  type SiteMenuStaticItem,
  type SiteMenuValidationIssue
} from '~~/shared/site-menu'
import type { PublicNavigationDestination } from '~~/shared/site-presentation'

const model = defineModel<SiteMenuLeaf | SiteMenuStaticItem>({ required: true })
const props = defineProps<{
  pathPrefix: string
  validationIssues?: SiteMenuValidationIssue[]
  autofocusLabel?: boolean
}>()

function errorAt(suffix: string) {
  return validationMessageForPath(props.validationIssues ?? [], `${props.pathPrefix}.${suffix}`)
}

const destinationError = computed(() => (props.validationIssues ?? []).find(issue =>
  issue.path === `${props.pathPrefix}.destination`
  || issue.path.startsWith(`${props.pathPrefix}.destination.`)
)?.message)

const destinationTypes = [
  { label: 'Home', value: 'home' },
  { label: 'Page', value: 'page' },
  { label: 'Collection', value: 'collection' },
  { label: 'Content item', value: 'content' },
  { label: 'External URL', value: 'external' }
]

const iconOptions = [
  { label: 'No icon', value: SITE_MENU_NO_ICON_VALUE },
  ...SITE_MENU_ICONS.map(icon => ({
    label: icon.replace('i-lucide-', '').replaceAll('-', ' '),
    value: icon,
    icon
  }))
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

const customValue = computed({
  get: () => model.value.value || '',
  set: (value: string) => {
    const normalized = value.trim()
    if (normalized) model.value.value = normalized
    else delete model.value.value
  }
})

const icon = computed({
  get: () => model.value.icon || SITE_MENU_NO_ICON_VALUE,
  set: (value: string) => {
    const supported = siteMenuIconFromEditorValue(value)
    if (supported) model.value.icon = supported
    else delete model.value.icon
  }
})

const badge = computed({
  get: () => model.value.badge === undefined ? '' : String(model.value.badge),
  set: (value: string) => {
    const normalized = value.trim()
    if (normalized) model.value.badge = normalized
    else delete model.value.badge
  }
})
</script>

<template>
  <div class="grid min-w-0 gap-3 sm:grid-cols-2">
    <UFormField name="label" label="Label" required class="min-w-0" :error="errorAt('label')">
      <UInput
        v-model="model.label"
        class="w-full"
        placeholder="About"
        maxlength="80"
        :autofocus="autofocusLabel"
        :data-menu-item-create-label="autofocusLabel ? '' : undefined"
        :data-validation-path="`${pathPrefix}.label`"
      />
    </UFormField>
    <UFormField name="destination.type" label="Destination" required class="min-w-0" :error="destinationError">
      <USelect
        v-model="destinationType"
        :items="destinationTypes"
        value-key="value"
        class="w-full"
        :data-validation-path="`${pathPrefix}.destination.type`"
      />
    </UFormField>

    <UFormField
      name="value"
      label="Stable value"
      description="Optional. When blank, the immutable item ID is used."
      class="min-w-0"
      :error="errorAt('value')"
    >
      <UInput
        v-model="customValue"
        class="w-full"
        placeholder="about-link"
        autocapitalize="none"
        :data-validation-path="`${pathPrefix}.value`"
      />
    </UFormField>
    <UFormField
      name="icon"
      label="Icon"
      description="Only the supported Lucide catalog is stored."
      class="min-w-0"
      :error="errorAt('icon')"
    >
      <USelect
        v-model="icon"
        :items="iconOptions"
        value-key="value"
        class="w-full"
        :data-validation-path="`${pathPrefix}.icon`"
      />
    </UFormField>

    <UFormField
      name="badge"
      label="Badge"
      description="Optional short text or number."
      class="min-w-0 sm:col-span-2"
      :error="errorAt('badge')"
    >
      <UInput
        v-model="badge"
        class="w-full"
        placeholder="New"
        maxlength="24"
        :data-validation-path="`${pathPrefix}.badge`"
      />
    </UFormField>

    <UFormField v-if="model.destination.type === 'page'" name="destination.pageId" label="Page ID" required class="min-w-0 sm:col-span-2" :error="errorAt('destination.pageId')">
      <UInput v-model="model.destination.pageId" class="w-full" placeholder="about" :data-validation-path="`${pathPrefix}.destination.pageId`" />
    </UFormField>
    <UFormField v-if="model.destination.type === 'collection'" name="destination.schemaKey" label="Schema key" required class="min-w-0 sm:col-span-2" :error="errorAt('destination.schemaKey')">
      <UInput v-model="model.destination.schemaKey" class="w-full" placeholder="article" :data-validation-path="`${pathPrefix}.destination.schemaKey`" />
    </UFormField>
    <template v-if="model.destination.type === 'content'">
      <UFormField name="destination.schemaKey" label="Schema key" required class="min-w-0" :error="errorAt('destination.schemaKey')">
        <UInput v-model="model.destination.schemaKey" class="w-full" placeholder="article" :data-validation-path="`${pathPrefix}.destination.schemaKey`" />
      </UFormField>
      <UFormField name="destination.contentId" label="Content ID" required class="min-w-0" :error="errorAt('destination.contentId')">
        <UInput v-model="model.destination.contentId" class="w-full" placeholder="welcome" :data-validation-path="`${pathPrefix}.destination.contentId`" />
      </UFormField>
    </template>
    <template v-if="model.destination.type === 'external'">
      <UFormField name="destination.url" label="External URL" required class="min-w-0 sm:col-span-2" :error="errorAt('destination.url')">
        <UInput v-model="model.destination.url" type="url" class="w-full" placeholder="https://example.com" :data-validation-path="`${pathPrefix}.destination.url`" />
      </UFormField>
      <USwitch
        v-model="model.destination.newWindow"
        label="Open in a new window"
        class="sm:col-span-2"
      />
    </template>
  </div>
</template>
