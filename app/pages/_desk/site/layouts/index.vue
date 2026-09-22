<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'

import {
  layoutPresetKeys,
  type LayoutAdminResource,
  type LayoutPresetKey
} from '~~/shared/site-layout'
import LayoutCreateForm from '~/components/layout-editor/LayoutCreateForm.vue'

definePageMeta({ layout: 'desk' })

const route = useRoute()
const toast = useToast()
const {
  data,
  pending,
  error,
  refresh,
  creating,
  createLayout
} = useLayoutResources()

const createOpen = ref(false)
const wideCreateOverlay = ref(false)
const createState = reactive<{ name: string, presetKey: LayoutPresetKey }>({
  name: '',
  presetKey: layoutPresetKeys[0]
})
const createNameError = ref('')
const pendingCreatedLayout = ref<{
  resource: LayoutAdminResource
  request: LayoutCreateNavigationIdentity
} | null>(null)
const createFormId = 'layout-resource-create-form'
let createMediaQuery: MediaQueryList | null = null
let failedCreateName = ''
let latestCreateToken = 0

watch(() => createState.name, (name) => {
  if (createNameError.value && name !== failedCreateName) createNameError.value = ''
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
  createMediaQuery?.removeEventListener('change', handleCreateBreakpoint)
})

function handleCreateOpenChange(nextOpen: boolean) {
  if (!shouldAcceptLayoutCreateOpenChange(creating.value, nextOpen)) return
  createOpen.value = nextOpen
}

function openCreate() {
  createOpen.value = true
}

async function focusInvalidCreateField(_event?: FormErrorEvent) {
  await nextTick()
  document.querySelector<HTMLElement>('[data-layout-create-name]')?.focus()
}

async function submitCreate(event: FormSubmitEvent<{ name: string, presetKey: LayoutPresetKey }>) {
  if (creating.value) return
  const request = {
    token: ++latestCreateToken,
    originRoute: route.fullPath
  }
  createNameError.value = ''
  try {
    const resource = await createLayout(event.data)
    if (!shouldApplyLayoutCreateNavigation(request, latestCreateToken, route.fullPath)) return
    pendingCreatedLayout.value = { resource, request }
    createOpen.value = false
  } catch (createError: any) {
    if (!shouldApplyLayoutCreateNavigation(request, latestCreateToken, route.fullPath)) return
    const issue = layoutValidationIssuesFromFetchError(createError).find(item => item.path === 'name')
    createNameError.value = issue?.message
      || createError?.data?.statusMessage
      || createError?.statusMessage
      || 'Choose a different name and try again.'
    failedCreateName = createState.name
    await focusInvalidCreateField()
    toast.add({
      title: 'Could not create Layout',
      description: createNameError.value,
      color: 'error'
    })
  }
}

function handleCreateAfterLeave() {
  const pendingCreation = pendingCreatedLayout.value
  pendingCreatedLayout.value = null
  afterLayoutOverlayFocusRestored(async () => {
    focusLayoutCreateTrigger()
    if (!pendingCreation || !shouldApplyLayoutCreateNavigation(
      pendingCreation.request,
      latestCreateToken,
      route.fullPath
    )) return

    createState.name = ''
    createState.presetKey = layoutPresetKeys[0]
    createNameError.value = ''
    failedCreateName = ''
    toast.add({
      title: 'Layout created',
      description: pendingCreation.resource.name,
      color: 'success',
      icon: 'i-lucide-check'
    })
    await navigateTo({
      path: `/_desk/site/layouts/${encodeURIComponent(pendingCreation.resource.id)}`,
      query: { created: pendingCreation.resource.id }
    })
  })
}
</script>

