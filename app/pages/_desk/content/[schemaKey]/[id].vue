<script setup lang="ts">
import type { BreadcrumbItem, DropdownMenuItem } from '@nuxt/ui'

type ContentPermission = {
  canRead: boolean
  canWrite: boolean
  canPublish: boolean
  canArchive: boolean
  canDelete: boolean
  canAdmin: boolean
}

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
const schemaKey = computed(() => String(route.params.schemaKey))
const id = computed(() => String(route.params.id))

const [schemaResult, docResult, permissionResult] = await Promise.all([
  useFetch<any>(() => `/api/schema/${schemaKey.value}/active`),
  useFetch<any>(() => `/api/content/${schemaKey.value}/${id.value}`),
  useFetch<ContentPermission>(() => `/api/schema/${schemaKey.value}/permission`)
])
const { data: schema } = schemaResult
const { data: doc, refresh: refreshDoc } = docResult
const { data: permission } = permissionResult

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: schema.value?.title || schemaKey.value, icon: 'i-lucide-files', to: `/_desk/content/${schemaKey.value}` },
  { label: doc.value?.content?.title || doc.value?.title || doc.value?.id || id.value }
]))

const state = reactive({
  content: {} as Record<string, any>,
  seoTitle: '',
  seoDescription: '',
  seoImageAssetId: '',
  structuredDataType: ''
})

function seoPayload() {
  return {
    title: state.seoTitle || undefined,
    description: state.seoDescription || undefined,
    imageAssetId: state.seoImageAssetId || undefined,
    structuredDataType: state.structuredDataType || undefined
  }
}

const contentFormRef = ref<any>(null)

function buildContentSnapshot() {
  return {
    content: state.content,
    seo: seoPayload()
  }
}

function buildContentSnapshotFromDoc(source: any) {
  return {
    content: source?.content || source?.extra || {},
    seo: source?.seo || {}
  }
}

const savingDraft = ref(false)
const publishing = ref(false)
const historyOpen = ref(false)
const conflictDetails = ref<Record<string, any> | null>(null)
const currentRevision = computed(() => Number(doc.value?.revision ?? 0))
const isDeleted = computed(() => doc.value?.status === 'deleted')
const canWrite = computed(() => !!permission.value && (permission.value.canWrite || permission.value.canAdmin))
const canPublishPermission = computed(() => !!permission.value && (permission.value.canPublish || permission.value.canAdmin))
const canArchivePermission = computed(() => !!permission.value && (permission.value.canArchive || permission.value.canAdmin))
const canDeletePermission = computed(() => !!permission.value && (permission.value.canDelete || permission.value.canAdmin))

const lastSavedContentJson = ref('')
const currentContentJson = computed(() => stableStringify(buildContentSnapshot()))
const isDirty = computed(() => !!doc.value && currentContentJson.value !== lastSavedContentJson.value)
const canSaveDraft = computed(() => !!doc.value && !isDeleted.value && canWrite.value && isDirty.value && !savingDraft.value)
const canPublish = computed(() => !!doc.value && !isDeleted.value && canPublishPermission.value && (
  isDirty.value || ['never-published', 'unpublished', 'published-with-draft'].includes(doc.value?.publicationState)
) && !publishing.value)
const canDiscard = computed(() => !isDeleted.value && canWrite.value && !!doc.value?.hasPublishedRevision && doc.value?.hasDraftChanges)
const canArchive = computed(() => !isDeleted.value && canArchivePermission.value && doc.value?.status !== 'archived')

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
  await refreshDoc()
  conflictDetails.value = null
}

async function handleHistoryRestored() {
  await refreshDoc()
  conflictDetails.value = null
}

watch(
  () => doc.value,
  (next) => {
    if (!next) return
    state.content = { ...(next.content || next.extra || {}) }
    state.seoTitle = next.seo?.title || ''
    state.seoDescription = next.seo?.description || ''
    state.seoImageAssetId = next.seo?.imageAssetId || ''
    state.structuredDataType = next.seo?.structuredDataType || ''
    lastSavedContentJson.value = stableStringify(buildContentSnapshotFromDoc(next))
  },
  { immediate: true }
)

async function saveDraft() {
  if (!isDirty.value) return
  if (!(await contentFormRef.value?.validate?.())) {
    toast.add({ title: 'Fix validation errors', color: 'error' })
    return
  }
  savingDraft.value = true
  try {
    await $fetch(`/api/content/${schemaKey.value}/${id.value}`, {
      method: 'PUT',
      body: { revision: currentRevision.value, content: state.content, seo: seoPayload() }
    })
    toast.add({ title: 'Saved draft' })
    await refreshDoc()
  } catch (e: any) {
    handleMutationError('Save', e)
  } finally {
    savingDraft.value = false
  }
}

