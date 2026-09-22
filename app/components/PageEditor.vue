<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { mapEditorItems } from '@nuxt/ui/utils/editor'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { markRaw } from 'vue'
import { convertLegacyPageHero, type PageHeroAttrs } from '~~/shared/page-hero'
import { clonePagePatternContent, pagePatternRegistry, type PagePatternKey } from '~~/shared/page-patterns'

import PageEditorPanel from '~/components/page-editor/PageEditorPanel.vue'
import RichEditorLinkPopover from '~/components/cms/RichEditorLinkPopover.vue'
import PageBlock from '~/editor/page/PageBlock'
import PageBlockNodeView from '~/editor/page/PageBlockNodeView.vue'
import PageHero, { selectedPageHero } from '~/editor/page/PageHero'
import PageHeroNodeView from '~/editor/page/PageHeroNodeView.vue'
import { focusPageLibraryInsertion, pageLibraryInsertionPosition } from '~/editor/page/insertion'
import { clonePageBlockAttrs } from '~/editor/page/inspector-state'
import type { PagePaletteItem } from '~/editor/page/palette'
import { getPageBlockComponent, pageBlockRegistry } from '~/editor/page/registry'
import { scrollPageContentIntoView } from '~/editor/page/scroll'
import { clearPageBlockSelection } from '~/editor/page/selection'
import type { PageBlockAttrs, PageBlockComponentKey } from '~/editor/page/types'
import { createPageProfile, getPageToolbarGroups } from '~/editor/profiles'
import type { EditorProfileCustomization } from '~/editor/profiles'
import ImageUpload from '~/editor/RichEditorImageUpload'
import RichEditorImageUploadNode from '~/editor/RichEditorImageUploadNode.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  editable?: boolean
  profile?: EditorProfileCustomization
  pageValidationMessage?: string
  publishedLayoutId?: string | null
  hasPublishedRevision?: boolean
}>(), {
  editable: true,
  profile: () => ({})
})

const value = defineModel<JSONContent | null>({ default: null })
const pageTitle = defineModel<string>('pageTitle', { default: '' })
const publicPath = defineModel<string>('publicPath', { default: '' })
const description = defineModel<string>('description', { default: '' })
const socialImageAssetId = defineModel<string>('socialImageAssetId', { default: '' })
const layoutId = defineModel<string | null>('layoutId', { default: null })

const PageBlockEditor = PageBlock.extend({
  addNodeView() {
    return VueNodeViewRenderer(PageBlockNodeView)
  }
})
const PageHeroEditor = PageHero.extend({
  addNodeView() {
    return VueNodeViewRenderer(PageHeroNodeView)
  }
})
const ImageUploadEditor = ImageUpload.extend({
  addNodeView() {
    return VueNodeViewRenderer(RichEditorImageUploadNode)
  }
})
const editorProfile = createPageProfile(props.profile, {
  pageBlockFactory: () => PageBlockEditor.configure({}),
  pageHeroFactory: () => PageHeroEditor.configure({}),
  imageUploadFactory: () => ImageUploadEditor.configure({})
})
const extensions = markRaw(editorProfile.extensions.map(extension => markRaw(extension)))

const editorRef = ref<any>(null)
const canvasRef = ref<HTMLElement | null>(null)
const toolbarHostRef = ref<HTMLElement | null>(null)
const selectedBlock = ref<PageBlockAttrs | null>(null)
const selectedHero = ref<PageHeroAttrs | null>(null)
const selectedDragNode = ref<{ node: JSONContent | null, pos: number } | null>(null)
const mode = ref<'edit' | 'preview'>('edit')
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const activePanel = ref<'library' | 'inspector'>('inspector')
const panelCollapsed = ref(false)
const mobilePanelOpen = ref(false)
const dropPosition = ref<number | null>(null)
const dropIndicatorTop = ref<number | null>(null)
let desktopPanelMediaQuery: MediaQueryList | null = null
let refocusEditorAfterMobilePanelClose = false
const desktopPanelMediaQueryText = '(min-width: 1024px)'

const isEditMode = computed(() => mode.value === 'edit')
const isEditing = computed(() => props.editable && isEditMode.value)
const activeComponent = computed(() => getPageBlockComponent(selectedBlock.value?.component))
const activeFields = computed(() => activeComponent.value?.fields ?? [])
const legacyHeroConversion = computed(() => selectedBlock.value?.component === 'pageHero'
  ? convertLegacyPageHero(selectedBlock.value)
  : null)
