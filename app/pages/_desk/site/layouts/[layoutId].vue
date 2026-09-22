<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { ulid } from 'ulid'

import {
  deleteLayoutElement,
  duplicateLayoutElement,
  insertLayoutElement,
  layoutDuplicateSchema,
  layoutElementRegistry,
  layoutNameSchema,
  parseLayoutDocument,
  serializeLayoutDocument,
  type LayoutAdminResource,
  type LayoutDocument,
  type LayoutElement,
  type LayoutElementDescriptor,
  type LayoutElementType,
  type LayoutRegionKey,
  type LayoutValidationIssue,
  type LayoutViewport
} from '~~/shared/site-layout'
import LayoutCanvas from '~/components/layout-editor/LayoutCanvas.vue'
import LayoutEditorPanel from '~/components/layout-editor/LayoutEditorPanel.vue'
import LayoutElementCreateForm from '~/components/layout-editor/LayoutElementCreateForm.vue'
import type { LayoutEditorDropPayload } from '~/utils/layout-editor'

definePageMeta({ layout: 'desk' })

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirmDialog()
const {
  data,
  pending,
  status,
  error,
  loadLayout,
  saveLayout,
  renameLayout,
  duplicateLayout,
  deleteLayout,
  saving,
  renaming,
  duplicating,
  deleting
} = useLayoutResources()
const {
  data: menuData,
  pending: menuPending
} = useSiteMenusStatus()

const layoutId = computed(() => {
  const value = route.params.layoutId
  return Array.isArray(value) ? value[0] || '' : String(value || '')
})
const sourceResource = computed(() => data.value?.items.find(layout => layout.id === layoutId.value) ?? null)
const missingResource = computed(() => status.value === 'success' && Boolean(data.value) && !sourceResource.value)

const workingId = ref('')
const workingName = ref('')
const baselineName = ref('')
const workingRevision = ref(0)
const baselineDocument = ref('')
const history = ref<LayoutEditorHistory | null>(null)
const workingUsage = ref<LayoutAdminResource['usage']>([])
const workingCanDelete = ref(false)
const repairResource = ref<Extract<LayoutAdminResource, { status: 'repair-required' }> | null>(null)
const validationIssues = ref<LayoutValidationIssue[]>([])
const staleConflict = ref<{ currentRevision: number, updatedBy: string | null } | null>(null)
const mode = ref<'edit' | 'preview'>('edit')
const viewport = ref<LayoutViewport>('desktop')
const activePanel = ref<'elements' | 'inspector'>('elements')
const panelCollapsed = ref(false)
const mobilePanelOpen = ref(false)
const isDesktop = ref(false)
const pickerWide = ref(false)
const announcement = ref('')
const elementPickerOpen = ref(false)
const pickerDescriptor = ref<LayoutElementDescriptor | null>(null)
const pickerState = reactive<{ regionId: LayoutRegionKey, menuSetId: string }>({ regionId: 'content', menuSetId: '' })
const pendingElementCreation = ref<{ element: LayoutElement, layoutId: string } | null>(null)
const elementPickerFormId = 'layout-element-create-form'
const duplicateOpen = ref(false)
const duplicateState = reactive({ name: '' })
const duplicateNameError = ref('')
const duplicateFormId = 'layout-resource-duplicate-form'
const pendingDuplicate = ref<{ resource: LayoutAdminResource, layoutId: string, token: number } | null>(null)
let desktopMediaQuery: MediaQueryList | null = null
let pickerMediaQuery: MediaQueryList | null = null
let latestSaveToken = 0
let latestRenameToken = 0
let latestReloadToken = 0
let latestDuplicateToken = 0

const document = computed(() => history.value?.current.document ?? null)
const selection = computed(() => history.value?.current.selection ?? { regionId: 'content' as LayoutRegionKey })
const currentSnapshot = computed(() => document.value ? serializeLayoutDocument(document.value) : '')
const documentDirty = computed(() => Boolean(document.value && currentSnapshot.value !== baselineDocument.value))
const nameDirty = computed(() => Boolean(workingId.value && workingName.value !== baselineName.value))
const isDirty = computed(() => documentDirty.value || nameDirty.value)
const currentResourceReady = computed(() => sourceResource.value?.status === 'ready'
  && Boolean(document.value)
  && isCurrentLayoutResourceReady(
    status.value,
    pending.value,
    Boolean(error.value),
    layoutId.value,
    sourceResource.value.id,
    workingId.value
  ))
