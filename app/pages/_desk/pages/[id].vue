<script setup lang="ts">
import type { BreadcrumbItem, DropdownMenuItem } from '@nuxt/ui'
import type { JSONContent } from '@tiptap/vue-3'
import { validatePageDocumentBlocks } from '~~/shared/page-blocks'
import { derivePublicSeoTitle } from '~~/shared/public-seo'
import PageEditor from '~/components/PageEditor.vue'
import { validatePageDocumentForPublication } from '~/editor/page/validation'

definePageMeta({
  layout: 'desk'
})

function stableStringify(value: any): string {
  const seen = new WeakSet()
  const normalize = (v: any): any => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return null
    seen.add(v)
    if (Array.isArray(v)) return v.map(normalize)
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k])
    return out
  }
  return JSON.stringify(normalize(value))
}

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirmDialog()
const id = computed(() => String(route.params.id))

const { data: doc, refresh } = await useFetch<any>(() => `/api/page/${id.value}`)

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: 'Pages', icon: 'i-lucide-panels-top-left', to: '/_desk/pages' },
  { label: doc.value?.title || doc.value?.id || id.value }
]))

const emptyDoc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

const state = reactive({
  title: '',
  status: 'draft',
  publicPath: '',
  description: '',
  socialImageAssetId: '',
  structuredDataType: '',
  layoutId: null as string | null,
  content: emptyDoc as JSONContent
})

function publicMetadataPayload() {
  return {
    publicPath: state.publicPath,
    seo: {
      title: derivePublicSeoTitle(state.title),
      description: state.description || undefined,
      imageAssetId: state.socialImageAssetId || undefined,
      structuredDataType: state.structuredDataType || undefined
    }
  }
}

function buildSnapshot() {
  return {
    title: state.title || '',
    status: state.status,
    layoutId: state.layoutId,
    ...publicMetadataPayload(),
    content: state.content
  }
}

const savingDraft = ref(false)
const publishing = ref(false)
const historyOpen = ref(false)
const conflictDetails = ref<Record<string, any> | null>(null)
const currentRevision = computed(() => Number(doc.value?.revision ?? 0))
const isDeleted = computed(() => doc.value?.status === 'deleted')
const lastSavedJson = ref('')
const currentJson = computed(() => stableStringify(buildSnapshot()))
const isDirty = computed(() => !!doc.value && currentJson.value !== lastSavedJson.value)
const draftValidationIssues = computed(() => validatePageDocumentBlocks(state.content, { allowUnknown: true }))
const publishValidationIssues = computed(() => validatePageDocumentForPublication(state.content))
const canSaveDraft = computed(() => !!doc.value && !isDeleted.value && isDirty.value && !draftValidationIssues.value.length && !savingDraft.value)
const canPublish = computed(() => !!doc.value && !isDeleted.value && (
  isDirty.value || ['never-published', 'unpublished', 'published-with-draft'].includes(doc.value?.publicationState)
) && !publishValidationIssues.value.length && !publishing.value)
const canDiscard = computed(() => !isDeleted.value && !!doc.value?.hasPublishedRevision && doc.value?.hasDraftChanges)
const canArchive = computed(() => !isDeleted.value && doc.value?.status !== 'archived')
const { allowNextNavigation } = useUnsavedNavigationGuard(isDirty)

function isConflict(error: any) {
  return error?.statusCode === 409 || error?.status === 409 || error?.response?.status === 409
}

function recordConflict(error: any) {
  const details = error?.data?.data ?? error?.data ?? {}
  conflictDetails.value = typeof details === 'object' ? details : {}
}

function handleMutationError(action: string, error: any) {
  if (isConflict(error)) {
    recordConflict(error)
    return
  }
  toast.add({ title: `${action} failed`, description: error?.statusMessage || 'Error', color: 'error' })
}

async function reloadLatest() {
  if (isDirty.value) {
    const ok = await confirm({
      title: 'Reload latest revision?',
      body: 'Your unsaved local changes will be discarded.',
      confirmLabel: 'Reload latest',
      confirmColor: 'warning'
    })
    if (!ok) return
  }
  await refresh()
  conflictDetails.value = null
}