async function publish() {
  if (!canPublish.value) return
  if (!(await contentFormRef.value?.validate?.())) {
    toast.add({ title: 'Fix validation errors', color: 'error' })
    return
  }
  publishing.value = true
  try {
    await $fetch(`/api/content/${schemaKey.value}/${id.value}/publish`, {
      method: 'POST',
      body: {
        revision: currentRevision.value,
        ...(canWrite.value ? { content: state.content, seo: seoPayload() } : {})
      }
    })
    toast.add({ title: 'Published' })
    await refreshDoc()
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
    await $fetch(`/api/content/${schemaKey.value}/${id.value}/discard`, {
      method: 'POST',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Draft discarded' })
    await refreshDoc()
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
    title: unpublishingLiveRevision ? 'Unpublish content' : 'Archive content',
    body: unpublishingLiveRevision
      ? 'Anonymous delivery will stop, while the working draft is retained.'
      : 'The working draft will move to the archive.',
    confirmLabel: unpublishingLiveRevision ? 'Unpublish' : 'Archive',
    confirmColor: 'warning'
  })
  if (!ok) return
  unpublishing.value = true
  try {
    await $fetch(`/api/content/${schemaKey.value}/${id.value}/unpublish`, {
      method: 'POST',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: unpublishingLiveRevision ? 'Unpublished' : 'Archived' })
    await refreshDoc()
  } catch (e: any) {
    handleMutationError('Unpublish', e)
  } finally {
    unpublishing.value = false
  }
}

const removing = ref(false)
async function remove() {
  const ok = await confirm({
    title: 'Delete content',
    body: 'This will soft delete the content and it will no longer appear in the list.',
    confirmLabel: 'Delete',
    confirmColor: 'error'
  })
  if (!ok) return
  removing.value = true
  try {
    await $fetch(`/api/content/${schemaKey.value}/${id.value}`, {
      method: 'DELETE',
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Deleted (soft)' })
    await navigateTo(`/_desk/content/${schemaKey.value}`)
  } catch (e: any) {
    handleMutationError('Delete', e)
  } finally {
    removing.value = false
  }
}

const recovering = ref(false)
async function recover() {
  if (!canDeletePermission.value || recovering.value) return
  recovering.value = true
  try {
    await $fetch(`/api/content/${schemaKey.value}/${id.value}/recover` as any, {
      method: 'POST' as any,
      body: { revision: currentRevision.value }
    })
    toast.add({ title: 'Content recovered', color: 'success' })
    await refreshDoc()
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

  if (isDeleted.value && canDeletePermission.value) {
    groups.push([{
      label: 'Recover',
      icon: 'i-lucide-rotate-ccw',
      disabled: recovering.value,
      onSelect: recover
    }])
    return groups
  }

  if (doc.value?.publishedPublicPath) {
    groups.push([{
      label: 'View published',
      icon: 'i-lucide-external-link',
      to: doc.value.publishedPublicPath,
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

  if (canDeletePermission.value) {
    groups.push([{
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      disabled: removing.value,
      onSelect: remove
    }])
  }

  return groups
})
</script>

<template>
  <UDashboardPanel id="desk-content-edit">
    <template #header>
      <DeskNavbar
        :title="doc?.content?.title || doc?.title || doc?.id || id"
      >
        <template #title>
          <div class="flex flex-col min-w-0">
            <UBreadcrumb :items="breadcrumbItems" />
            <span class="text-xs text-muted truncate">{{ `${schema?.title || schemaKey} • ${doc?.publicationState || 'never-published'}` }}</span>
          </div>
        </template>

        <template #actions>
          <CmsEditorActions
            :preview-to="isDeleted ? undefined : `/_preview/content/${schemaKey}/${id}`"
            :show-save-draft="!isDeleted && canWrite"
            :can-save-draft="canSaveDraft"
            :saving-draft="savingDraft"
            :show-publish="!isDeleted && canPublishPermission"
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
        title="This content is deleted"
        description="It is read-only until an authorized editor recovers it. Revision history remains available."
        icon="i-lucide-trash-2"
        color="error"
        variant="subtle"
      />

      <CmsContentForm
        v-if="schema?.registry"
        ref="contentFormRef"
        :schema="schema"
        :model="state.content"
        :disabled="isDeleted || !canWrite"
        class="shrink-0"
      />

      <CmsPublicMetadataFields
        v-model:title="state.seoTitle"
        v-model:description="state.seoDescription"
        v-model:image-asset-id="state.seoImageAssetId"
        v-model:structured-data-type="state.structuredDataType"
        :disabled="isDeleted || !canWrite"
        class="mt-4"
      />

      <CmsRevisionHistorySlideover
        v-model:open="historyOpen"
        :history-url="`/api/content/${schemaKey}/${id}/history`"
        :current-revision="currentRevision"
        :can-restore="!isDeleted && canWrite"
        title="Content revision history"
        @restored="handleHistoryRestored"
        @conflict="recordConflict"
      />
    </template>
  </UDashboardPanel>
</template>