const descriptors = computed(() => data.value?.elementDescriptors ?? [])
const missingMenuElements = computed(() => {
  if (!document.value || menuPending.value) return []
  const menuIds = new Set((menuData.value?.items ?? []).map(menu => menu.id))
  return document.value.elements.filter(element => element.type === 'menu' && !menuIds.has(element.props.menuSetId))
})
const busy = computed(() => saving.value || renaming.value || duplicating.value || deleting.value)

const { allowNextNavigation } = useUnsavedNavigationGuard(
  isDirty,
  'You have unsaved Layout changes. Leave and discard them?'
)

function loadWorkingResource(resource: LayoutAdminResource) {
  workingId.value = resource.id
  workingName.value = resource.name
  baselineName.value = resource.name
  workingRevision.value = resource.revision
  workingUsage.value = structuredClone(resource.usage)
  workingCanDelete.value = resource.canDelete
  validationIssues.value = []
  staleConflict.value = null
  if (resource.status === 'repair-required') {
    repairResource.value = structuredClone(resource)
    history.value = null
    baselineDocument.value = ''
    return
  }
  repairResource.value = null
  const previousSelection = history.value?.current.selection
  history.value = createLayoutEditorHistory(
    resource.document,
    previousSelection ?? { regionId: resource.document.grid.regions.find(region => region.id === 'content')?.id ?? resource.document.grid.regions[0]!.id }
  )
  baselineDocument.value = serializeLayoutDocument(resource.document)
}

watch([sourceResource, status, layoutId], ([resource, requestStatus, currentLayoutId]) => {
  if (requestStatus !== 'success') return
  if (!resource) {
    if (workingId.value && workingId.value !== currentLayoutId) {
      workingId.value = ''
      history.value = null
      repairResource.value = null
      baselineDocument.value = ''
    }
    return
  }
  if (workingId.value !== resource.id) loadWorkingResource(resource)
}, { immediate: true })

function handleDesktopBreakpoint(event: MediaQueryListEvent) {
  isDesktop.value = event.matches
  if (event.matches) mobilePanelOpen.value = false
}

function handlePickerBreakpoint(event: MediaQueryListEvent) {
  pickerWide.value = event.matches
}

onMounted(() => {
  desktopMediaQuery = window.matchMedia('(min-width: 1024px)')
  pickerMediaQuery = window.matchMedia('(min-width: 640px)')
  isDesktop.value = desktopMediaQuery.matches
  pickerWide.value = pickerMediaQuery.matches
  desktopMediaQuery.addEventListener('change', handleDesktopBreakpoint)
  pickerMediaQuery.addEventListener('change', handlePickerBreakpoint)
})

onBeforeUnmount(() => {
  desktopMediaQuery?.removeEventListener('change', handleDesktopBreakpoint)
  pickerMediaQuery?.removeEventListener('change', handlePickerBreakpoint)
})

function usesDesktopPanel() {
  return desktopMediaQuery?.matches
    ?? (import.meta.client && window.matchMedia('(min-width: 1024px)').matches)
}

function setSelection(next: LayoutEditorSelection) {
  if (!history.value || !document.value) return
  history.value = {
    ...history.value,
    current: {
      document: history.value.current.document,
      selection: normalizeLayoutSelection(document.value, next)
    }
  }
}

function selectRegion(regionId: LayoutRegionKey) {
  setSelection({ regionId })
  activePanel.value = 'inspector'
  if (!usesDesktopPanel()) mobilePanelOpen.value = true
}

function selectElement(elementId: string) {
  if (!document.value) return
  const element = selectedLayoutElement(document.value, elementId)
  if (!element) return
  setSelection({ regionId: element.region, elementId })
  activePanel.value = 'inspector'
  if (!usesDesktopPanel()) mobilePanelOpen.value = true
}

function commitDocument(next: LayoutDocument, nextSelection: LayoutEditorSelection = selection.value) {
  if (!history.value) return false
  const parsed = parseLayoutDocument(next)
  if (!parsed.success) {
    validationIssues.value = parsed.issues
    toast.add({
      title: 'That Layout change is not valid',
      description: parsed.issues[0]?.message || 'Review the selected region or element.',
      color: 'warning'
    })
    return false
  }
  const nextHistory = commitLayoutEditorHistory(history.value, parsed.document, nextSelection)
  if (nextHistory === history.value) return false
  history.value = nextHistory
  validationIssues.value = []
  return true
}

function updateElement(elementId: string, nextProps: LayoutElement['props']) {
  if (!document.value) return
  const next = structuredClone(document.value)
  const element = next.elements.find(candidate => candidate.id === elementId)
  if (!element) return
  ;(element as LayoutElement).props = structuredClone(nextProps) as any
  commitDocument(next, { regionId: element.region, elementId })
}

