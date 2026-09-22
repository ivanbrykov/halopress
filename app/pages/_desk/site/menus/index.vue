<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'

import {
  isSiteMenuStaticItem,
  type SiteMenuAdminResource,
  type SiteMenuCreate
} from '~~/shared/site-menu'

definePageMeta({ layout: 'desk' })

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirmDialog()
const {
  data,
  pending,
  error,
  refresh,
  creating,
  deleting,
  createMenu,
  deleteMenu
} = useSiteMenus()

const createOpen = ref(false)
const wideCreateOverlay = ref(false)
const createState = reactive<SiteMenuCreate>({ name: '' })
const createErrorMessage = ref('')
const pendingCreatedMenu = ref<{
  resource: SiteMenuAdminResource
  request: SiteMenuCreateNavigationIdentity
} | null>(null)
const createFormId = 'site-menu-set-create-form'
const deletingId = ref('')
let failedCreateName = ''
let latestCreateToken = 0
let createMediaQuery: MediaQueryList | null = null
const createFinalizationFallback = createSiteMenuOverlayFinalizationFallback()

watch(() => createState.name, (name) => {
  if (createErrorMessage.value && name !== failedCreateName) createErrorMessage.value = ''
})

function handleCreateBreakpoint(event: MediaQueryListEvent) {
  wideCreateOverlay.value = event.matches
}

onMounted(() => {
  createMediaQuery = window.matchMedia('(min-width: 640px)')
  wideCreateOverlay.value = createMediaQuery.matches
  createMediaQuery.addEventListener('change', handleCreateBreakpoint)
})

onBeforeUnmount(() => {
  createFinalizationFallback.cancel()
  createMediaQuery?.removeEventListener('change', handleCreateBreakpoint)
})

async function focusCreateName(_event?: FormErrorEvent) {
  await nextTick()
  document.querySelector<HTMLElement>('[data-menu-create-name]')?.focus()
}

function handleCreateOpenChange(nextOpen: boolean) {
  if (nextOpen && pendingCreatedMenu.value) return
  if (!shouldAcceptSiteMenuCreateOpenChange(creating.value, nextOpen)) return
  createOpen.value = nextOpen
}

function openCreate() {
  handleCreateOpenChange(true)
}

async function createSet(event: FormSubmitEvent<SiteMenuCreate>) {
  if (creating.value) return
  const request = {
    token: ++latestCreateToken,
    originRoute: route.fullPath
  }
  createErrorMessage.value = ''
  try {
    pendingCreatedMenu.value = {
      resource: await createMenu(event.data.name),
      request
    }
    createOpen.value = false
    createFinalizationFallback.schedule(finalizeCreatedMenu)
  } catch (createError: any) {
    const issue = siteMenuValidationIssuesFromFetchError(createError)
      .find(item => item.path === 'name')
    createErrorMessage.value = issue?.message
      || createError?.data?.statusMessage
      || createError?.statusMessage
      || 'Choose a different name and try again.'
    failedCreateName = createState.name
    await focusCreateName()
    toast.add({
      title: 'Could not create menu set',
      description: createErrorMessage.value,
      color: 'error'
    })
  }
}

function finalizeCreatedMenu() {
  const pendingCreation = pendingCreatedMenu.value
  pendingCreatedMenu.value = null
  createFinalizationFallback.cancel()
  createState.name = ''
  createErrorMessage.value = ''
  failedCreateName = ''
  if (!pendingCreation) return

  toast.add({
    title: 'Menu set created',
    description: pendingCreation.resource.name,
    color: 'success',
    icon: 'i-lucide-check'
  })
  afterSiteMenuOverlayFocusRestored(async () => {
    if (!shouldApplySiteMenuCreateNavigation(
      pendingCreation.request,
      latestCreateToken,
      route.fullPath
    )) return
    await navigateTo({
      path: `/_desk/site/menus/${encodeURIComponent(pendingCreation.resource.id)}`,
      query: { created: pendingCreation.resource.id }
    })
  })
}

function handleCreateAfterLeave() {
  finalizeCreatedMenu()
}

async function removeMenu(resource: SiteMenuAdminResource) {
  if (!resource.canDelete || deleting.value) return
  const accepted = await confirm({
    title: `Delete ${resource.name}?`,
    body: 'This permanently deletes the unreferenced menu set.',
    confirmLabel: 'Delete menu'
  })
  if (!accepted) return

  deletingId.value = resource.id
  try {
    const currentItems = data.value?.items ?? []
    const removedIndex = currentItems.findIndex(item => item.id === resource.id)
    const focusId = currentItems[removedIndex + 1]?.id ?? currentItems[removedIndex - 1]?.id
    await deleteMenu(resource.id)
    await nextTick()
    const target = focusId
      ? document.querySelector<HTMLElement>(`[data-menu-set-edit="${CSS.escape(focusId)}"]`)
      : document.querySelector<HTMLElement>('[data-menu-create-trigger]')
        ?? document.querySelector<HTMLElement>('[data-menu-list-heading]')
    target?.focus()
    toast.add({ title: 'Menu set deleted', color: 'success', icon: 'i-lucide-check' })
  } catch (deleteError: any) {
    toast.add({
      title: 'Could not delete menu set',
      description: deleteError?.data?.statusMessage || deleteError?.statusMessage || 'Review its usage and try again.',
      color: 'error'
    })
  } finally {
    deletingId.value = ''
  }
}
</script>

