<script setup lang="ts">
import {
  layoutElementRegistry,
  type LayoutDocument,
  type LayoutElement,
  type LayoutElementType,
  type LayoutRegionKey,
  type LayoutViewport
} from '~~/shared/site-layout'
import {
  isLayoutElementDropAllowed,
  isLayoutElementTypeDropAllowed,
  type LayoutEditorDropPayload
} from '~/utils/layout-editor'

const props = defineProps<{
  document: LayoutDocument
  viewport: LayoutViewport
  selectedRegionId: LayoutRegionKey
  selectedElementId?: string
  preview: boolean
}>()
const emit = defineEmits<{
  selectRegion: [regionId: LayoutRegionKey]
  selectElement: [elementId: string]
  drop: [payload: LayoutEditorDropPayload, regionId: LayoutRegionKey, index: number]
}>()

const activeDropTarget = ref('')
const viewportColumns = computed(() => props.document.grid.columns[props.viewport])
const gridGap = computed(() => ({
  none: '0',
  compact: '0.5rem',
  comfortable: '0.75rem',
  spacious: '1.25rem'
})[props.document.grid.gap])
const canvasStyle = computed(() => ({
  width: '100%',
  maxWidth: props.viewport === 'desktop'
    ? ({ content: '64rem', wide: '80rem', full: 'none' })[props.document.grid.maxWidth]
    : props.viewport === 'tablet' ? '48rem' : '24rem'
}))

function regionStyle(region: LayoutDocument['grid']['regions'][number]) {
  const placement = region.placement[props.viewport]
  return {
    gridColumn: `${placement.column} / span ${placement.span}`,
    gridRow: String(placement.row),
    display: props.preview && placement.visibility === 'hidden' ? 'none' : undefined
  }
}

function regionElements(regionId: LayoutRegionKey) {
  return layoutElementsInRegion(props.document, regionId)
}

function horizontalRegion(regionId: LayoutRegionKey) {
  return regionId === 'header' || regionId === 'footer'
}

function regionElementsStyle(region: LayoutDocument['grid']['regions'][number]) {
  const justifyContent = ({
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    'space-between': 'space-between'
  } as const)[region.flow]
  return {
    display: 'flex',
    flexDirection: horizontalRegion(region.id) ? 'row' : 'column',
    flexWrap: horizontalRegion(region.id) ? 'wrap' : 'nowrap',
    justifyContent,
    gap: '0.5rem'
  } as const
}

function startElementDrag(event: DragEvent, element: LayoutElement) {
  if (props.preview || !event.dataTransfer) return
  const payload: LayoutEditorDropPayload = { kind: 'element', elementId: element.id }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-halopress-layout-element', JSON.stringify(payload))
  event.dataTransfer.setData(`application/x-halopress-layout-instance-type-${element.type}`, '1')
  event.dataTransfer.setData('text/plain', `element:${element.id}`)
}

function parseDrop(event: DragEvent): LayoutEditorDropPayload | null {
  try {
    const payload = JSON.parse(event.dataTransfer?.getData('application/x-halopress-layout-element') || '')
    if (payload?.kind === 'palette' && typeof payload.type === 'string' && layoutElementRegistry[payload.type as LayoutElementType]) {
      return { kind: 'palette', type: payload.type as LayoutElementType }
    }
    if (payload?.kind === 'element' && typeof payload.elementId === 'string') {
      return { kind: 'element', elementId: payload.elementId }
    }
  } catch {
    // Invalid drag payloads are intentional no-ops.
  }
  return null
}

function dragFeedback(event: DragEvent) {
  const types = [...(event.dataTransfer?.types ?? [])]
  const palettePrefix = 'application/x-halopress-layout-palette-type-'
  const instancePrefix = 'application/x-halopress-layout-instance-type-'
  const paletteType = types.find(type => type.startsWith(palettePrefix))?.slice(palettePrefix.length)
  if (paletteType && layoutElementRegistry[paletteType as LayoutElementType]) {
    return { type: paletteType as LayoutElementType, fromPalette: true }
  }
  const instanceType = types.find(type => type.startsWith(instancePrefix))?.slice(instancePrefix.length)
  if (instanceType && layoutElementRegistry[instanceType as LayoutElementType]) {
    return { type: instanceType as LayoutElementType, fromPalette: false }
  }
  return null
}

function dragOver(event: DragEvent, regionId: LayoutRegionKey, index: number) {
  if (props.preview || !event.dataTransfer?.types.includes('application/x-halopress-layout-element')) return
  const feedback = dragFeedback(event)
  if (!feedback || !isLayoutElementTypeDropAllowed(
    props.document,
    feedback.type,
    regionId,
    feedback.fromPalette
  )) {
    activeDropTarget.value = ''
    return
  }
  event.preventDefault()
  event.dataTransfer.dropEffect = feedback.fromPalette ? 'copy' : 'move'
  activeDropTarget.value = `${regionId}:${index}`
}

