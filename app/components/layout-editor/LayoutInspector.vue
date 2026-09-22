<script setup lang="ts">
import {
  layoutElementRegistry,
  type LayoutDocument,
  type LayoutElement,
  type LayoutElementProps,
  type LayoutRegionKey,
  type LayoutViewport
} from '~~/shared/site-layout'
import type { SiteMenuAdminResource } from '~~/shared/site-menu'

const props = defineProps<{
  document: LayoutDocument
  selectedRegionId: LayoutRegionKey
  selectedElementId?: string
  menuSets: SiteMenuAdminResource[]
  menuPending: boolean
}>()
const emit = defineEmits<{
  updateDocument: [document: LayoutDocument]
  updateElement: [elementId: string, props: LayoutElement['props']]
  selectRegion: [regionId: LayoutRegionKey]
  moveElement: [elementId: string, regionId: LayoutRegionKey, index: number, direction?: 'up' | 'down']
  duplicateElement: [elementId: string]
  removeElement: [elementId: string]
}>()

const selectedElement = computed(() => selectedLayoutElement(props.document, props.selectedElementId))
const descriptor = computed(() => selectedElement.value ? layoutElementRegistry[selectedElement.value.type] : null)
const selectedRegion = computed(() => props.document.grid.regions.find(region => region.id === props.selectedRegionId) ?? null)
const regionOptions = computed(() => props.document.grid.regions.map(region => ({
  label: region.id.replaceAll('-', ' '),
  value: region.id
})))
const allowedRegionOptions = computed(() => selectedElement.value
  ? allowedLayoutRegions(props.document, selectedElement.value.type).map(region => ({ label: region.replaceAll('-', ' '), value: region }))
  : [])
const siblings = computed(() => selectedElement.value ? layoutElementsInRegion(props.document, selectedElement.value.region) : [])
const selectedIndex = computed(() => siblings.value.findIndex(element => element.id === selectedElement.value?.id))
const menuOptions = computed(() => props.menuSets.map(menu => ({
  label: menu.name,
  value: menu.id,
  description: menu.malformedStoredValue ? 'Needs repair' : `Stable ID: ${menu.id}`,
  disabled: menu.malformedStoredValue
})))
const selectedMenuMissing = computed(() => {
  const element = selectedElement.value
  return element?.type === 'menu'
    && !props.menuPending
    && !props.menuSets.some(menu => menu.id === element.props.menuSetId)
})

function updateGrid(key: 'maxWidth' | 'gap', value: string) {
  const next = structuredClone(props.document)
  ;(next.grid as any)[key] = value
  emit('updateDocument', next)
}

function updateRegionFlow(value: string) {
  const next = structuredClone(props.document)
  const region = next.grid.regions.find(candidate => candidate.id === props.selectedRegionId)
  if (!region) return
  region.flow = value as typeof region.flow
  emit('updateDocument', next)
}

function updatePlacement(viewport: LayoutViewport, key: 'row' | 'column' | 'span', value: number | undefined) {
  if (!Number.isInteger(value)) return
  const next = structuredClone(props.document)
  const region = next.grid.regions.find(candidate => candidate.id === props.selectedRegionId)
  if (!region) return
  region.placement[viewport][key] = value!
  emit('updateDocument', next)
}

function updateVisibility(viewport: LayoutViewport, value: string) {
  const next = structuredClone(props.document)
  const region = next.grid.regions.find(candidate => candidate.id === props.selectedRegionId)
  if (!region) return
  region.placement[viewport].visibility = value as 'visible' | 'hidden'
  emit('updateDocument', next)
}

function fieldValue(key: string) {
  return selectedElement.value ? Reflect.get(selectedElement.value.props, key) : undefined
}

function numberFieldValue(key: string) {
  const value = fieldValue(key)
  return typeof value === 'number' ? value : undefined
}

function stringFieldValue(key: string) {
  const value = fieldValue(key)
  return typeof value === 'string' ? value : ''
}

function fieldOptions(options: readonly { label: string, value: string | number }[] | undefined) {
  return options ? options.map(option => ({ ...option })) : []
}

function updateElementProperty(key: string, value: unknown) {
  const element = selectedElement.value
  if (!element) return
  const next = structuredClone(element.props) as Record<string, unknown>
  if (value === undefined || value === null || value === '') delete next[key]
  else next[key] = value
  emit('updateElement', element.id, next as LayoutElementProps<typeof element.type>)
}

