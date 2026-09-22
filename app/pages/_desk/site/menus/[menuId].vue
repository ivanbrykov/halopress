<script setup lang="ts">
import type {
  SiteMenuAdminResource,
  SiteMenuChild,
  SiteMenuItem,
  SiteMenuPreviewResponse,
  SiteMenuUpdate,
  SiteMenuValidationIssue
} from '~~/shared/site-menu'
import {
  SITE_MENU_MAX_ITEMS,
  isSiteMenuDynamicItem,
  isSiteMenuStaticItem
} from '~~/shared/site-menu'

definePageMeta({ layout: 'desk' })

const route = useRoute()
const toast = useToast()
const [menuEditor, sourceOptionEditor] = await Promise.all([
  useSiteMenusEditor(),
  useSiteMenuSourceOptionsEditor()
])
const {
  data,
  pending,
  status,
  error,
  refresh,
  saving,
  previewing,
  saveMenu,
  previewMenu
} = menuEditor
const {
  data: sourceOptions,
  pending: sourceOptionsPending,
  error: sourceOptionsError,
  refresh: refreshSourceOptions
} = sourceOptionEditor

const menuId = computed(() => {
  const value = route.params.menuId
  return Array.isArray(value) ? value[0] || '' : String(value || '')
})
const sourceResource = computed(() => data.value?.items.find(menu => menu.id === menuId.value) ?? null)
const missingResource = computed(() => status.value === 'success' && Boolean(data.value) && !sourceResource.value)

const working = ref<SiteMenuAdminResource | null>(null)
const baseline = ref('')
const selectedItemId = ref('')
const mobileEditorOpen = ref(false)
const isDesktop = ref(false)
const wideItemOverlay = ref(false)
const announcement = ref('')
const validationIssues = ref<SiteMenuValidationIssue[]>([])
const previewOrientation = ref<'horizontal' | 'vertical'>('horizontal')
const noPreviewPageContext = '__no-page-context__'
const previewPageId = ref(noPreviewPageContext)
const previewResult = ref<SiteMenuPreviewResponse | null>(null)
const previewError = ref('')
const previewSnapshot = ref('')
let desktopMediaQuery: MediaQueryList | null = null
let itemOverlayMediaQuery: MediaQueryList | null = null
let latestSaveToken = 0
let latestPreviewToken = 0
let shouldFocusCreatedResource = import.meta.client && route.query.created === menuId.value

const currentSnapshot = computed(() => working.value
  ? JSON.stringify({ name: working.value.name, document: working.value.document })
  : '')
const isDirty = computed(() => Boolean(working.value && isSiteMenuWorkingCopyDirty(
  working.value.malformedStoredValue,
  currentSnapshot.value,
  baseline.value
)))
const currentResourceReady = computed(() => isCurrentSiteMenuResourceReady(
  status.value,
  pending.value,
  Boolean(error.value),
  menuId.value,
  sourceResource.value?.id,
  working.value?.id
))
const selectedSelection = computed(() => working.value
  ? findSiteMenuItemSelection(working.value.document.items, selectedItemId.value)
  : null)
const selectedItem = computed<SiteMenuItem | SiteMenuChild>({
  get() {
    if (!selectedSelection.value) throw new Error('No menu item is selected')
    return selectedSelection.value.item
  },
  set(next) {
    if (!working.value || !selectedSelection.value) return
    const selection = selectedSelection.value
    if (selection.childIndex === undefined) {
      const previous = working.value.document.items[selection.parentIndex]
      if (!previous) return
      working.value.document.items[selection.parentIndex] = isSiteMenuStaticItem(previous) && !isSiteMenuDynamicItem(next)
        ? { ...next, children: previous.children }
        : next as SiteMenuItem
      return
    }
    const parent = working.value.document.items[selection.parentIndex]
    if (parent && isSiteMenuStaticItem(parent)) parent.children[selection.childIndex] = next as SiteMenuChild
  }
})
const dynamicSourceCount = computed(() => working.value
  ? countSiteMenuDynamicSources(working.value.document.items)
  : 0)