async function moveElement(
  elementId: string,
  regionId: LayoutRegionKey,
  index: number,
  direction?: 'up' | 'down'
) {
  if (!document.value) return
  const before = document.value
  const next = moveLayoutElementOrNoop(before, elementId, regionId, index)
  if (next === before || serializeLayoutDocument(next) === serializeLayoutDocument(before)) return
  if (!commitDocument(next, { regionId, elementId })) return
  const label = layoutElementRegistry[selectedLayoutElement(next, elementId)!.type].label
  announcement.value = `Moved ${label} to ${regionId.replaceAll('-', ' ')} position ${index + 1}.`
  if (direction) {
    await nextTick()
    focusLayoutMoveControl(elementId, direction)
  }
}

function duplicateElement(elementId: string) {
  if (!document.value) return
  try {
    const next = duplicateLayoutElement(document.value, elementId, `element-${ulid()}`)
    const source = selectedLayoutElement(document.value, elementId)!
    const siblings = layoutElementsInRegion(next, source.region)
    const duplicate = siblings[siblings.findIndex(element => element.id === elementId) + 1]
    if (!duplicate) return
    commitDocument(next, { regionId: duplicate.region, elementId: duplicate.id })
    announcement.value = `Duplicated ${layoutElementRegistry[duplicate.type].label}.`
  } catch (mutationError: any) {
    toast.add({ title: 'Could not duplicate element', description: mutationError.message, color: 'warning' })
  }
}

function removeElement(elementId: string) {
  if (!document.value) return
  const nextSelection = nextLayoutSelectionAfterDelete(document.value, elementId)
  try {
    const next = deleteLayoutElement(document.value, elementId)
    if (commitDocument(next, nextSelection)) announcement.value = 'Element deleted.'
  } catch (mutationError: any) {
    toast.add({ title: 'Could not delete element', description: mutationError.message, color: 'warning' })
  }
}

function startPaletteDrag(event: DragEvent, type: LayoutElementType) {
  if (!event.dataTransfer || !document.value || !allowedLayoutRegions(document.value, type).length) return
  const payload: LayoutEditorDropPayload = { kind: 'palette', type }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-halopress-layout-element', JSON.stringify(payload))
  event.dataTransfer.setData(`application/x-halopress-layout-palette-type-${type}`, '1')
  event.dataTransfer.setData('text/plain', `palette:${type}`)
}

function handleCanvasDrop(payload: LayoutEditorDropPayload, regionId: LayoutRegionKey, index: number) {
  if (!document.value) return
  if (payload.kind === 'element') {
    const targetIndex = layoutElementDropIndex(document.value, payload.elementId, regionId, index)
    moveElement(payload.elementId, regionId, targetIndex)
    return
  }
  try {
    const element = createLayoutElement(payload.type, regionId, `element-${ulid()}`)
    const next = insertLayoutElement(document.value, element, index)
    if (commitDocument(next, { regionId, elementId: element.id })) {
      activePanel.value = 'inspector'
      announcement.value = `Added ${layoutElementRegistry[element.type].label}.`
    }
  } catch (mutationError: any) {
    toast.add({ title: 'That element cannot be placed there', description: mutationError.message, color: 'warning' })
  }
}

function requestElementAdd(type: LayoutElementType) {
  if (!document.value) return
  const descriptor = descriptors.value.find(item => item.type === type)
  const regions = allowedLayoutRegions(document.value, type)
  if (!descriptor || !regions.length) return
  pickerDescriptor.value = descriptor
  pickerState.regionId = regions[0]!
  pickerState.menuSetId = menuData.value?.defaultMenuId
    ?? menuData.value?.items.find(menu => !menu.malformedStoredValue)?.id
    ?? ''
  pendingElementCreation.value = null
  elementPickerOpen.value = true
}

function handleElementPickerOpenChange(nextOpen: boolean) {
  elementPickerOpen.value = nextOpen
}

function submitElementPicker(event: FormSubmitEvent<{ regionId: string, menuSetId?: string }>) {
  if (!pickerDescriptor.value || !document.value || !workingId.value || pendingElementCreation.value) return
  try {
    pendingElementCreation.value = {
      element: createLayoutElement(
        pickerDescriptor.value.type,
        event.data.regionId as LayoutRegionKey,
        `element-${ulid()}`,
        event.data.menuSetId
      ),
      layoutId: workingId.value
    }
    elementPickerOpen.value = false
  } catch (mutationError: any) {
    toast.add({ title: 'Could not add element', description: mutationError.message, color: 'warning' })
  }
}