const toolbarGroups = computed(() => getPageToolbarGroups(
  editorProfile.toolbarGroups,
  selectedBlock.value ? 'pageBlock' : null
))

const viewportItems = [
  { label: 'Desktop', value: 'desktop', icon: 'i-lucide-monitor' },
  { label: 'Tablet', value: 'tablet', icon: 'i-lucide-tablet' },
  { label: 'Mobile', value: 'mobile', icon: 'i-lucide-smartphone' }
]
const isFullWidthCanvas = computed(() => viewport.value === 'desktop')
const canvasStyle = computed(() => ({
  width: '100%',
  maxWidth: viewport.value === 'desktop' ? 'none' : viewport.value === 'tablet' ? '48rem' : '24rem'
}))
const canvasShellClass = computed(() => isFullWidthCanvas.value ? 'p-0' : 'p-3 sm:p-5')
const canvasSurfaceClass = computed(() => isFullWidthCanvas.value
  ? 'rounded-none border-0 shadow-none'
  : 'rounded-md border border-muted shadow-sm')
const workspaceColumns = computed(() => {
  if (!isEditMode.value || panelCollapsed.value) return 'lg:grid-cols-1'
  return 'lg:grid-cols-[minmax(0,1fr)_22rem]'
})

function usesDesktopPanel() {
  return desktopPanelMediaQuery?.matches
    ?? (import.meta.client && window.matchMedia(desktopPanelMediaQueryText).matches)
}

function handlePanelBreakpointChange(event: MediaQueryListEvent) {
  if (event.matches) mobilePanelOpen.value = false
}

onMounted(() => {
  desktopPanelMediaQuery = window.matchMedia(desktopPanelMediaQueryText)
  desktopPanelMediaQuery.addEventListener('change', handlePanelBreakpointChange)
})

onBeforeUnmount(() => {
  desktopPanelMediaQuery?.removeEventListener('change', handlePanelBreakpointChange)
})

function getEditor() {
  return (editorRef.value?.editor ?? null) as Editor | null
}

function syncSelection(editor: Editor) {
  const selection: any = editor.state.selection
  const node = selection.node
  selectedBlock.value = node?.type?.name === 'pageBlock'
    ? clonePageBlockAttrs(node.attrs as PageBlockAttrs)
    : null
  selectedHero.value = selectedPageHero(editor.state)?.attrs ?? null
  if (selectedBlock.value || selectedHero.value) activePanel.value = 'inspector'
}

watch(getEditor, (editor, _previous, onCleanup) => {
  if (!editor) return
  const handler = () => syncSelection(editor)
  editor.on('selectionUpdate', handler)
  editor.on('update', handler)
  handler()
  onCleanup(() => {
    editor.off('selectionUpdate', handler)
    editor.off('update', handler)
  })
}, { immediate: true })

function blockAttrs(key: PageBlockComponentKey): PageBlockAttrs & { component: PageBlockComponentKey } {
  const entry = pageBlockRegistry.byKey[key]
  return {
    component: entry.key,
    props: structuredClone(entry.defaultProps),
    advanced: {},
    media: structuredClone(entry.defaultMedia)
  }
}

function finishPageLibraryInsertion(editor: Editor) {
  const closingMobilePanel = mobilePanelOpen.value && !usesDesktopPanel()
  if (closingMobilePanel) refocusEditorAfterMobilePanelClose = true
  mobilePanelOpen.value = false
  if (!closingMobilePanel) focusPageLibraryInsertion(editor)
}

function handleMobilePanelCloseAutoFocus(event: Event) {
  if (!refocusEditorAfterMobilePanelClose) return
  event.preventDefault()
  refocusEditorAfterMobilePanelClose = false
  focusPageLibraryInsertion(getEditor())
}

function insertBlock(key: PageBlockComponentKey, position?: number) {
  const editor = getEditor()
  if (!editor || !isEditing.value || !pageBlockRegistry.byKey[key]) return false
  const destination = position ?? pageLibraryInsertionPosition(editor.state)
  const inserted = editor.commands.insertPageBlockAt(destination, blockAttrs(key))
  if (inserted) {
    finishPageLibraryInsertion(editor)
    scrollPageContentIntoView(editor, destination)
  }
  return inserted
}