const selectedParentHasChildren = computed(() => {
  if (!working.value || !selectedSelection.value || selectedSelection.value.childIndex !== undefined) return false
  const item = working.value.document.items[selectedSelection.value.parentIndex]
  return Boolean(item && isSiteMenuStaticItem(item) && item.children.length)
})
const previewContextPath = computed(() => previewResult.value?.context?.canonicalPath ?? '/')
const previewItems = computed(() => previewResult.value
  ? resolvedMenuNavigationItems(previewResult.value.menu.document, previewContextPath.value)
  : [])
const previewRequestSnapshot = computed(() => working.value
  ? JSON.stringify({ document: working.value.document, examplePageId: previewPageId.value })
  : '')
const previewIsStale = computed(() => Boolean(previewResult.value && previewSnapshot.value !== previewRequestSnapshot.value))
const previewPageItems = computed(() => [
  { label: 'No Page context', value: noPreviewPageContext },
  ...(sourceOptions.value?.pages ?? []).map(page => ({
    label: `${page.title} · ${page.path}`,
    value: page.id
  }))
])
const orientationItems = [
  { label: 'Horizontal', value: 'horizontal' },
  { label: 'Vertical', value: 'vertical' }
]

useUnsavedNavigationGuard(isDirty, 'You have unsaved menu changes. Leave and discard them?')

function clearPreview() {
  latestPreviewToken++
  previewResult.value = null
  previewError.value = ''
  previewSnapshot.value = ''
}

function loadResource(resource: SiteMenuAdminResource) {
  const previousSelection = selectedItemId.value
  working.value = structuredClone(resource)
  validationIssues.value = []
  clearPreview()
  baseline.value = JSON.stringify({ name: working.value.name, document: working.value.document })
  selectedItemId.value = findSiteMenuItemSelection(working.value.document.items, previousSelection)?.id
    ?? working.value.document.items[0]?.id
    ?? ''
  if (!selectedItemId.value) mobileEditorOpen.value = false
  if (shouldFocusCreatedResource) {
    shouldFocusCreatedResource = false
    nextTick(() => focusSiteMenuEditor(resource.id, 'name'))
  }
}

watch([sourceResource, status, menuId], ([resource, requestStatus, currentMenuId]) => {
  if (requestStatus !== 'success') return
  if (!resource) {
    if (working.value && working.value.id !== currentMenuId) {
      working.value = null
      baseline.value = ''
      selectedItemId.value = ''
      mobileEditorOpen.value = false
      validationIssues.value = []
      clearPreview()
    }
    return
  }
  if (!working.value || working.value.id !== resource.id) loadResource(resource)
}, { immediate: true })

function usesDesktopPanel() {
  return desktopMediaQuery?.matches
    ?? (import.meta.client && window.matchMedia('(min-width: 1024px)').matches)
}

function handleBreakpointChange(event: MediaQueryListEvent) {
  const wasDesktop = isDesktop.value
  isDesktop.value = event.matches
  if (event.matches) {
    mobileEditorOpen.value = false
  } else if (wasDesktop && selectedSelection.value) {
    // Preserve the visible editing context across rotation/breakpoint changes.
    mobileEditorOpen.value = true
  }
}

function handleItemOverlayBreakpoint(event: MediaQueryListEvent) {
  wideItemOverlay.value = event.matches
}

onMounted(() => {
  desktopMediaQuery = window.matchMedia('(min-width: 1024px)')
  itemOverlayMediaQuery = window.matchMedia('(min-width: 640px)')
  isDesktop.value = desktopMediaQuery.matches
  wideItemOverlay.value = itemOverlayMediaQuery.matches
  desktopMediaQuery.addEventListener('change', handleBreakpointChange)
  itemOverlayMediaQuery.addEventListener('change', handleItemOverlayBreakpoint)
})

onBeforeUnmount(() => {
  desktopMediaQuery?.removeEventListener('change', handleBreakpointChange)
  itemOverlayMediaQuery?.removeEventListener('change', handleItemOverlayBreakpoint)
})