async function handleHistoryRestored() {
  await refresh()
  conflictDetails.value = null
}

watch(
  () => doc.value,
  (next) => {
    if (!next) return
    state.title = next.title || ''
    state.status = next.status || 'draft'
    state.publicPath = next.publicPath || ''
    state.description = next.seo?.description || ''
    state.socialImageAssetId = next.seo?.imageAssetId || ''
    state.structuredDataType = next.seo?.structuredDataType || ''
    state.layoutId = typeof next.layoutId === 'string' ? next.layoutId : null
    state.content = next.content || emptyDoc
    lastSavedJson.value = stableStringify(buildSnapshot())
  },
  { immediate: true }
)

async function saveDraft() {
  if (!isDirty.value) return
  savingDraft.value = true
  try {
    await $fetch(`/api/page/${id.value}`, {
      method: 'PUT',
      body: { revision: currentRevision.value, title: state.title, content: state.content, layoutId: state.layoutId, ...publicMetadataPayload() }
    })
    toast.add({ title: 'Saved draft' })
    await refresh()
  } catch (e: any) {
    handleMutationError('Save', e)
  } finally {
    savingDraft.value = false
  }
}

async function publish() {
  if (!canPublish.value) return
  publishing.value = true
  try {
    await $fetch(`/api/page/${id.value}/publish`, {
      method: 'POST',
      body: { revision: currentRevision.value, title: state.title, content: state.content, layoutId: state.layoutId, ...publicMetadataPayload() }
    })
    toast.add({ title: 'Published' })
    await refresh()
  } catch (e: any) {
    handleMutationError('Publish', e)
  } finally {
    publishing.value = false
  }
}

