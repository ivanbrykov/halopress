<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { LegacyPageHeroConversion, PageHeroAttrs } from '~~/shared/page-hero'

import PageBlockInspector from '~/components/page-editor/PageBlockInspector.vue'
import PageBlockPalette from '~/components/page-editor/PageBlockPalette.vue'
import PageHeroInspector from '~/components/page-editor/PageHeroInspector.vue'
import PagePropertiesInspector from '~/components/page-editor/PagePropertiesInspector.vue'
import type { PagePaletteItem } from '~/editor/page/palette'
import type { PageBlockAttrs, PageBlockField } from '~/editor/page/types'

const props = withDefaults(defineProps<{
  selectedBlock: PageBlockAttrs | null
  selectedHero: PageHeroAttrs | null
  activeFields: PageBlockField[]
  activeLabel?: string
  editable?: boolean
  pageValidationMessage?: string
  publishedLayoutId?: string | null
  hasPublishedRevision?: boolean
  legacyHeroConversion?: LegacyPageHeroConversion | null
}>(), {
  activeLabel: undefined,
  editable: true,
  pageValidationMessage: undefined
})

const emit = defineEmits<{
  insert: [item: PagePaletteItem]
  dragstart: [event: DragEvent, item: PagePaletteItem]
  updateBlock: [attrs: PageBlockAttrs]
  updateHero: [attrs: Partial<PageHeroAttrs>]
  convertLegacyHero: []
  showPageProperties: []
}>()

const activeTab = defineModel<'library' | 'inspector'>('activeTab', { default: 'inspector' })
const pageTitle = defineModel<string>('pageTitle', { default: '' })
const publicPath = defineModel<string>('publicPath', { default: '' })
const description = defineModel<string>('description', { default: '' })
const socialImageAssetId = defineModel<string>('socialImageAssetId', { default: '' })
const layoutId = defineModel<string | null>('layoutId', { default: null })
const inspectorTabLabel = computed(() => (
  activeTab.value === 'inspector' && !props.selectedBlock && !props.selectedHero ? 'Page properties' : 'Inspector'
))

const panelTabs = computed<TabsItem[]>(() => [
  { label: 'Block Library', value: 'library', slot: 'library' },
  { label: inspectorTabLabel.value, value: 'inspector', slot: 'inspector' }
])

function forwardDragStart(event: DragEvent, item: PagePaletteItem) {
  emit('dragstart', event, item)
}
</script>

<template>
  <UTabs
    v-model="activeTab"
    :items="panelTabs"
    class="flex h-full min-h-0 flex-1 flex-col"
    :ui="{
      root: 'gap-0',
      list: 'min-h-12 shrink-0 rounded-none border-b border-muted',
      trigger: 'min-h-10',
      content: 'min-h-0 flex-1 overflow-hidden rounded-none p-0'
    }"
  >
    <template #library>
      <PageBlockPalette
        class="h-full min-h-0"
        :editable="editable"
        @insert="emit('insert', $event)"
        @dragstart="forwardDragStart"
      />
    </template>

    <template #inspector>
      <div class="flex h-full min-h-0 flex-col">
        <div v-if="selectedBlock || selectedHero" class="shrink-0 border-b border-muted px-2 py-1">
          <UButton
            label="Page properties"
            icon="i-lucide-file-cog"
            color="neutral"
            variant="link"
            size="sm"
            @click="emit('showPageProperties')"
          />
        </div>
        <div v-if="pageValidationMessage" class="shrink-0 p-4 pb-0">
          <UAlert
            title="This page is not ready to publish"
            :description="pageValidationMessage"
            icon="i-lucide-triangle-alert"
            color="error"
            variant="subtle"
          />
        </div>
        <div v-if="selectedBlock?.component === 'pageHero' && legacyHeroConversion" class="shrink-0 space-y-3 border-b border-muted p-4">
          <UAlert
            title="Legacy configured Hero"
            :description="legacyHeroConversion.status === 'ready'
              ? 'Convert this stored block explicitly to edit its headline, copy, links, and media on the canvas.'
              : legacyHeroConversion.reason"
            :color="legacyHeroConversion.status === 'ready' ? 'info' : 'warning'"
            variant="subtle"
          />
          <UButton
            label="Convert to editable Hero"
            icon="i-lucide-replace"
            color="neutral"
            variant="outline"
            block
            :disabled="!editable || legacyHeroConversion.status !== 'ready'"
            @click="emit('convertLegacyHero')"
          />
        </div>
        <PageBlockInspector
          v-if="selectedBlock"
          class="min-h-0 flex-1"
          :attrs="selectedBlock"
          :fields="activeFields"
          :label="activeLabel"
          :editable="editable"
          @update="emit('updateBlock', $event)"
        />
        <PageHeroInspector
          v-else-if="selectedHero"
          class="min-h-0 flex-1"
          :attrs="selectedHero"
          :editable="editable"
          @update="emit('updateHero', $event)"
        />
        <PagePropertiesInspector
          v-else
          v-model:page-title="pageTitle"
          v-model:public-path="publicPath"
          v-model:description="description"
          v-model:social-image-asset-id="socialImageAssetId"
          v-model:layout-id="layoutId"
          class="min-h-0 flex-1"
          :disabled="!props.editable"
          :published-layout-id="props.publishedLayoutId"
          :has-published-revision="props.hasPublishedRevision"
        />
      </div>
    </template>
  </UTabs>
</template>