function drop(event: DragEvent, regionId: LayoutRegionKey, index: number) {
  event.preventDefault()
  const payload = parseDrop(event)
  activeDropTarget.value = ''
  if (payload && isLayoutElementDropAllowed(props.document, payload, regionId)) emit('drop', payload, regionId, index)
}

function elementSummary(element: LayoutElement) {
  switch (element.type) {
    case 'page-content': return 'Representative Page content'
    case 'site-logo': return `${element.props.size} Site logo`
    case 'site-title': return `${element.props.emphasis} Site title`
    case 'menu': return `Menu: ${element.props.menuSetId}`
    case 'page-list': return `${element.props.limit} Pages · ${element.props.scope}`
    case 'table-of-contents': return `Headings through level ${element.props.maxDepth}`
    case 'copyright': return element.props.startYear ? `Copyright from ${element.props.startYear}` : 'Current-year copyright'
  }
}
</script>

<template>
  <div
    class="mx-auto min-h-full transition-[max-width] duration-200"
    :style="canvasStyle"
    data-layout-canvas
    :data-layout-viewport="viewport"
  >
    <div
      class="grid min-h-full auto-rows-min rounded-lg border border-muted bg-default p-3 shadow-sm sm:p-5"
      :style="{ gridTemplateColumns: `repeat(${viewportColumns}, minmax(0, 1fr))`, gap: gridGap }"
      :class="preview ? 'pointer-events-none' : ''"
      :data-layout-preview="preview || undefined"
    >
      <section
        v-for="region in document.grid.regions"
        :key="region.id"
        class="min-h-28 min-w-0 rounded-md border p-2"
        :class="[
          selectedRegionId === region.id && !preview ? 'border-primary ring-1 ring-primary/30' : 'border-muted',
          region.placement[viewport].visibility === 'hidden' && !preview ? 'opacity-55' : ''
        ]"
        :style="regionStyle(region)"
        :aria-label="`${region.id.replaceAll('-', ' ')} region`"
        :data-layout-region="region.id"
        @click="emit('selectRegion', region.id)"
        @dragover="dragOver($event, region.id, regionElements(region.id).length)"
        @drop="drop($event, region.id, regionElements(region.id).length)"
      >
        <div v-if="!preview" class="mb-2 flex items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ region.id.replaceAll('-', ' ') }}
          </span>
          <UBadge v-if="region.placement[viewport].visibility === 'hidden'" color="neutral" variant="soft" size="xs">
            Hidden
          </UBadge>
        </div>

        <div :style="regionElementsStyle(region)">
          <template v-for="(element, index) in regionElements(region.id)" :key="element.id">
            <div
              v-if="!preview && activeDropTarget === `${region.id}:${index}`"
              class="shrink-0 rounded bg-primary"
              :class="horizontalRegion(region.id) ? 'min-h-12 w-0.5' : 'h-0.5 w-full'"
              data-layout-drop-indicator
            />
            <article
              class="min-w-28 flex-1 rounded-md border bg-elevated p-3 text-left"
              :class="selectedElementId === element.id && !preview ? 'border-primary ring-1 ring-primary/30' : 'border-default'"
              :draggable="!preview"
              :tabindex="preview ? -1 : 0"
              :data-layout-element-select="element.id"
              @click.stop="emit('selectElement', element.id)"
              @keydown.enter.stop="emit('selectElement', element.id)"
              @keydown.space.prevent.stop="emit('selectElement', element.id)"
              @dragstart="startElementDrag($event, element)"
              @dragover.stop="dragOver($event, region.id, index)"
              @drop.stop="drop($event, region.id, index)"
            >
              <div class="flex items-center gap-2">
                <UIcon :name="layoutElementRegistry[element.type].icon" class="size-4 shrink-0 text-muted" />
                <span class="truncate text-sm font-medium text-highlighted">
                  {{ layoutElementRegistry[element.type].label }}
                </span>
                <UIcon v-if="!preview" name="i-lucide-grip-vertical" class="ml-auto size-4 shrink-0 text-dimmed" aria-hidden="true" />
              </div>
              <p class="mt-1 truncate text-xs text-muted">{{ elementSummary(element) }}</p>
            </article>
          </template>
          <div
            v-if="!preview && activeDropTarget === `${region.id}:${regionElements(region.id).length}`"
            class="shrink-0 rounded bg-primary"
            :class="horizontalRegion(region.id) ? 'min-h-12 w-0.5' : 'h-0.5 w-full'"
            data-layout-drop-indicator
          />
          <p v-if="!regionElements(region.id).length" class="w-full rounded border border-dashed border-muted p-3 text-center text-xs text-dimmed">
            Empty region
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