function handleMobileEditorAfterLeave() {
  if (usesDesktopPanel()) return
  // Reka restores its original trigger after the leave event. Defer our
  // controlled selection target until that focus-restoration cycle completes.
  restoreSiteMenuRowFocusAfterOverlay(selectedItemId.value)
}

async function selectItem(itemId: string) {
  selectedItemId.value = itemId
  if (!usesDesktopPanel()) mobileEditorOpen.value = true
  await nextTick()
  document.querySelector<HTMLElement>('[data-menu-detail-heading]')?.focus()
}

function addItem(draft: SiteMenuChild, submittedMenuId: string) {
  if (!working.value || !currentResourceReady.value || !isSiteMenuCreationTargetCurrent(
    submittedMenuId,
    menuId.value,
    working.value.id
  )) return
  const created = commitSiteMenuItemCreation(working.value.document.items, draft)
  if (!created) return
  announcement.value = `Added ${siteMenuAuthoredItemLabel(created.item)} as item ${created.position}.`
  selectItem(created.item.id)
}

function addChild(parentId: string, draft: SiteMenuChild, submittedMenuId: string) {
  if (!working.value || !currentResourceReady.value || !isSiteMenuCreationTargetCurrent(
    submittedMenuId,
    menuId.value,
    working.value.id
  )) return
  const created = commitSiteMenuItemCreation(working.value.document.items, draft, parentId)
  if (!created?.parent) return
  announcement.value = `Added ${siteMenuAuthoredItemLabel(created.item)} as child ${created.position} of ${created.parent.label}.`
  selectItem(created.item.id)
}

function handleItemRemoved(_removedId: string, nextId?: string) {
  if (!working.value || findSiteMenuItemSelection(working.value.document.items, selectedItemId.value)) return
  selectedItemId.value = nextId && findSiteMenuItemSelection(working.value.document.items, nextId)
    ? nextId
    : working.value.document.items[0]?.id ?? ''
  if (!selectedItemId.value) mobileEditorOpen.value = false
}

async function focusValidationIssue(issues: SiteMenuValidationIssue[]) {
  if (!working.value) return
  const itemId = issues.map(issue => siteMenuItemIdForValidationPath(working.value!.document.items, issue.path))
    .find(Boolean)
  if (itemId) {
    selectedItemId.value = itemId
    if (!usesDesktopPanel()) mobileEditorOpen.value = true
    await nextTick()
  }
  await nextTick()
  focusFirstSiteMenuValidationIssue(issues)
}