function insertPattern(key: PagePatternKey, position?: number) {
  const editor = getEditor()
  if (!editor || !isEditing.value || !pagePatternRegistry.byKey[key]) return false
  const destination = position ?? pageLibraryInsertionPosition(editor.state)
  const inserted = editor.commands.insertPagePatternAt(destination, clonePagePatternContent(key))
  if (inserted) {
    finishPageLibraryInsertion(editor)
    scrollPageContentIntoView(editor, destination)
  }
  return inserted
}

function insertPaletteItem(item: PagePaletteItem, position?: number) {
  return item.source === 'block'
    ? insertBlock(item.key, position)
    : insertPattern(item.key, position)
}

function updateSelectedBlock(attrs: PageBlockAttrs) {
  const editor = getEditor()
  if (!editor || !isEditing.value) return
  editor.commands.updatePageBlockAttributes(attrs)
}

function updateSelectedHero(attrs: Partial<PageHeroAttrs>) {
  const editor = getEditor()
  if (!editor || !isEditing.value) return
  editor.commands.updatePageHeroAttributes(attrs)
}

function convertSelectedHero() {
  const editor = getEditor()
  if (!editor || !isEditing.value) return
  const position = editor.state.selection.from
  if (editor.commands.convertLegacyPageHeroBlock()) {
    scrollPageContentIntoView(editor, position)
  }
}

function showPageProperties() {
  const editor = getEditor()
  if (editor) {
    clearPageBlockSelection(editor)
  }
  selectedBlock.value = null
  selectedHero.value = null
  activePanel.value = 'inspector'
}

function openPanel(tab: 'library' | 'inspector') {
  if (!isEditMode.value) return
  activePanel.value = tab
  if (usesDesktopPanel()) {
    panelCollapsed.value = false
  } else {
    mobilePanelOpen.value = true
  }
}

function togglePanel() {
  if (!isEditMode.value) return
  if (usesDesktopPanel()) {
    panelCollapsed.value = !panelCollapsed.value
  } else {
    mobilePanelOpen.value = !mobilePanelOpen.value
  }
}

const getDragHandleItems = (editor: Editor): DropdownMenuItem[][] => {
  const selected = selectedDragNode.value
  if (!selected?.node?.type) return []
  const groups = editorProfile.quickMenuGroups.flatMap(create => create({
    editor,
    node: selected.node!,
    pos: selected.pos
  }))
  return mapEditorItems(editor, groups as any, editorProfile.handlers) as DropdownMenuItem[][]
}

function onDragNodeChange(event: { node: JSONContent | null, pos: number }) {
  selectedDragNode.value = event
}

function selectDragNode(editor: Editor) {
  const selected = selectedDragNode.value
  if (selected?.node && Number.isInteger(selected.pos)) editor.commands.setNodeSelection(selected.pos)
}

function setDragMenuOpen(editor: Editor, open: boolean) {
  if (open) selectDragNode(editor)
  editor.chain().setMeta('lockDragHandle', open).run()
}