function moveRegion(value: LayoutRegionKey) {
  const element = selectedElement.value
  if (!element || value === element.region) return
  emit('moveElement', element.id, value, layoutElementsInRegion(props.document, value).length)
}
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto p-4">
    <div v-if="selectedElement && descriptor" class="space-y-5" data-layout-element-inspector>
      <div>
        <div class="flex items-center gap-2">
          <UIcon :name="descriptor.icon" class="size-5 text-muted" />
          <h3 class="font-semibold text-highlighted">{{ descriptor.label }}</h3>
        </div>
        <p class="mt-1 text-sm text-muted">{{ descriptor.summary }}</p>
        <p class="mt-1 break-all text-xs text-dimmed">Stable ID: {{ selectedElement.id }}</p>
      </div>

      <UFormField label="Region">
        <USelect
          :model-value="selectedElement.region"
          :items="allowedRegionOptions"
          value-key="value"
          class="w-full"
          data-layout-inspector-region
          @update:model-value="moveRegion($event as LayoutRegionKey)"
        />
      </UFormField>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Element movement">
        <UButton
          type="button"
          icon="i-lucide-arrow-up"
          color="neutral"
          variant="outline"
          :disabled="selectedIndex <= 0"
          :data-layout-element-id="selectedElement.id"
          data-layout-move="up"
          @click="emit('moveElement', selectedElement.id, selectedElement.region, selectedIndex - 1, 'up')"
        >
          Move up
        </UButton>
        <UButton
          type="button"
          icon="i-lucide-arrow-down"
          color="neutral"
          variant="outline"
          :disabled="selectedIndex < 0 || selectedIndex >= siblings.length - 1"
          :data-layout-element-id="selectedElement.id"
          data-layout-move="down"
          @click="emit('moveElement', selectedElement.id, selectedElement.region, selectedIndex + 1, 'down')"
        >
          Move down
        </UButton>
      </div>

      <template v-for="field in descriptor.inspectorFields" :key="field.key">
        <UFormField :label="field.label" :required="field.required">
          <USelect
            v-if="field.control === 'select'"
            :model-value="fieldValue(field.key)"
            :items="fieldOptions(field.options)"
            value-key="value"
            class="w-full"
            :data-layout-property="field.key"
            @update:model-value="updateElementProperty(field.key, $event)"
          />
          <UInputNumber
            v-else-if="field.control === 'integer'"
            :model-value="numberFieldValue(field.key)"
            :min="field.minimum"
            :max="field.maximum"
            class="w-full"
            :data-layout-property="field.key"
            @update:model-value="updateElementProperty(field.key, $event)"
          />
          <USelectMenu
            v-else-if="field.control === 'resource' && field.resourceType === 'menu-set'"
            :model-value="stringFieldValue(field.key)"
            :items="menuOptions"
            value-key="value"
            class="w-full"
            :loading="menuPending"
            placeholder="Choose a Menu set"
            data-layout-menu-picker
            @update:model-value="updateElementProperty(field.key, $event)"
          />
        </UFormField>
        <UAlert
          v-if="field.control === 'resource' && selectedMenuMissing"
          title="Referenced Menu set is missing"
          :description="`The stable ID ${fieldValue(field.key)} is unavailable. Choose another Menu set before saving.`"
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          data-layout-menu-missing
        />
      </template>

      <div class="flex flex-wrap gap-2 border-t border-muted pt-4">
        <UButton
          type="button"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          :disabled="descriptor.deletion === 'required'"
          @click="emit('duplicateElement', selectedElement.id)"
        >
          Duplicate
        </UButton>
        <UButton
          type="button"
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          :disabled="descriptor.deletion === 'required'"
          @click="emit('removeElement', selectedElement.id)"
        >
          Delete
        </UButton>
      </div>
    </div>

    <div v-else class="space-y-5" data-layout-properties-inspector>
      <div>
        <h3 class="font-semibold text-highlighted">Layout properties</h3>
        <p class="text-sm text-muted">Edit the bounded grid and the selected region. Select an element for typed properties.</p>
      </div>
      <UFormField label="Maximum width">
        <USelect
          :model-value="document.grid.maxWidth"
          :items="['content', 'wide', 'full']"
          class="w-full"
          @update:model-value="updateGrid('maxWidth', String($event))"
        />
      </UFormField>
      <UFormField label="Gap">
        <USelect
          :model-value="document.grid.gap"
          :items="['none', 'compact', 'comfortable', 'spacious']"
          class="w-full"
          @update:model-value="updateGrid('gap', String($event))"
        />
      </UFormField>
      <UFormField label="Selected region">
        <USelect
          :model-value="selectedRegionId"
          :items="regionOptions"
          value-key="value"
          class="w-full"
          @update:model-value="emit('selectRegion', $event as LayoutRegionKey)"
        />
      </UFormField>
      <template v-if="selectedRegion">
        <UFormField label="Region flow">
          <USelect
            :model-value="selectedRegion.flow"
            :items="['start', 'center', 'end', 'space-between']"
            class="w-full"
            @update:model-value="updateRegionFlow(String($event))"
          />
        </UFormField>
        <fieldset v-for="viewport in (['mobile', 'tablet', 'desktop'] as LayoutViewport[])" :key="viewport" class="space-y-3 rounded-md border border-muted p-3">
          <legend class="px-1 text-sm font-medium capitalize text-highlighted">{{ viewport }}</legend>
          <div class="grid grid-cols-3 gap-2">
            <UFormField label="Row">
              <UInputNumber :model-value="selectedRegion.placement[viewport].row" :min="1" :max="12" @update:model-value="updatePlacement(viewport, 'row', $event)" />
            </UFormField>
            <UFormField label="Column">
              <UInputNumber :model-value="selectedRegion.placement[viewport].column" :min="1" :max="12" @update:model-value="updatePlacement(viewport, 'column', $event)" />
            </UFormField>
            <UFormField label="Span">
              <UInputNumber :model-value="selectedRegion.placement[viewport].span" :min="1" :max="12" @update:model-value="updatePlacement(viewport, 'span', $event)" />
            </UFormField>
          </div>
          <UFormField label="Visibility">
            <USelect
              :model-value="selectedRegion.placement[viewport].visibility"
              :items="['visible', 'hidden']"
              class="w-full"
              :disabled="selectedRegion.id === 'content'"
              @update:model-value="updateVisibility(viewport, String($event))"
            />
          </UFormField>
        </fieldset>
      </template>
    </div>
  </div>
</template>