async function save() {
  if (!working.value) return
  const submittedSnapshot = currentSnapshot.value
  const request = {
    token: ++latestSaveToken,
    menuId: working.value.id,
    snapshot: submittedSnapshot
  }
  const update: SiteMenuUpdate = JSON.parse(submittedSnapshot)
  try {
    const resource = await saveMenu(request.menuId, update)
    // Only apply the response to the exact snapshot it persisted. The editor
    // remains usable during the request without allowing a late response to
    // overwrite newer typing, reorder, selection, or orientation changes.
    if (shouldApplySiteMenuSaveResult(
      request,
      latestSaveToken,
      menuId.value,
      working.value?.id,
      currentSnapshot.value
    )) loadResource(resource)
    toast.add({
      title: 'Menu saved',
      description: 'Public navigation updates immediately.',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (saveError: any) {
    if (shouldApplySiteMenuSaveResult(
      request,
      latestSaveToken,
      menuId.value,
      working.value?.id,
      currentSnapshot.value
    )) {
      // Retain all server issues until this snapshot saves; editing one field
      // must not hide errors that still apply to other menu items.
      validationIssues.value = siteMenuValidationIssuesFromFetchError(saveError)
      await focusValidationIssue(validationIssues.value)
    }
    toast.add({
      title: 'Could not save menu',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the menu fields and try again.',
      color: 'error'
    })
  }
}

async function runPreview() {
  if (!working.value || previewing.value) return
  previewError.value = ''
  const request = {
    token: ++latestPreviewToken,
    menuId: working.value.id,
    snapshot: previewRequestSnapshot.value
  }
  const submittedDocument = JSON.parse(JSON.stringify(working.value.document))
  const submittedPageId = previewPageId.value === noPreviewPageContext
    ? undefined
    : previewPageId.value
  try {
    const result = await previewMenu(
      request.menuId,
      submittedDocument,
      submittedPageId
    )
    if (!shouldApplySiteMenuPreviewResult(
      request,
      latestPreviewToken,
      menuId.value,
      working.value?.id,
      previewRequestSnapshot.value
    )) return
    previewResult.value = result
    previewSnapshot.value = request.snapshot
  } catch (error: any) {
    if (!shouldApplySiteMenuPreviewResult(
      request,
      latestPreviewToken,
      menuId.value,
      working.value?.id,
      previewRequestSnapshot.value
    )) return
    previewResult.value = null
    previewSnapshot.value = ''
    previewError.value = error?.data?.statusMessage
      || error?.statusMessage
      || 'The authenticated Menu preview could not be resolved.'
  }
}
</script>

<template>
  <SiteAdminSection
    section="menus"
    title="Edit menu"
    description="Arrange a compact menu preview and edit one selected link at a time."
  >
    <template #actions>
      <SiteMenuItemCreateModal
        v-if="currentResourceReady"
        kind="parent"
        :resource-id="working?.id || ''"
        :wide="wideItemOverlay"
        :dynamic-source-count="dynamicSourceCount"
        :source-options="sourceOptions"
        :source-options-pending="sourceOptionsPending"
        :source-options-error="Boolean(sourceOptionsError)"
        @create="addItem"
      >
        <template #default="{ open }">
          <UButton
            type="button"
            icon="i-lucide-plus"
            :disabled="(working?.document.items.length ?? SITE_MENU_MAX_ITEMS) >= SITE_MENU_MAX_ITEMS"
            data-menu-add-parent
            @click="open"
          >
            Add menu item
          </UButton>
        </template>
      </SiteMenuItemCreateModal>
    </template>

    <div class="space-y-6">
      <UButton to="/_desk/site/menus" icon="i-lucide-arrow-left" color="neutral" variant="ghost">
        Back to menu sets
      </UButton>

      <div v-if="pending" class="space-y-3" aria-busy="true" aria-label="Loading menu set">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-80 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        title="This menu is unavailable"
        :description="error.statusMessage || 'Refresh the page and try again.'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refresh()">
            Refresh
          </UButton>
          <UButton to="/_desk/site/menus" color="neutral" variant="outline">
            Menu sets
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-else-if="missingResource"
        title="Menu set not found"
        description="It may have been deleted in another session."
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-alert"
      >
        <template #actions>
          <UButton to="/_desk/site/menus">Return to menu sets</UButton>
        </template>
      </UAlert>

      <section
        v-else-if="working"
        class="space-y-6"
        :aria-labelledby="`menu-editor-${working.id}`"
        :data-menu-editor-id="working.id"
      >
        <div class="rounded-lg border border-default p-4 sm:p-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 flex-1 space-y-2">
              <h2
                :id="`menu-editor-${working.id}`"
                class="text-lg font-semibold text-highlighted"
                data-menu-editor-heading
                tabindex="-1"
              >
                {{ working.name }}
              </h2>
              <UFormField
                label="Menu name"
                required
                class="max-w-xl"
                :error="validationMessageForPath(validationIssues, 'name')"
              >
                <UInput
                  v-model="working.name"
                  class="w-full"
                  maxlength="80"
                  data-validation-path="name"
                  data-menu-name-input
                />
              </UFormField>
              <p class="break-all text-xs text-muted">Stable menu ID: {{ working.id }}</p>
            </div>
            <UBadge :color="working.canDelete ? 'neutral' : 'info'" variant="soft">
              {{ working.canDelete ? 'Unreferenced' : `Used by ${working.usage.length}` }}
            </UBadge>
          </div>
        </div>

        <UAlert
          v-if="working.malformedStoredValue"
          title="This menu needs repair"
          description="Invalid stored entries were omitted from this repair copy. Saving replaces the stored document atomically."
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
        />

        <UAlert
          v-if="working.usage.length"
          title="Deletion is guarded"
          :description="`Used by: ${working.usage.map(item => item.label).join(', ')}`"
          color="info"
          variant="subtle"
          icon="i-lucide-link"
        />

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)] lg:items-start">
          <section class="min-w-0 space-y-4 rounded-lg border border-default p-3 sm:p-4" aria-labelledby="menu-items-heading">
            <div>
              <div>
                <h3 id="menu-items-heading" class="font-semibold text-highlighted">Menu items</h3>
                <p class="text-sm text-muted">
                  Select a summary to edit it. Drag with pointer or touch, or use keyboard move controls.
                </p>
              </div>
            </div>

            <UAlert
              v-if="working.document.items.length === 0"
              title="This menu is empty"
              description="Add a static link, content query, or Page list to start building its ordered navigation."
              icon="i-lucide-info"
              variant="subtle"
            />

            <SiteMenuItemList
              v-model="working.document.items"
              :resource-id="working.id"
              :selected-id="selectedItemId"
              :validation-issues="validationIssues"
              :wide-create-overlay="wideItemOverlay"
              :dynamic-source-count="dynamicSourceCount"
              :source-options="sourceOptions"
              :source-options-pending="sourceOptionsPending"
              :source-options-error="Boolean(sourceOptionsError)"
              @announce="announcement = $event"
              @create-child="addChild"
              @select="selectItem"
              @remove="handleItemRemoved"
            />
          </section>

          <aside v-if="isDesktop" class="sticky top-4 min-w-0 rounded-lg border border-default p-4" aria-label="Selected menu item details">
            <SiteMenuDetailEditor
              v-if="selectedSelection"
              v-model="selectedItem"
              :path-prefix="selectedSelection.pathPrefix"
              :is-parent="selectedSelection.childIndex === undefined"
              :has-children="selectedParentHasChildren"
              :validation-issues="validationIssues"
              :source-options="sourceOptions"
              :source-options-pending="sourceOptionsPending"
              :source-options-error="Boolean(sourceOptionsError)"
            />
            <UAlert
              v-else
              title="Select a menu item"
              description="Choose an item in the ordered list to edit its properties."
              variant="subtle"
              icon="i-lucide-mouse-pointer-click"
            />
          </aside>
        </div>

        <section class="space-y-4 rounded-lg border border-default p-3 sm:p-4" aria-labelledby="menu-preview-heading" data-menu-authenticated-preview>
          <UDashboardToolbar :ui="{ right: 'ml-auto' }">
            <template #left>
              <div>
                <h3 id="menu-preview-heading" class="font-semibold text-highlighted">Authenticated public preview</h3>
                <p class="text-sm text-muted">Resolves this unsaved typed document through the public Menu compiler. Responses are private and not stored.</p>
              </div>
            </template>
            <template #right>
              <UButton
                type="button"
                icon="i-lucide-refresh-cw"
                :loading="previewing"
                :disabled="previewing"
                data-menu-preview-refresh
                @click="runPreview"
              >
                {{ previewResult ? 'Refresh preview' : 'Preview menu' }}
              </UButton>
            </template>
          </UDashboardToolbar>

          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
            <UFormField label="Orientation" description="Uses the same safe NavigationMenu adapter as Layout rendering.">
              <USelect
                v-model="previewOrientation"
                :items="orientationItems"
                value-key="value"
                class="w-full"
                data-menu-preview-orientation
              />
            </UFormField>
            <UFormField label="Example canonical Page" description="Required to resolve Current Page parent sources contextually.">
              <USelect
                v-model="previewPageId"
                :items="previewPageItems"
                value-key="value"
                class="w-full"
                :loading="sourceOptionsPending"
                data-menu-preview-page
              />
            </UFormField>
          </div>

          <UAlert
            v-if="sourceOptionsError"
            title="Preview context choices are unavailable"
            description="Refresh the typed source choices, then try the preview again."
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
          >
            <template #actions>
              <UButton type="button" color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refreshSourceOptions()">
                Refresh choices
              </UButton>
            </template>
          </UAlert>

          <UAlert
            v-if="previewError"
            title="Menu preview is unavailable"
            :description="previewError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
          />
          <UAlert
            v-else-if="previewIsStale"
            title="Preview is out of date"
            description="The authored document or example Page changed. Refresh to resolve the current values."
            color="warning"
            variant="subtle"
            icon="i-lucide-refresh-cw"
          />

          <div v-if="previewResult" class="space-y-3 rounded-lg border border-muted bg-elevated/30 p-4" data-menu-preview-result>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm text-muted">
                {{ previewResult.context ? `Canonical context: ${previewResult.context.canonicalPath}` : 'No Page context selected' }}
              </p>
              <UBadge color="neutral" variant="soft">{{ previewResult.menu.document.items.length }} resolved items</UBadge>
            </div>

            <nav aria-label="Menu preview">
              <UNavigationMenu
                v-if="previewItems.length"
                :items="previewItems"
                :orientation="previewOrientation"
                data-menu-preview-navigation
              />
              <UAlert
                v-else
                title="No public items resolved"
                description="Static destinations may be unavailable, dynamic sources may be empty, or a contextual Page may still be required."
                variant="subtle"
                icon="i-lucide-info"
              />
            </nav>

            <div v-if="previewResult.diagnostics.length" class="space-y-2" data-menu-preview-diagnostics>
              <div
                v-for="diagnostic in previewResult.diagnostics"
                :key="diagnostic.sourceId"
                class="flex flex-wrap items-start justify-between gap-3 rounded-md border border-muted p-3"
              >
                <div class="min-w-0">
                  <p class="break-all text-sm font-medium text-highlighted">{{ diagnostic.sourceId }}</p>
                  <p class="text-xs text-muted">{{ diagnostic.message }}</p>
                </div>
                <UBadge :color="diagnostic.status === 'ready' ? 'success' : diagnostic.status === 'empty' || diagnostic.status === 'context-unavailable' ? 'neutral' : 'warning'" variant="soft">
                  {{ diagnostic.status }} · {{ diagnostic.count }}
                </UBadge>
              </div>
            </div>
          </div>
          <UAlert
            v-else-if="!previewError"
            title="Preview has not run"
            description="Choose an example Page when needed, then resolve this Menu without saving it first."
            variant="subtle"
            icon="i-lucide-eye"
          />
        </section>

        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>

        <div class="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default/95 p-4 shadow-lg backdrop-blur">
          <p class="text-sm" :class="isDirty ? 'text-warning' : 'text-muted'">
            {{ isDirty ? 'Unsaved menu changes' : 'All menu changes are saved' }}
          </p>
          <UButton
            type="button"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!isDirty || !working.name.trim()"
            @click="save"
          >
            Save menu
          </UButton>
        </div>

        <USlideover
          v-if="!isDesktop"
          v-model:open="mobileEditorOpen"
          side="right"
          :title="selectedSelection ? `Edit ${siteMenuAuthoredItemLabel(selectedSelection.item) || 'menu item'}` : 'Edit menu item'"
          description="Update the selected link without leaving the ordered menu preview."
          :ui="{ content: 'w-full max-w-xl', body: 'min-h-0 overflow-y-auto' }"
          @after:leave="handleMobileEditorAfterLeave"
        >
          <template #body>
            <SiteMenuDetailEditor
              v-if="selectedSelection"
              v-model="selectedItem"
              :path-prefix="selectedSelection.pathPrefix"
              :is-parent="selectedSelection.childIndex === undefined"
              :has-children="selectedParentHasChildren"
              :validation-issues="validationIssues"
              :source-options="sourceOptions"
              :source-options-pending="sourceOptionsPending"
              :source-options-error="Boolean(sourceOptionsError)"
            />
          </template>
          <template #footer>
            <div class="flex w-full items-center justify-between gap-3">
              <span class="text-sm" :class="isDirty ? 'text-warning' : 'text-muted'">
                {{ isDirty ? 'Unsaved changes' : 'Saved' }}
              </span>
              <UButton
                type="button"
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!isDirty || !working.name.trim()"
                @click="save"
              >
                Save menu
              </UButton>
            </div>
          </template>
        </USlideover>
      </section>
    </div>
  </SiteAdminSection>
</template>
