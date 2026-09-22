<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'

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
const schemaKey = computed(() => String(route.params.schemaKey))

const [schemaResult, permissionResult] = await Promise.all([
  useFetch<any>(() => `/api/schema/${schemaKey.value}/active`),
  useFetch<any>(() => `/api/schema/${schemaKey.value}/permission`)
])
const { data: schema } = schemaResult
const { data: permission } = permissionResult

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: schema.value?.title || schemaKey.value, icon: 'i-lucide-files', to: `/_desk/content/${schemaKey.value}` },
  { label: 'New' }
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

watchEffect(() => {
  if (!schema.value?.registry) return
  const next: Record<string, any> = {}
  for (const f of schema.value.registry.fields) {
    if (f?.system) continue
    next[f.key] = state.content[f.key]
      ?? (f.kind === 'richtext'
        ? { type: 'doc', content: [{ type: 'paragraph' }] }
        : f.kind === 'asset_list' ? [] : null)
  }
  state.content = next
})

const savingDraft = ref(false)
const publishing = ref(false)

const lastSavedContentJson = ref('')
const baselineReady = ref(false)
const currentContentJson = computed(() => stableStringify(buildContentSnapshot()))
const expectedFieldCount = computed(() => (schema.value?.registry?.fields ?? []).filter((field: any) => !field?.system).length)
const baselineReadyByFields = computed(() => !!schema.value?.registry && Object.keys(state.content).length === expectedFieldCount.value)

watchEffect(() => {
  if (baselineReady.value) return
  if (!baselineReadyByFields.value) return
  lastSavedContentJson.value = currentContentJson.value
  baselineReady.value = true
})

const isDirty = computed(() => baselineReady.value && currentContentJson.value !== lastSavedContentJson.value)
const canWrite = computed(() => !!permission.value && (permission.value.canWrite || permission.value.canAdmin))
const canPublishPermission = computed(() => !!permission.value && (permission.value.canPublish || permission.value.canAdmin))
const canSaveDraft = computed(() => canWrite.value && isDirty.value && !savingDraft.value)
const canPublish = computed(() => canWrite.value && canPublishPermission.value && isDirty.value && !publishing.value)

async function saveDraft() {
  if (!isDirty.value) return
  if (!(await contentFormRef.value?.validate?.())) {
    toast.add({ title: 'Fix validation errors', color: 'error' })
    return
  }
  savingDraft.value = true
  try {
    const res = await $fetch<{ id: string }>(`/api/content/${schemaKey.value}`, {
      method: 'POST',
      body: { content: state.content, seo: seoPayload() }
    })
    toast.add({ title: 'Created', description: res.id })
    await navigateTo(`/_desk/content/${schemaKey.value}/${res.id}`)
  } catch (e: any) {
    toast.add({ title: 'Create failed', description: e?.statusMessage || 'Error', color: 'error' })
  } finally {
    savingDraft.value = false
  }
}

async function publish() {
  if (!isDirty.value) return
  if (!(await contentFormRef.value?.validate?.())) {
    toast.add({ title: 'Fix validation errors', color: 'error' })
    return
  }
  publishing.value = true
  let createdId: string | null = null
  try {
    const created = await $fetch<{ id: string; revision: number }>(`/api/content/${schemaKey.value}`, {
      method: 'POST',
      body: { content: state.content, seo: seoPayload() }
    })
    createdId = created.id
    await $fetch(`/api/content/${schemaKey.value}/${created.id}/publish`, {
      method: 'POST',
      body: { revision: created.revision, content: state.content, seo: seoPayload() }
    })
    toast.add({ title: 'Published' })
    await navigateTo(`/_desk/content/${schemaKey.value}/${created.id}`)
  } catch (e: any) {
    toast.add({ title: 'Publish failed', description: e?.statusMessage || 'The draft was saved, but could not be published.', color: 'error' })
    if (createdId) await navigateTo(`/_desk/content/${schemaKey.value}/${createdId}`)
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="desk-content-new">
    <template #header>
      <DeskNavbar
        :title="`New ${schema?.title || schemaKey}`"
      >
        <template #title>
          <div class="flex min-w-0 flex-col">
            <UBreadcrumb :items="breadcrumbItems" />
            <span class="truncate text-xs text-muted">Add the details, then save a draft or publish.</span>
          </div>
        </template>

        <template #actions>
          <CmsEditorActions
            :show-save-draft="canWrite"
            :can-save-draft="canSaveDraft"
            :saving-draft="savingDraft"
            :show-publish="canPublishPermission"
            :can-publish="canPublish"
            :publishing="publishing"
            @save-draft="saveDraft"
            @publish="publish"
          />
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <CmsContentForm
        v-if="schema?.registry"
        ref="contentFormRef"
        :schema="schema"
        :model="state.content"
        class="shrink-0"
      />

      <CmsPublicMetadataFields
        v-model:title="state.seoTitle"
        v-model:description="state.seoDescription"
        v-model:image-asset-id="state.seoImageAssetId"
        v-model:structured-data-type="state.structuredDataType"
        :disabled="!canWrite"
        class="mt-4"
      />
    </template>
  </UDashboardPanel>
</template>