const discarding = ref(false)
async function discardDraft() {
  discarding.value = true
  try {
    await $fetch(`/api/page/${id.value}/discard`, {
      method: 'POST',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Draft discarded' })
    await refresh()
  } catch (e: any) {
    handleMutationError('Discard', e)
  } finally {
    discarding.value = false
  }
}

const unpublishing = ref(false)
async function unpublish() {
  const unpublishingLiveRevision = !!doc.value?.hasPublishedRevision
  const ok = await confirm({
    title: unpublishingLiveRevision ? 'Unpublish page' : 'Archive page',
    body: unpublishingLiveRevision
      ? 'Anonymous delivery will stop, while the working draft is retained.'
      : 'The working draft will move to the archive.',
    confirmLabel: unpublishingLiveRevision ? 'Unpublish' : 'Archive',
    confirmColor: 'warning'
  })
  if (!ok) return
  unpublishing.value = true
  try {
    await $fetch(`/api/page/${id.value}/unpublish`, {
      method: 'POST',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: unpublishingLiveRevision ? 'Unpublished' : 'Archived' })
    await refresh()
  } catch (e: any) {
    handleMutationError('Unpublish', e)
  } finally {
    unpublishing.value = false
  }
}

const removing = ref(false)
async function remove() {
  const ok = await confirm({
    title: 'Delete page',
    body: 'This will soft delete the page and it will no longer appear in the list.',
    confirmLabel: 'Delete',
    confirmColor: 'error'
  })
  if (!ok) return
  removing.value = true
  try {
    await $fetch(`/api/page/${id.value}`, {
      method: 'DELETE',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Deleted (soft)' })
    allowNextNavigation()
    await navigateTo('/_desk/pages')
  } catch (e: any) {
    handleMutationError('Delete', e)
  } finally {
    removing.value = false
  }
}

const recovering = ref(false)
async function recover() {
  if (!isDeleted.value || recovering.value) return
  recovering.value = true
  try {
    await $fetch(`/api/page/${id.value}/recover` as any, {
      method: 'POST' as any,
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Page recovered', color: 'success' })
    await refresh()
  } catch (e: any) {
    handleMutationError('Recover', e)
  } finally {
    recovering.value = false
  }
}

const actionMenuItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []

  groups.push([{
    label: 'Revision history',
    icon: 'i-lucide-history',
    onSelect: () => { historyOpen.value = true }
  }])

  if (isDeleted.value) {
    groups.push([{
      label: 'Recover',
      icon: 'i-lucide-rotate-ccw',
      disabled: recovering.value,
      onSelect: recover
    }])
    return groups
  }

  if (doc.value?.hasPublishedRevision) {
    groups.push([{
      label: 'View published',
      icon: 'i-lucide-external-link',
      to: doc.value?.publishedPublicPath || undefined,
      target: '_blank'
    }])
  }

  if (canDiscard.value) {
    groups.push([{
      label: 'Discard draft',
      icon: 'i-lucide-rotate-ccw',
      disabled: discarding.value,
      onSelect: discardDraft
    }])
  }

  if (canArchive.value) {
    groups.push([{
      label: doc.value?.hasPublishedRevision ? 'Unpublish' : 'Archive',
      icon: doc.value?.hasPublishedRevision ? 'i-lucide-eye-off' : 'i-lucide-archive',
      disabled: unpublishing.value,
      onSelect: unpublish
    }])
  }

  groups.push([{
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    color: 'error',
    disabled: removing.value,
    onSelect: remove
  }])

  return groups
})
</script>

<template>
  <UDashboardPanel
    id="desk-pages-edit"
    :ui="{ root: 'min-h-0 overflow-hidden', body: 'min-h-0 overflow-hidden p-0 sm:p-0' }"
  >
    <template #header>
      <DeskNavbar :title="doc?.title || 'Page'">
        <template #title>
          <div class="flex min-w-0 flex-col">
            <UBreadcrumb :items="breadcrumbItems" />
            <div class="flex items-center gap-2">
              <UBadge :label="isDeleted ? 'Deleted' : (doc?.publicationState || state.status)" color="neutral" variant="subtle" size="sm" />
              <UBadge v-if="isDirty" label="Unsaved" color="warning" variant="subtle" size="sm" />
            </div>
          </div>
        </template>

        <template #actions>
          <CmsEditorActions
            :preview-to="isDeleted ? undefined : `/_preview/pages/${id}`"
            :show-preview="false"
            :show-save-draft="!isDeleted"
            :can-save-draft="canSaveDraft"
            :saving-draft="savingDraft"
            :show-publish="!isDeleted"
            :can-publish="canPublish"
            :publishing="publishing"
            :menu-items="actionMenuItems"
            :menu-loading="discarding || unpublishing || removing"
            @save-draft="saveDraft"
            @publish="publish"
          />
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div v-if="conflictDetails || isDeleted" class="space-y-2 border-b border-muted bg-default px-4 py-3">
          <UAlert
            v-if="conflictDetails"
            title="A newer revision is available"
            :description="conflictDetails.message || `Revision ${conflictDetails.currentRevision || 'newer'} was saved${conflictDetails.updatedBy ? ` by ${conflictDetails.updatedBy}` : ''}. Your local edits are still here.`"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
          >
            <template #actions>
              <UButton label="Review history" color="neutral" variant="outline" size="xs" @click="historyOpen = true;" />
              <UButton label="Reload latest" color="warning" variant="soft" size="xs" @click="reloadLatest" />
            </template>
          </UAlert>

          <UAlert
            v-if="isDeleted"
            title="This page is deleted"
            description="It is read-only until it is recovered. Revision history remains available."
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
          />

        </div>

        <PageEditor
          v-model="state.content"
          v-model:page-title="state.title"
          v-model:public-path="state.publicPath"
          v-model:description="state.description"
          v-model:social-image-asset-id="state.socialImageAssetId"
          v-model:layout-id="state.layoutId"
          :editable="!isDeleted"
          :page-validation-message="publishValidationIssues[0]?.message"
          :published-layout-id="doc?.publishedLayoutId ?? null"
          :has-published-revision="doc?.hasPublishedRevision === true"
          class="min-h-0 flex-1"
        />
      </div>

      <CmsRevisionHistorySlideover
        v-model:open="historyOpen"
        :history-url="`/api/page/${id}/history`"
        :current-revision="currentRevision"
        :can-restore="!isDeleted"
        title="Page revision history"
        @restored="handleHistoryRestored"
        @conflict="recordConflict"
      />
    </template>
  </UDashboardPanel>
</template>
