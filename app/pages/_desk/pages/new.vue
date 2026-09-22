<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'
import type { JSONContent } from '@tiptap/vue-3'
import { validatePageDocumentBlocks } from '~~/shared/page-blocks'
import { buildPageDocumentFromPattern } from '~~/shared/page-patterns'
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

const toast = useToast()

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: 'Pages', icon: 'i-lucide-panels-top-left', to: '/_desk/pages' },
  { label: 'New' }
]))

const emptyDoc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

const state = reactive({
  title: '',
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
const starterChoice = ref<'blank' | 'starter' | null>(null)

function chooseStarter(choice: 'blank' | 'starter') {
  starterChoice.value = choice
  state.content = choice === 'starter'
    ? buildPageDocumentFromPattern('starter-page')
    : structuredClone(emptyDoc)
}

function buildSnapshot() {
  return {
    title: state.title || '',
    layoutId: state.layoutId,
    ...publicMetadataPayload(),
    content: state.content
  }
}

const savingDraft = ref(false)
const publishing = ref(false)
const lastSavedJson = ref(stableStringify(buildSnapshot()))
const currentJson = computed(() => stableStringify(buildSnapshot()))
const isDirty = computed(() => currentJson.value !== lastSavedJson.value)
const draftValidationIssues = computed(() => validatePageDocumentBlocks(state.content, { allowUnknown: true }))
const publishValidationIssues = computed(() => validatePageDocumentForPublication(state.content))
const hasStarterChoice = computed(() => starterChoice.value !== null)
const canSaveDraft = computed(() => hasStarterChoice.value && isDirty.value && !draftValidationIssues.value.length && !savingDraft.value)
const canPublish = computed(() => hasStarterChoice.value && isDirty.value && !publishValidationIssues.value.length && !publishing.value)
const { allowNextNavigation } = useUnsavedNavigationGuard(isDirty)

async function saveDraft() {
  if (!canSaveDraft.value) return
  savingDraft.value = true
  try {
    const res = await $fetch<{ id: string }>('/api/page', {
      method: 'POST',
      body: { title: state.title, content: state.content, layoutId: state.layoutId, ...publicMetadataPayload() }
    })
    toast.add({ title: 'Created', description: res.id })
    allowNextNavigation()
    await navigateTo(`/_desk/pages/${res.id}`)
  } catch (e: any) {
    toast.add({ title: 'Create failed', description: e?.statusMessage || 'Error', color: 'error' })
  } finally {
    savingDraft.value = false
  }
}

async function publish() {
  if (!canPublish.value) return
  publishing.value = true
  let createdId: string | null = null
  try {
    const created = await $fetch<{ id: string; revision: number }>('/api/page', {
      method: 'POST',
      body: { title: state.title, content: state.content, layoutId: state.layoutId, ...publicMetadataPayload() }
    })
    createdId = created.id
    await $fetch(`/api/page/${created.id}/publish`, {
      method: 'POST',
      body: { revision: created.revision, title: state.title, content: state.content, layoutId: state.layoutId, ...publicMetadataPayload() }
    })
    toast.add({ title: 'Published', description: created.id })
    allowNextNavigation()
    await navigateTo(`/_desk/pages/${created.id}`)
  } catch (e: any) {
    toast.add({ title: 'Publish failed', description: e?.statusMessage || 'The draft was saved, but could not be published.', color: 'error' })
    if (createdId) {
      allowNextNavigation()
      await navigateTo(`/_desk/pages/${createdId}`)
    }
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="desk-pages-new"
    :ui="{ root: 'min-h-0 overflow-hidden', body: 'min-h-0 overflow-hidden p-0 sm:p-0' }"
  >
    <template #header>
      <DeskNavbar title="New Page">
        <template #title>
          <div class="flex min-w-0 flex-col">
            <UBreadcrumb :items="breadcrumbItems" />
            <div class="flex items-center gap-2">
              <UBadge label="Draft" color="neutral" variant="subtle" size="sm" />
              <UBadge v-if="isDirty" label="Unsaved" color="warning" variant="subtle" size="sm" />
            </div>
          </div>
        </template>

        <template #actions>
          <CmsEditorActions
            :can-save-draft="canSaveDraft"
            :saving-draft="savingDraft"
            :can-publish="canPublish"
            :publishing="publishing"
            @save-draft="saveDraft"
            @publish="publish"
          />
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div
          v-if="!starterChoice"
          class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4 sm:p-8"
          data-page-starter-choices
        >
          <div class="w-full max-w-3xl space-y-5">
            <div class="text-center">
              <h2 class="text-xl font-semibold text-highlighted">How would you like to start?</h2>
              <p class="mt-1 text-sm text-muted">Choose a blank canvas or a reviewed, fully editable starter page.</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <UPageCard>
                <div class="space-y-4">
                  <UIcon name="i-lucide-file-plus-2" class="size-7 text-primary" />
                  <div>
                    <h3 class="font-semibold text-highlighted">Blank page</h3>
                    <p class="mt-1 text-sm text-muted">Start with an empty paragraph and add only what you need.</p>
                  </div>
                  <UButton label="Start blank" icon="i-lucide-arrow-right" block @click="chooseStarter('blank')" />
                </div>
              </UPageCard>
              <UPageCard>
                <div class="space-y-4">
                  <UIcon name="i-lucide-panels-top-left" class="size-7 text-primary" />
                  <div>
                    <h3 class="font-semibold text-highlighted">Marketing starter</h3>
                    <p class="mt-1 text-sm text-muted">Use a reviewed hero, features, proof, FAQ, and closing action.</p>
                  </div>
                  <UButton label="Use starter page" icon="i-lucide-sparkles" block @click="chooseStarter('starter')" />
                </div>
              </UPageCard>
            </div>
          </div>
        </div>
        <PageEditor
          v-else
          v-model="state.content"
          v-model:page-title="state.title"
          v-model:public-path="state.publicPath"
          v-model:description="state.description"
          v-model:social-image-asset-id="state.socialImageAssetId"
          v-model:layout-id="state.layoutId"
          :page-validation-message="publishValidationIssues[0]?.message"
          class="min-h-0 flex-1"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