async function focusElementPickerError(_event: FormErrorEvent) {
  await nextTick()
  globalThis.document.querySelector<HTMLElement>('[data-layout-element-region]')?.focus()
}

function handleElementPickerAfterLeave() {
  const pendingCreation = pendingElementCreation.value
  pendingElementCreation.value = null
  afterLayoutOverlayFocusRestored(() => {
    if (!pendingCreation
      || pendingCreation.layoutId !== layoutId.value
      || pendingCreation.layoutId !== workingId.value
      || !document.value) return
    try {
      const next = insertLayoutElement(document.value, pendingCreation.element)
      if (commitDocument(next, {
        regionId: pendingCreation.element.region,
        elementId: pendingCreation.element.id
      })) {
        activePanel.value = 'inspector'
        if (!usesDesktopPanel()) mobilePanelOpen.value = true
        announcement.value = `Added ${layoutElementRegistry[pendingCreation.element.type].label}.`
      }
    } catch (mutationError: any) {
      toast.add({ title: 'Could not add element', description: mutationError.message, color: 'warning' })
    }
  })
}

function undo() {
  if (!history.value) return
  history.value = undoLayoutEditorHistory(history.value)
}

function redo() {
  if (!history.value) return
  history.value = redoLayoutEditorHistory(history.value)
}

function togglePanel() {
  if (mode.value !== 'edit') return
  if (usesDesktopPanel()) panelCollapsed.value = !panelCollapsed.value
  else mobilePanelOpen.value = !mobilePanelOpen.value
}

function handleMobilePanelAfterLeave() {
  if (usesDesktopPanel()) return
  afterLayoutOverlayFocusRestored(() => focusLayoutElement(selection.value.elementId))
}

watch(mode, (nextMode) => {
  if (nextMode === 'preview') mobilePanelOpen.value = false
})

function togglePreview() {
  mode.value = mode.value === 'edit' ? 'preview' : 'edit'
}

function setViewport(value: string) {
  viewport.value = value as LayoutViewport
}

defineShortcuts({
  meta_shift_p: () => { mode.value = mode.value === 'edit' ? 'preview' : 'edit' },
  meta_z: () => undo(),
  meta_shift_z: () => redo()
})