<template>
  <SiteAdminSection
    section="menus"
    title="Menus"
    description="Manage named navigation sets, then open one to arrange and edit its links."
  >
    <div class="space-y-6">
      <UDashboardToolbar :ui="{ right: 'ml-auto' }" data-menu-list-toolbar>
        <template #left>
          <p class="text-sm text-muted">{{ data?.items.length ?? 0 }} saved {{ data?.items.length === 1 ? 'menu' : 'menus' }}</p>
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            :disabled="pending || Boolean(error) || creating || Boolean(pendingCreatedMenu)"
            data-menu-create-trigger
            @click="openCreate"
          >
            Add menu set
          </UButton>
        </template>
      </UDashboardToolbar>

      <UModal
        v-if="wideCreateOverlay"
        :open="createOpen"
        title="Add menu set"
        description="Create a named menu set that Site layouts can reference by its stable ID."
        :dismissible="!creating"
        :close="creating ? false : true"
        :ui="{ footer: 'justify-end' }"
        data-menu-create-modal
        @update:open="handleCreateOpenChange"
        @after:leave="handleCreateAfterLeave"
      >
        <template #body>
          <SiteMenuCreateForm
            :form-id="createFormId"
            :state="createState"
            :error-message="createErrorMessage || undefined"
            @update-name="createState.name = $event"
            @submit="createSet"
            @error="focusCreateName"
          />
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="creating" @click="handleCreateOpenChange(false)">
              Cancel
            </UButton>
            <UButton type="submit" :form="createFormId" icon="i-lucide-plus" :loading="creating">
              Create menu set
            </UButton>
          </div>
        </template>
      </UModal>

      <USlideover
        v-else
        :open="createOpen"
        title="Add menu set"
        description="Create a named menu set that Site layouts can reference by its stable ID."
        side="right"
        :dismissible="!creating"
        :close="creating ? false : true"
        :ui="{ content: 'w-full max-w-none', footer: 'justify-end' }"
        data-menu-create-slideover
        @update:open="handleCreateOpenChange"
        @after:leave="handleCreateAfterLeave"
      >
        <template #body>
          <SiteMenuCreateForm
            :form-id="createFormId"
            :state="createState"
            :error-message="createErrorMessage || undefined"
            @update-name="createState.name = $event"
            @submit="createSet"
            @error="focusCreateName"
          />
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="creating" @click="handleCreateOpenChange(false)">
              Cancel
            </UButton>
            <UButton type="submit" :form="createFormId" icon="i-lucide-plus" :loading="creating">
              Create menu set
            </UButton>
          </div>
        </template>
      </USlideover>

      <div v-if="pending" class="space-y-3" aria-busy="true" aria-label="Loading menu sets">
        <USkeleton class="h-32 w-full" />
        <USkeleton class="h-56 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        title="Menu sets are unavailable"
        :description="error.statusMessage || 'Refresh the page and try again.'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refresh()">
            Refresh
          </UButton>
        </template>
      </UAlert>

      <template v-else>
        <section class="space-y-3" aria-labelledby="menu-list-heading">
          <div>
            <h2 id="menu-list-heading" class="text-lg font-semibold text-highlighted" data-menu-list-heading tabindex="-1">
              Menu sets
            </h2>
            <p class="text-sm text-muted">
              Open a set to preview, reorder, and edit its individual links.
            </p>
          </div>

          <UAlert
            v-if="!data?.items.length"
            title="No menu sets"
            description="Use Add menu set in the page actions to begin."
            variant="subtle"
            icon="i-lucide-info"
          />

          <ul v-else class="grid gap-3" aria-label="Menu sets">
            <li
              v-for="menu in data.items"
              :key="menu.id"
              class="rounded-lg border border-default bg-default p-4"
              :data-menu-set-row="menu.id"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="truncate font-medium text-highlighted">{{ menu.name }}</h3>
                    <UBadge v-if="menu.id === data.defaultMenuId" color="primary" variant="soft">
                      Public default
                    </UBadge>
                    <UBadge :color="menu.canDelete ? 'neutral' : 'info'" variant="soft">
                      {{ menu.canDelete ? 'Unreferenced' : `Used by ${menu.usage.length}` }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">
                    {{ menu.document.items.length }} top-level {{ menu.document.items.length === 1 ? 'item' : 'items' }}
                    · {{ menu.document.items.reduce((count, item) => count + (isSiteMenuStaticItem(item) ? item.children.length : 0), 0) }} child items
                    · {{ countSiteMenuDynamicSources(menu.document.items) }} dynamic sources
                  </p>
                  <p class="break-all text-xs text-dimmed">Stable ID: {{ menu.id }}</p>
                </div>

                <div class="flex items-center gap-2">
                  <UButton
                    :to="`/_desk/site/menus/${encodeURIComponent(menu.id)}`"
                    icon="i-lucide-pencil"
                    :data-menu-set-edit="menu.id"
                  >
                    Edit
                  </UButton>
                  <UButton
                    type="button"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="outline"
                    :loading="deleting && deletingId === menu.id"
                    :disabled="!menu.canDelete || (deleting && deletingId !== menu.id)"
                    :aria-label="`Delete ${menu.name}`"
                    @click="removeMenu(menu)"
                  >
                    Delete
                  </UButton>
                </div>
              </div>

              <p v-if="menu.usage.length" class="mt-3 text-xs text-muted">
                Used by: {{ menu.usage.map(item => item.label).join(', ') }}
              </p>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </SiteAdminSection>
</template>