<template>
  <SiteAdminSection
    section="layouts"
    title="Layouts"
    description="Build validated public Layout resources without exposing runtime or Nuxt application details."
  >
    <UDashboardToolbar :ui="{ right: 'ml-auto' }" data-layout-list-toolbar>
      <template #left>
        <p class="text-sm text-muted">{{ data?.items.length ?? 0 }} saved {{ data?.items.length === 1 ? 'Layout' : 'Layouts' }}</p>
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          :disabled="pending || Boolean(error)"
          data-layout-create-trigger
          @click="openCreate"
        >
          New layout
        </UButton>
      </template>
    </UDashboardToolbar>

    <UModal
      v-if="wideCreateOverlay"
      :open="createOpen"
      title="New layout"
      description="Name the Layout and choose one of the eight validated presets."
      :dismissible="!creating"
      :close="creating ? false : true"
      :ui="{ content: 'max-w-3xl', footer: 'justify-end' }"
      data-layout-create-modal
      @update:open="handleCreateOpenChange"
      @after:leave="handleCreateAfterLeave"
    >
      <template #body>
        <LayoutCreateForm
          :form-id="createFormId"
          :state="createState"
          :presets="data?.presets ?? []"
          :name-error="createNameError || undefined"
          @update-name="createState.name = $event"
          @update-preset="createState.presetKey = $event"
          @submit="submitCreate"
          @error="focusInvalidCreateField"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="creating" @click="handleCreateOpenChange(false)">
            Cancel
          </UButton>
          <UButton type="submit" :form="createFormId" icon="i-lucide-plus" :loading="creating">
            Create Layout
          </UButton>
        </div>
      </template>
    </UModal>

    <USlideover
      v-else
      :open="createOpen"
      title="New layout"
      description="Name the Layout and choose one of the eight validated presets."
      side="right"
      :dismissible="!creating"
      :close="creating ? false : true"
      :ui="{ content: 'w-full max-w-none', footer: 'justify-end' }"
      data-layout-create-slideover
      @update:open="handleCreateOpenChange"
      @after:leave="handleCreateAfterLeave"
    >
      <template #body>
        <LayoutCreateForm
          :form-id="createFormId"
          :state="createState"
          :presets="data?.presets ?? []"
          :name-error="createNameError || undefined"
          @update-name="createState.name = $event"
          @update-preset="createState.presetKey = $event"
          @submit="submitCreate"
          @error="focusInvalidCreateField"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="creating" @click="handleCreateOpenChange(false)">
            Cancel
          </UButton>
          <UButton type="submit" :form="createFormId" icon="i-lucide-plus" :loading="creating">
            Create Layout
          </UButton>
        </div>
      </template>
    </USlideover>

    <div v-if="pending" class="space-y-3" aria-busy="true" aria-label="Loading Layouts">
      <USkeleton class="h-36 w-full" />
      <USkeleton class="h-36 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      title="Layouts are unavailable"
      :description="error.statusMessage || 'Refresh the page and try again.'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refresh()">Refresh</UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="!data?.items.length"
      title="No Layouts"
      description="Use New layout in the dashboard toolbar to begin."
      variant="subtle"
      icon="i-lucide-panels-top-left"
    />

    <ul v-else class="grid gap-3" aria-label="Saved Layouts">
      <li
        v-for="layout in data.items"
        :key="layout.id"
        class="rounded-lg border border-default bg-default p-4"
        :data-layout-row="layout.id"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="truncate font-medium text-highlighted">{{ layout.name }}</h2>
              <UBadge :color="layout.status === 'ready' ? 'success' : 'warning'" variant="soft">
                {{ layout.status === 'ready' ? 'Ready' : 'Repair required' }}
              </UBadge>
              <UBadge :color="layout.canDelete ? 'neutral' : 'info'" variant="soft">
                {{ layout.canDelete ? 'Unreferenced' : `Used by ${layout.usage.length}` }}
              </UBadge>
            </div>
            <p class="text-sm text-muted">
              Revision {{ layout.revision }}
              <template v-if="layout.status === 'ready'"> · {{ layout.document.elements.length }} elements</template>
            </p>
            <p class="break-all text-xs text-dimmed">Stable ID: {{ layout.id }}</p>
            <p v-if="layout.usage.length" class="text-xs text-muted">Used by: {{ layout.usage.map(item => item.label).join(', ') }}</p>
          </div>
          <UButton
            :to="`/_desk/site/layouts/${encodeURIComponent(layout.id)}`"
            icon="i-lucide-pencil"
            :data-layout-edit="layout.id"
          >
            {{ layout.status === 'ready' ? 'Edit' : 'Review' }}
          </UButton>
        </div>
      </li>
    </ul>
  </SiteAdminSection>
</template>