async function save() {
  if (!document.value || !currentResourceReady.value || saving.value) return
  if (nameDirty.value) {
    toast.add({ title: 'Rename first', description: 'Apply the new name before saving document changes.', color: 'warning' })
    return
  }
  const request: LayoutMutationIdentity = {
    token: ++latestSaveToken,
    layoutId: workingId.value,
    revision: workingRevision.value,
    snapshot: currentSnapshot.value
  }
  validationIssues.value = []
  try {
    const resource = await saveLayout(request.layoutId, request.revision, structuredClone(document.value))
    if (!shouldApplyLayoutMutationResult(request, latestSaveToken, layoutId.value, workingId.value)
      || resource.status !== 'ready') return
    workingRevision.value = resource.revision
    baselineDocument.value = serializeLayoutDocument(resource.document)
    baselineName.value = resource.name
    staleConflict.value = null
    if (shouldReplaceLayoutDraft(request, currentSnapshot.value)) {
      history.value = createLayoutEditorHistory(resource.document, selection.value)
    }
    toast.add({ title: 'Layout saved', description: `Revision ${resource.revision}`, color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    if (!shouldApplyLayoutMutationResult(request, latestSaveToken, layoutId.value, workingId.value)) return
    staleConflict.value = layoutStaleConflictFromFetchError(saveError)
    validationIssues.value = layoutValidationIssuesFromFetchError(saveError)
    toast.add({
      title: staleConflict.value ? 'Layout changed elsewhere' : 'Could not save Layout',
      description: staleConflict.value
        ? 'Your local draft is preserved. Reload explicitly to discard it and use the latest revision.'
        : saveError?.data?.statusMessage || saveError?.statusMessage || validationIssues.value[0]?.message || 'Review the Layout and try again.',
      color: 'error'
    })
  }
}

async function rename() {
  if (!currentResourceReady.value || renaming.value || !nameDirty.value) return
  const parsedName = layoutNameSchema.safeParse(workingName.value)
  if (!parsedName.success) {
    toast.add({ title: 'Invalid Layout name', description: parsedName.error.issues[0]?.message, color: 'warning' })
    return
  }
  const request: LayoutMutationIdentity = {
    token: ++latestRenameToken,
    layoutId: workingId.value,
    revision: workingRevision.value,
    snapshot: parsedName.data
  }
  try {
    const resource = await renameLayout(request.layoutId, request.revision, parsedName.data)
    if (!shouldApplyLayoutMutationResult(request, latestRenameToken, layoutId.value, workingId.value)
      || resource.status !== 'ready'
      || !document.value) return
    const reconciliation = reconcileLayoutRenameState(workingName.value, request, resource, document.value)
    workingRevision.value = reconciliation.workingRevision
    workingName.value = reconciliation.workingName
    baselineName.value = reconciliation.baselineName
    baselineDocument.value = reconciliation.baselineDocument
    history.value = createLayoutEditorHistory(reconciliation.document, selection.value)
    staleConflict.value = null
    toast.add({ title: 'Layout renamed', color: 'success', icon: 'i-lucide-check' })
  } catch (renameError: any) {
    if (!shouldApplyLayoutMutationResult(request, latestRenameToken, layoutId.value, workingId.value)) return
    staleConflict.value = layoutStaleConflictFromFetchError(renameError)
    toast.add({
      title: staleConflict.value ? 'Layout changed elsewhere' : 'Could not rename Layout',
      description: staleConflict.value
        ? 'Your local draft is preserved. Reload explicitly to use the latest revision.'
        : renameError?.data?.statusMessage || renameError?.statusMessage || 'Choose another name and try again.',
      color: 'error'
    })
  }
}

async function reloadLatest() {
  if (!workingId.value) return
  if (isDirty.value) {
    const accepted = await confirm({
      title: 'Discard local Layout changes?',
      body: 'Reloading replaces this draft with the latest persisted revision.',
      confirmLabel: 'Reload latest'
    })
    if (!accepted) return
  }
  const request = { token: ++latestReloadToken, layoutId: workingId.value }
  try {
    const resource = await loadLayout(request.layoutId)
    if (request.token !== latestReloadToken || request.layoutId !== layoutId.value) return
    loadWorkingResource(resource)
    toast.add({ title: 'Latest Layout loaded', color: 'success', icon: 'i-lucide-rotate-cw' })
  } catch (reloadError: any) {
    toast.add({ title: 'Could not reload Layout', description: reloadError?.statusMessage || 'Try again.', color: 'error' })
  }
}

function openDuplicate() {
  if (isDirty.value) {
    toast.add({
      title: 'Save or discard changes first',
      description: 'Duplicate uses the latest persisted Layout revision.',
      color: 'warning'
    })
    return
  }
  duplicateState.name = `${workingName.value} copy`
  duplicateNameError.value = ''
  pendingDuplicate.value = null
  duplicateOpen.value = true
}

function handleDuplicateOpenChange(nextOpen: boolean) {
  if (duplicating.value && !nextOpen) return
  duplicateOpen.value = nextOpen
}

async function submitDuplicate(event: FormSubmitEvent<{ name: string }>) {
  if (!workingId.value || duplicating.value) return
  const request = { token: ++latestDuplicateToken, layoutId: workingId.value }
  duplicateNameError.value = ''
  try {
    const resource = await duplicateLayout(request.layoutId, event.data.name)
    if (request.token !== latestDuplicateToken || request.layoutId !== layoutId.value || request.layoutId !== workingId.value) return
    pendingDuplicate.value = { resource, ...request }
    duplicateOpen.value = false
  } catch (duplicateError: any) {
    if (request.token !== latestDuplicateToken || request.layoutId !== layoutId.value) return
    duplicateNameError.value = layoutValidationIssuesFromFetchError(duplicateError).find(issue => issue.path === 'name')?.message
      || duplicateError?.data?.statusMessage
      || duplicateError?.statusMessage
      || 'Choose another name and try again.'
    await nextTick()
    globalThis.document.querySelector<HTMLElement>('[data-layout-duplicate-name]')?.focus()
  }
}

function handleDuplicateAfterLeave() {
  const pendingResource = pendingDuplicate.value
  pendingDuplicate.value = null
  afterLayoutOverlayFocusRestored(async () => {
    globalThis.document.querySelector<HTMLElement>('[data-layout-duplicate-trigger]')?.focus()
    if (!pendingResource
      || pendingResource.token !== latestDuplicateToken
      || pendingResource.layoutId !== layoutId.value) return
    allowNextNavigation()
    await navigateTo(`/_desk/site/layouts/${encodeURIComponent(pendingResource.resource.id)}`)
  })
}

async function removeLayout() {
  if (!workingId.value || !workingCanDelete.value || deleting.value) return
  const accepted = await confirm({
    title: `Delete ${workingName.value}?`,
    body: 'This permanently deletes the unreferenced Layout resource.',
    confirmLabel: 'Delete Layout'
  })
  if (!accepted) return
  const submittedId = workingId.value
  try {
    await deleteLayout(submittedId, workingRevision.value)
    if (submittedId !== layoutId.value) return
    allowNextNavigation()
    await navigateTo('/_desk/site/layouts')
  } catch (deleteError: any) {
    const usage = layoutUsageFromFetchError(deleteError)
    if (usage && submittedId === workingId.value) {
      workingUsage.value = usage
      workingCanDelete.value = false
    }
    staleConflict.value = layoutStaleConflictFromFetchError(deleteError)
    toast.add({
      title: 'Could not delete Layout',
      description: usage?.length
        ? `Used by: ${usage.map(item => item.label).join(', ')}`
        : deleteError?.data?.statusMessage || deleteError?.statusMessage || 'Reload and try again.',
      color: 'error'
    })
  }
}
</script>

<template>
  <SiteAdminSection
    section="layouts"
    title="Edit Layout"
    description="Arrange semantic public elements in validated regions and inspect typed properties."
  >
    <UButton to="/_desk/site/layouts" icon="i-lucide-arrow-left" color="neutral" variant="ghost">
      Back to Layouts
    </UButton>

    <div v-if="pending" class="space-y-3" aria-busy="true" aria-label="Loading Layout">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      title="This Layout is unavailable"
      :description="error.statusMessage || 'Return to the Layout list and try again.'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
    />

    <UAlert
      v-else-if="missingResource"
      title="Layout not found"
      description="It may have been deleted in another session."
      color="warning"
      variant="subtle"
      icon="i-lucide-circle-alert"
    >
      <template #actions><UButton to="/_desk/site/layouts">Return to Layouts</UButton></template>
    </UAlert>

    <section v-else-if="repairResource" class="space-y-4" data-layout-repair-required>
      <UAlert
        title="This Layout requires repair"
        description="The stored document failed strict validation. No raw or unknown elements are exposed in the visual editor."
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
      />
      <div class="rounded-lg border border-default p-4">
        <h2 class="font-semibold text-highlighted">{{ repairResource.name }}</h2>
        <p class="mt-1 text-sm text-muted">Revision {{ repairResource.revision }} · {{ repairResource.repair.issues.length }} validation issues</p>
        <p class="mt-1 break-all text-xs text-dimmed">Stable ID: {{ repairResource.id }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton icon="i-lucide-rotate-cw" color="neutral" variant="outline" @click="reloadLatest">Reload</UButton>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          :disabled="!workingCanDelete"
          :loading="deleting"
          @click="removeLayout"
        >
          Delete unreferenced Layout
        </UButton>
      </div>
      <UAlert
        v-if="workingUsage.length"
        title="Deletion is guarded"
        :description="`Used by: ${workingUsage.map(item => item.label).join(', ')}`"
        color="info"
        variant="subtle"
        icon="i-lucide-link"
      />
    </section>

    <section v-else-if="document && currentResourceReady" class="space-y-4" :data-layout-editor-id="workingId">
      <div class="sticky top-2 z-30 rounded-lg border border-default bg-default/95 p-3 shadow-sm backdrop-blur" data-layout-command-bar>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Layout name" required class="min-w-56 flex-1">
            <UInput v-model="workingName" maxlength="80" class="w-full" data-layout-name-input />
          </UFormField>
          <UButton
            type="button"
            icon="i-lucide-pencil-line"
            color="neutral"
            variant="outline"
            :loading="renaming"
            :disabled="!nameDirty || busy"
            @click="rename"
          >
            Rename
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!documentDirty || nameDirty || busy || missingMenuElements.length > 0"
            @click="save"
          >
            Save
          </UButton>
          <UButton type="button" icon="i-lucide-copy" color="neutral" variant="outline" data-layout-duplicate-trigger :disabled="busy || isDirty" @click="openDuplicate">
            Duplicate
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-trash-2"
            color="error"
            variant="outline"
            :disabled="!workingCanDelete || busy"
            :title="workingCanDelete ? 'Delete Layout' : `Used by ${workingUsage.length} resources`"
            @click="removeLayout"
          >
            Delete
          </UButton>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <UBadge color="neutral" variant="soft">Revision {{ workingRevision }}</UBadge>
          <span :class="isDirty ? 'text-warning' : 'text-muted'">{{ isDirty ? 'Unsaved changes' : 'All changes saved' }}</span>
          <span class="break-all">Stable ID: {{ workingId }}</span>
          <span v-if="workingUsage.length">Used by {{ workingUsage.map(item => item.label).join(', ') }}</span>
        </div>
      </div>

      <UAlert
        v-if="staleConflict"
        title="A newer Layout revision is available"
        :description="`Revision ${staleConflict.currentRevision}${staleConflict.updatedBy ? ` was saved by ${staleConflict.updatedBy}` : ' was saved elsewhere'}. Your local draft is preserved.`"
        color="error"
        variant="subtle"
        icon="i-lucide-git-compare-arrows"
        data-layout-stale-conflict
      >
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="reloadLatest">Reload latest</UButton>
        </template>
      </UAlert>

      <UAlert
        v-if="validationIssues.length"
        title="Layout validation needs attention"
        :description="validationIssues[0]?.message"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
      />

      <UAlert
        v-if="missingMenuElements.length"
        title="A referenced Menu set is missing"
        description="Choose an available Menu set before saving this Layout."
        color="error"
        variant="subtle"
        icon="i-lucide-link-2-off"
        data-layout-menu-reference-missing
      >
        <template #actions>
          <UButton color="neutral" variant="outline" @click="selectElement(missingMenuElements[0]!.id)">Review Menu element</UButton>
        </template>
      </UAlert>

      <div class="flex min-h-[42rem] flex-col overflow-hidden rounded-lg border border-default bg-muted/30" data-layout-editor-workspace>
        <UDashboardToolbar>
          <template #left>
            <UButton
              :label="mode === 'edit' ? 'Preview' : 'Edit'"
              :icon="mode === 'edit' ? 'i-lucide-eye' : 'i-lucide-pencil'"
              color="neutral"
              variant="ghost"
              size="sm"
              data-layout-preview-toggle
              @click="togglePreview"
            />
            <UFieldGroup size="sm" role="group" aria-label="Layout canvas viewport" data-layout-viewport-group>
              <UButton
                v-for="item in [
                  { label: 'Desktop', value: 'desktop', icon: 'i-lucide-monitor' },
                  { label: 'Tablet', value: 'tablet', icon: 'i-lucide-tablet' },
                  { label: 'Mobile', value: 'mobile', icon: 'i-lucide-smartphone' }
                ]"
                :key="item.value"
                :label="item.label"
                :icon="item.icon"
                :aria-label="item.label"
                color="neutral"
                :variant="viewport === item.value ? 'soft' : 'ghost'"
                :ui="{ label: 'hidden lg:inline' }"
                @click="setViewport(item.value)"
              />
            </UFieldGroup>
          </template>
          <template #right>
            <UButton icon="i-lucide-undo-2" color="neutral" variant="ghost" aria-label="Undo" :disabled="!history?.past.length || mode === 'preview'" @click="undo" />
            <UButton icon="i-lucide-redo-2" color="neutral" variant="ghost" aria-label="Redo" :disabled="!history?.future.length || mode === 'preview'" @click="redo" />
            <UButton v-if="mode === 'edit'" icon="i-lucide-panel-right" color="neutral" variant="ghost" aria-label="Toggle Layout editor panel" data-layout-panel-toggle @click="togglePanel" />
          </template>
        </UDashboardToolbar>

        <div
          class="grid min-h-0 flex-1 grid-cols-1"
          :class="mode === 'edit' && !panelCollapsed ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : 'lg:grid-cols-1'"
        >
          <main class="min-h-0 min-w-0 overflow-auto p-3 sm:p-5" aria-label="Layout canvas">
            <LayoutCanvas
              :document="document"
              :viewport="viewport"
              :selected-region-id="selection.regionId"
              :selected-element-id="selection.elementId"
              :preview="mode === 'preview'"
              @select-region="selectRegion"
              @select-element="selectElement"
              @drop="handleCanvasDrop"
            />
          </main>

          <aside v-if="mode === 'edit' && !panelCollapsed" class="hidden min-h-0 border-l border-muted bg-default lg:flex lg:flex-col" aria-label="Layout editor panel">
            <LayoutEditorPanel
              v-model:active-tab="activePanel"
              :document="document"
              :descriptors="descriptors"
              :selected-region-id="selection.regionId"
              :selected-element-id="selection.elementId"
              :menu-sets="menuData?.items ?? []"
              :menu-pending="menuPending"
              @request-add="requestElementAdd"
              @palette-dragstart="startPaletteDrag"
              @update-document="commitDocument"
              @update-element="updateElement"
              @select-region="selectRegion"
              @move-element="moveElement"
              @duplicate-element="duplicateElement"
              @remove-element="removeElement"
            />
          </aside>
        </div>

        <USlideover
          v-if="mode === 'edit'"
          v-model:open="mobilePanelOpen"
          title="Layout editor"
          side="right"
          :ui="{ body: 'p-0 sm:p-0 min-h-0' }"
          data-layout-mobile-inspector
          @after:leave="handleMobilePanelAfterLeave"
        >
          <template #body>
            <LayoutEditorPanel
              v-model:active-tab="activePanel"
              :document="document"
              :descriptors="descriptors"
              :selected-region-id="selection.regionId"
              :selected-element-id="selection.elementId"
              :menu-sets="menuData?.items ?? []"
              :menu-pending="menuPending"
              @request-add="requestElementAdd"
              @palette-dragstart="startPaletteDrag"
              @update-document="commitDocument"
              @update-element="updateElement"
              @select-region="selectRegion"
              @move-element="moveElement"
              @duplicate-element="duplicateElement"
              @remove-element="removeElement"
            />
          </template>
        </USlideover>
      </div>

      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
    </section>

    <UModal
      v-if="pickerWide && pickerDescriptor && document"
      :open="elementPickerOpen"
      :title="`Add ${pickerDescriptor.label}`"
      description="Choose the validated target and any required resource reference."
      :ui="{ content: 'max-w-2xl', footer: 'justify-end' }"
      data-layout-element-modal
      @update:open="handleElementPickerOpenChange"
      @after:leave="handleElementPickerAfterLeave"
    >
      <template #body>
        <LayoutElementCreateForm
          :form-id="elementPickerFormId"
          :document="document"
          :descriptor="pickerDescriptor"
          :state="pickerState"
          :menu-sets="menuData?.items ?? []"
          :menu-pending="menuPending"
          @update-region="pickerState.regionId = $event"
          @update-menu-set="pickerState.menuSetId = $event"
          @submit="submitElementPicker"
          @error="focusElementPickerError"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" @click="handleElementPickerOpenChange(false)">Cancel</UButton>
          <UButton type="submit" :form="elementPickerFormId" icon="i-lucide-plus">Add element</UButton>
        </div>
      </template>
    </UModal>

    <USlideover
      v-else-if="pickerDescriptor && document"
      :open="elementPickerOpen"
      :title="`Add ${pickerDescriptor.label}`"
      description="Choose the validated target and any required resource reference."
      side="right"
      :ui="{ content: 'w-full max-w-none', footer: 'justify-end' }"
      data-layout-element-slideover
      @update:open="handleElementPickerOpenChange"
      @after:leave="handleElementPickerAfterLeave"
    >
      <template #body>
        <LayoutElementCreateForm
          :form-id="elementPickerFormId"
          :document="document"
          :descriptor="pickerDescriptor"
          :state="pickerState"
          :menu-sets="menuData?.items ?? []"
          :menu-pending="menuPending"
          @update-region="pickerState.regionId = $event"
          @update-menu-set="pickerState.menuSetId = $event"
          @submit="submitElementPicker"
          @error="focusElementPickerError"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" @click="handleElementPickerOpenChange(false)">Cancel</UButton>
          <UButton type="submit" :form="elementPickerFormId" icon="i-lucide-plus">Add element</UButton>
        </div>
      </template>
    </USlideover>

    <UModal
      :open="duplicateOpen"
      title="Duplicate Layout"
      description="Duplicates the latest persisted revision with new stable resource and element IDs."
      :dismissible="!duplicating"
      :close="duplicating ? false : true"
      :ui="{ footer: 'justify-end' }"
      @update:open="handleDuplicateOpenChange"
      @after:leave="handleDuplicateAfterLeave"
    >
      <template #body>
        <UForm :id="duplicateFormId" :schema="layoutDuplicateSchema" :state="duplicateState" :loading-auto="false" @submit="submitDuplicate">
          <UFormField name="name" label="Duplicate name" required :error="duplicateNameError || undefined">
            <UInput v-model="duplicateState.name" class="w-full" maxlength="80" autofocus data-layout-duplicate-name />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="duplicating" @click="handleDuplicateOpenChange(false)">Cancel</UButton>
          <UButton type="submit" :form="duplicateFormId" icon="i-lucide-copy" :loading="duplicating">Duplicate</UButton>
        </div>
      </template>
    </UModal>
  </SiteAdminSection>
</template>