function startPaletteDrag(event: DragEvent, item: PagePaletteItem) {
  if (!isEditing.value || !event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  const payload = JSON.stringify(item)
  event.dataTransfer.setData('application/x-halopress-page-library', payload)
  event.dataTransfer.setData('text/plain', `${item.model}:${item.key}`)
}

function dropTargetAt(editor: Editor, clientX: number, clientY: number) {
  const coordinates = editor.view.posAtCoords({ left: clientX, top: clientY })
  if (!coordinates) return null
  const children: Array<{ position: number; end: number; element: HTMLElement }> = []
  editor.state.doc.forEach((node, position) => {
    const dom = editor.view.nodeDOM(position)
    if (dom instanceof HTMLElement) children.push({ position, end: position + node.nodeSize, element: dom })
  })
  if (!children.length) return { position: 0, top: 0 }
  const canvasRect = canvasRef.value?.getBoundingClientRect()
  for (const child of children) {
    const rect = child.element.getBoundingClientRect()
    if (clientY <= rect.top + rect.height / 2) {
      return { position: child.position, top: canvasRect ? rect.top - canvasRect.top : 0 }
    }
  }
  const last = children.at(-1)!
  const rect = last.element.getBoundingClientRect()
  return { position: last.end, top: canvasRect ? rect.bottom - canvasRect.top : rect.bottom }
}

function handleCanvasDragOver(event: DragEvent) {
  if (!isEditing.value || !event.dataTransfer?.types.includes('application/x-halopress-page-library')) return
  const editor = getEditor()
  if (!editor) return
  const target = dropTargetAt(editor, event.clientX, event.clientY)
  if (!target) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropPosition.value = target.position
  dropIndicatorTop.value = target.top
}

function clearDropTarget() {
  dropPosition.value = null
  dropIndicatorTop.value = null
}

function handleCanvasDrop(event: DragEvent) {
  event.preventDefault()
  const position = dropPosition.value
  let item: PagePaletteItem | null = null
  try {
    const parsed = JSON.parse(event.dataTransfer?.getData('application/x-halopress-page-library') || '')
    if (parsed?.source === 'block' && parsed?.model === 'configured-block' && parsed.key === 'pageLogos') {
      item = { model: 'configured-block', source: 'block', key: 'pageLogos' }
    } else if (parsed?.source === 'pattern' && pagePatternRegistry.byKey[parsed.key as PagePatternKey]
      && pagePatternRegistry.byKey[parsed.key as PagePatternKey].model === parsed.model) {
      item = { model: parsed.model, source: 'pattern', key: parsed.key as PagePatternKey }
    }
  } catch {
    item = null
  }
  if (!item || position === null) {
    clearDropTarget()
    return
  }
  insertPaletteItem(item, position)
  clearDropTarget()
}

defineShortcuts({
  meta_shift_p: () => { mode.value = mode.value === 'edit' ? 'preview' : 'edit' },
  meta_shift_b: () => openPanel('library'),
  meta_shift_i: () => openPanel('inspector')
})

watch(mode, (nextMode) => {
  if (nextMode === 'preview') mobilePanelOpen.value = false
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-muted/30" data-page-editor-workspace>
    <UDashboardToolbar>
      <template #left>
        <UButton
          :label="mode === 'edit' ? 'Preview' : 'Edit'"
          :icon="mode === 'edit' ? 'i-lucide-eye' : 'i-lucide-pencil'"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!editable"
          @click="mode = mode === 'edit' ? 'preview' : 'edit';"
        />
        <UFieldGroup
          size="sm"
          role="group"
          aria-label="Canvas viewport"
          data-page-editor-viewport-group
        >
          <UButton
            v-for="item in viewportItems"
            :key="item.value"
            :label="item.label"
            :icon="item.icon"
            :aria-label="item.label"
            color="neutral"
            :variant="viewport === item.value ? 'soft' : 'ghost'"
            :ui="{ label: 'hidden lg:inline' }"
            @click="viewport = item.value as typeof viewport;"
          />
        </UFieldGroup>
      </template>

      <template #right>
        <UButton
          v-if="isEditMode"
          aria-label="Toggle page editor panel"
          data-page-editor-panel-toggle
          icon="i-lucide-panel-right"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="togglePanel"
        />
      </template>
    </UDashboardToolbar>

    <div class="grid min-h-0 flex-1 grid-cols-1" :class="workspaceColumns">
      <main
        class="flex min-h-0 min-w-0 flex-col"
      >
        <div
          v-show="isEditing"
          ref="toolbarHostRef"
          class="sticky top-0 z-20 min-h-12 shrink-0 overflow-x-auto border-b border-muted bg-default/95 backdrop-blur"
          data-page-editor-toolbar-host
        />
        <div
          class="min-h-0 flex-1 overflow-auto"
          :class="canvasShellClass"
          aria-label="Page canvas"
          data-page-editor-canvas-shell
        >
          <div
            ref="canvasRef"
            class="relative mx-auto h-full min-h-0 transition-[max-width] duration-200"
            :style="canvasStyle"
            data-page-editor-canvas
            @dragover="handleCanvasDragOver"
            @dragleave.self="clearDropTarget"
            @drop="handleCanvasDrop"
          >
            <div v-if="dropIndicatorTop !== null" class="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-primary" :style="{ top: `${dropIndicatorTop}px` }" data-page-block-drop-indicator />
            <div
              v-show="mode === 'edit'"
              class="h-full min-h-0"
              :aria-hidden="mode === 'preview'"
              data-page-editor-edit-surface
            >
              <UEditor
                ref="editorRef"
                v-slot="{ editor }"
                v-model="value"
                content-type="json"
                :extensions="extensions"
                :handlers="editorProfile.handlers"
                :editable="isEditing"
                class="flex h-full min-h-0 w-full flex-col bg-default"
                :class="canvasSurfaceClass"
                :ui="{ base: 'min-h-full px-4 py-4 sm:px-6' }"
              >
                <Teleport v-if="isEditing && toolbarHostRef" :to="toolbarHostRef">
                  <UEditorToolbar
                    :editor="editor"
                    :items="toolbarGroups"
                    class="min-h-12 w-max min-w-full flex-nowrap px-2 py-2"
                  >
                    <template #link="{ item, isDisabled }">
                      <RichEditorLinkPopover :editor="editor" auto-open :disabled="isDisabled(item)" />
                    </template>
                  </UEditorToolbar>
                </Teleport>

                <UEditorDragHandle
                  v-if="isEditing"
                  v-slot="{ ui }"
                  :editor="editor"
                  :plugin-key="editorProfile.pluginKeys.dragHandle"
                  class="inline-flex"
                  @node-change="onDragNodeChange"
                >
                  <UDropdownMenu
                    v-slot="{ open }"
                    :modal="false"
                    :items="getDragHandleItems(editor)"
                    :content="{ side: 'left' }"
                    :ui="{ content: 'w-48', label: 'text-xs' }"
                    @update:open="setDragMenuOpen(editor, $event)"
                  >
                    <UButton
                      color="neutral"
                      variant="ghost"
                      active-variant="soft"
                      size="sm"
                      icon="i-lucide-grip-vertical"
                      :active="open"
                      :class="ui.handle()"
                      aria-label="Block actions"
                    />
                  </UDropdownMenu>
                </UEditorDragHandle>
              </UEditor>
            </div>
            <PageDocumentRenderer
              v-show="mode === 'preview'"
              :document="value"
              class="min-h-full bg-default px-4 py-4 sm:px-6"
              :class="canvasSurfaceClass"
              data-page-editor-preview-surface
            />
          </div>
        </div>
      </main>

      <aside v-if="isEditMode && !panelCollapsed" class="hidden min-h-0 border-l border-muted bg-default lg:flex lg:flex-col" aria-label="Page editor panel">
        <PageEditorPanel
          v-model:active-tab="activePanel"
          v-model:page-title="pageTitle"
          v-model:public-path="publicPath"
          v-model:description="description"
          v-model:social-image-asset-id="socialImageAssetId"
          v-model:layout-id="layoutId"
          :selected-block="selectedBlock"
          :selected-hero="selectedHero"
          :active-fields="activeFields"
          :active-label="activeComponent?.label"
          :editable="isEditing"
          :page-validation-message="pageValidationMessage"
          :published-layout-id="props.publishedLayoutId"
          :has-published-revision="props.hasPublishedRevision"
          :legacy-hero-conversion="legacyHeroConversion"
          @insert="insertPaletteItem"
          @dragstart="startPaletteDrag"
          @update-block="updateSelectedBlock"
          @update-hero="updateSelectedHero"
          @convert-legacy-hero="convertSelectedHero"
          @show-page-properties="showPageProperties"
        />
      </aside>
    </div>

    <USlideover
      v-if="isEditMode"
      v-model:open="mobilePanelOpen"
      title="Page editor"
      side="right"
      :content="{ onCloseAutoFocus: handleMobilePanelCloseAutoFocus }"
      :ui="{ body: 'p-0 sm:p-0 min-h-0' }"
    >
      <template #body>
        <PageEditorPanel
          v-model:active-tab="activePanel"
          v-model:page-title="pageTitle"
          v-model:public-path="publicPath"
          v-model:description="description"
          v-model:social-image-asset-id="socialImageAssetId"
          v-model:layout-id="layoutId"
          :selected-block="selectedBlock"
          :selected-hero="selectedHero"
          :active-fields="activeFields"
          :active-label="activeComponent?.label"
          :editable="isEditing"
          :page-validation-message="pageValidationMessage"
          :published-layout-id="props.publishedLayoutId"
          :has-published-revision="props.hasPublishedRevision"
          :legacy-hero-conversion="legacyHeroConversion"
          @insert="insertPaletteItem"
          @dragstart="startPaletteDrag"
          @update-block="updateSelectedBlock"
          @update-hero="updateSelectedHero"
          @convert-legacy-hero="convertSelectedHero"
          @show-page-properties="showPageProperties"
        />
      </template>
    </USlideover>
  </div>
</template>
