<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { z } from 'zod'

definePageMeta({
  layout: 'desk'
})

type SchemaListItem = {
  schemaKey: string
  title?: string
  activeVersion: number
  status: 'active' | 'inactive'
}

type LifecycleAction = 'deactivate' | 'reactivate' | 'delete' | 'purge'

type LifecycleImpact = {
  schemaKey: string
  status: 'active' | 'inactive' | 'never-published'
  activeVersion: number | null
  counts: {
    contentTotal: number
    contentByStatus: Record<string, number>
    versions: number
    drafts: number
    inboundReferences: number
    outboundReferences: number
    listings: number
    searchConfig: number
    searchProjections: number
    permissions: number
    publicationRevisions: number
    documentRevisions: number
    assetReferences: number
  }
  blockers: string[]
  canDelete: boolean
  canPurge: boolean
}

const toast = useToast()
const { data: session } = useAuth()
const isAdmin = computed(() => session.value?.user?.role === 'admin')
const schemaListUrl = computed(() => isAdmin.value
  ? '/api/schema/list?includeInactive=1'
  : '/api/schema/list')

const {
  data,
  status: listStatus,
  error: listError,
  refresh: refreshSchemas
} = useFetch<{ items: SchemaListItem[] }>(schemaListUrl, {
  key: 'schema-inventory'
})

const items = computed(() => data.value?.items ?? [])
const showEmpty = computed(() => listStatus.value === 'success' && items.value.length === 0)

const selectedSchema = ref<SchemaListItem | null>(null)
const lifecycleAction = ref<LifecycleAction | null>(null)
const lifecycleOpen = ref(false)
const impactPending = ref(false)
const impactError = ref('')
const lifecycleImpact = ref<LifecycleImpact | null>(null)
const actionRunning = ref(false)
let impactRequestId = 0

const purgeState = reactive({ confirmation: '' })
const purgeFormSchema = computed(() => z.object({
  confirmation: z.string().refine(
    value => value === selectedSchema.value?.schemaKey,
    `Type ${selectedSchema.value?.schemaKey ?? 'the Schema key'} to confirm.`
  )
}))

const lifecycleTitle = computed(() => {
  const title = selectedSchema.value?.title || selectedSchema.value?.schemaKey || 'Schema'
  if (lifecycleAction.value === 'deactivate') return `Deactivate ${title}?`
  if (lifecycleAction.value === 'reactivate') return `Reactivate ${title}?`
  if (lifecycleAction.value === 'delete') return `Delete empty ${title}?`
  return `Purge ${title} and its content?`
})

const lifecycleDescription = computed(() => {
  if (lifecycleAction.value === 'deactivate') {
    return 'Creation and public delivery stop, while content, versions, permissions, and history remain preserved.'
  }
  if (lifecycleAction.value === 'reactivate') {
    return 'Creation and public delivery resume immediately using the retained published Schema.'
  }
  if (lifecycleAction.value === 'delete') {
    return 'Only an empty Schema can be deleted. The server rechecks every dependency inside the deletion transaction.'
  }
  return 'This permanently removes the inactive Schema, all owned content, projections, references, permissions, drafts, and revision history. Assets are retained.'
})

const actionLabel = computed(() => {
  if (lifecycleAction.value === 'deactivate') return 'Deactivate'
  if (lifecycleAction.value === 'reactivate') return 'Reactivate'
  if (lifecycleAction.value === 'delete') return 'Delete empty Schema'
  return 'Purge permanently'
})

const actionColor = computed(() => {
  if (lifecycleAction.value === 'deactivate') return 'warning' as const
  if (lifecycleAction.value === 'reactivate') return 'primary' as const
  return 'error' as const
})

const impactItems = computed(() => {
  const counts = lifecycleImpact.value?.counts
  if (!counts) return []
  return [
    { label: 'Content', value: counts.contentTotal },
    { label: 'Versions', value: counts.versions },
    { label: 'Drafts', value: counts.drafts },
    { label: 'Inbound refs', value: counts.inboundReferences },
    { label: 'Outbound refs', value: counts.outboundReferences },
    { label: 'Listings', value: counts.listings },
    { label: 'Search rows', value: counts.searchProjections },
    { label: 'Permissions', value: counts.permissions },
    { label: 'Publication history', value: counts.publicationRevisions },
    { label: 'Revision history', value: counts.documentRevisions },
    { label: 'Asset refs', value: counts.assetReferences }
  ]
})

const actionAllowed = computed(() => {
  const impact = lifecycleImpact.value
  if (!impact || impactPending.value || actionRunning.value) return false
  if (lifecycleAction.value === 'deactivate') return impact.status === 'active'
  if (lifecycleAction.value === 'reactivate') return impact.status === 'inactive'
  if (lifecycleAction.value === 'delete') return impact.canDelete
  if (lifecycleAction.value === 'purge') {
    return impact.canPurge && purgeState.confirmation === selectedSchema.value?.schemaKey
  }
  return false
})

function actionMenuItems(schema: SchemaListItem): DropdownMenuItem[][] {
  return [
    [
      schema.status === 'active'
        ? {
            label: 'Deactivate',
            icon: 'i-lucide-circle-pause',
            color: 'warning',
            onSelect: () => openLifecycleAction(schema, 'deactivate')
          }
        : {
            label: 'Reactivate',
            icon: 'i-lucide-refresh-cw',
            onSelect: () => openLifecycleAction(schema, 'reactivate')
          }
    ],
    [
      {
        label: 'Delete empty Schema',
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => openLifecycleAction(schema, 'delete')
      },
      {
        label: 'Purge Schema and content',
        icon: 'i-lucide-bomb',
        color: 'error',
        onSelect: () => openLifecycleAction(schema, 'purge')
      }
    ]
  ]
}

async function openLifecycleAction(schema: SchemaListItem, action: LifecycleAction) {
  selectedSchema.value = schema
  lifecycleAction.value = action
  lifecycleImpact.value = null
  impactError.value = ''
  purgeState.confirmation = ''
  lifecycleOpen.value = true
  impactPending.value = true
  const requestId = ++impactRequestId
  try {
    const impact = await $fetch<LifecycleImpact>(`/api/schema/${schema.schemaKey}/lifecycle`)
    if (requestId === impactRequestId) lifecycleImpact.value = impact
  } catch (error: any) {
    if (requestId === impactRequestId) {
      impactError.value = error?.statusMessage || 'Lifecycle impact could not be loaded.'
    }
  } finally {
    if (requestId === impactRequestId) impactPending.value = false
  }
}

function closeLifecycle() {
  if (actionRunning.value) return
  impactRequestId += 1
  lifecycleOpen.value = false
  selectedSchema.value = null
  lifecycleAction.value = null
  lifecycleImpact.value = null
  impactError.value = ''
  impactPending.value = false
  purgeState.confirmation = ''
}

async function runLifecycleAction() {
  const schema = selectedSchema.value
  const action = lifecycleAction.value
  if (!schema || !action || !actionAllowed.value) return
  actionRunning.value = true
  try {
    if (action === 'delete') {
      await $fetch(`/api/schema/${schema.schemaKey}`, { method: 'DELETE' })
    } else if (action === 'purge') {
      await $fetch(`/api/schema/${schema.schemaKey}/purge`, {
        method: 'POST',
        body: { confirmation: purgeState.confirmation }
      })
    } else {
      await $fetch(`/api/schema/${schema.schemaKey}/${action}`, { method: 'POST' })
    }
    toast.add({ title: `${schema.title || schema.schemaKey} ${action === 'delete' || action === 'purge' ? 'removed' : `${action}d`}` })
    lifecycleOpen.value = false
    await Promise.all([refreshSchemas(), refreshNuxtData()])
    selectedSchema.value = null
    lifecycleAction.value = null
    lifecycleImpact.value = null
  } catch (error: any) {
    const blockers = error?.data?.impact?.blockers
    toast.add({
      title: `Failed to ${action} Schema`,
      description: Array.isArray(blockers) ? blockers.join(' ') : error?.statusMessage || 'Error',
      color: 'error'
    })
    try {
      lifecycleImpact.value = await $fetch<LifecycleImpact>(`/api/schema/${schema.schemaKey}/lifecycle`)
    } catch {
      // Preserve the original action error; a later retry can reload impact.
    }
  } finally {
    actionRunning.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="desk-schemas">
    <template #header>
      <DeskNavbar title="Schemas" description="Define the content types and fields your team can publish.">
        <template #actions>
          <UButton to="/_desk/schemas/new" icon="i-lucide-plus" aria-label="New Schema">
            <span class="hidden sm:inline">New Schema</span>
          </UButton>
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="listError"
        class="mb-6"
        title="Schemas unavailable"
        :description="listError.statusMessage || 'The Schema inventory could not be loaded.'"
        icon="i-lucide-cloud-off"
        color="error"
        variant="subtle"
      />

      <div
        v-if="listStatus === 'idle' || listStatus === 'pending'"
        class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Loading Schemas"
      >
        <USkeleton v-for="index in 3" :key="index" class="h-40 w-full" />
      </div>

      <UEmpty
        v-else-if="showEmpty"
        class="min-h-[50vh]"
        icon="i-lucide-braces"
        title="No Schemas yet"
        description="Create a Schema to define the fields your editors will use."
        variant="naked"
      >
        <template #actions>
          <UButton to="/_desk/schemas/new" icon="i-lucide-plus">
            Create Schema
          </UButton>
        </template>
      </UEmpty>

      <UPageGrid v-else-if="listStatus === 'success'">
        <div
          v-for="schema in items"
          :key="schema.schemaKey"
          class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2"
        >
          <UPageCard
            :title="schema.title || schema.schemaKey"
            :description="schema.status === 'inactive' ? `Version ${schema.activeVersion} is retained but unavailable` : `Version ${schema.activeVersion} is live`"
            :to="`/_desk/schemas/${schema.schemaKey}`"
            icon="i-lucide-braces"
            :highlight="schema.status === 'inactive'"
            highlight-color="warning"
          >
            <template #footer>
              <UBadge
                :color="schema.status === 'inactive' ? 'warning' : 'success'"
                variant="soft"
                size="sm"
                :label="schema.status === 'inactive' ? 'Inactive' : 'Active'"
              />
            </template>
          </UPageCard>

          <ClientOnly>
            <div v-if="isAdmin" class="flex items-start pt-2">
              <UDropdownMenu :items="actionMenuItems(schema)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis-vertical"
                  color="neutral"
                  variant="ghost"
                  :aria-label="`Lifecycle actions for ${schema.title || schema.schemaKey}`"
                />
              </UDropdownMenu>
            </div>
          </ClientOnly>
        </div>
      </UPageGrid>

      <UModal
        v-model:open="lifecycleOpen"
        :title="lifecycleTitle"
        :description="lifecycleDescription"
        :dismissible="!actionRunning"
        @update:open="value => { if (!value) closeLifecycle() }"
      >
        <template #body>
          <div class="space-y-4">
            <div v-if="impactPending" class="space-y-3" aria-label="Loading lifecycle impact">
              <USkeleton class="h-20 w-full" />
              <div class="grid gap-2 sm:grid-cols-2">
                <USkeleton v-for="index in 4" :key="index" class="h-14" />
              </div>
            </div>

            <UAlert
              v-else-if="impactError"
              title="Lifecycle impact unavailable"
              :description="impactError"
              icon="i-lucide-cloud-off"
              color="error"
              variant="subtle"
            />

            <template v-else-if="lifecycleImpact">
              <div class="grid gap-2 sm:grid-cols-2">
                <div v-for="item in impactItems" :key="item.label" class="rounded-lg border border-default p-3">
                  <div class="text-xs text-muted">{{ item.label }}</div>
                  <div class="mt-1 text-lg font-semibold text-highlighted">{{ item.value }}</div>
                </div>
              </div>

              <div v-if="Object.keys(lifecycleImpact.counts.contentByStatus).length" class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted">Content by status</span>
                <UBadge
                  v-for="(count, statusKey) in lifecycleImpact.counts.contentByStatus"
                  :key="statusKey"
                  color="neutral"
                  variant="soft"
                  :label="`${statusKey}: ${count}`"
                />
              </div>

              <UAlert
                v-if="lifecycleImpact.blockers.length"
                title="This action is currently blocked"
                :description="lifecycleImpact.blockers.join(' ')"
                icon="i-lucide-shield-alert"
                color="warning"
                variant="subtle"
              />

              <UForm
                v-if="lifecycleAction === 'purge'"
                id="schema-inventory-purge-form"
                :schema="purgeFormSchema"
                :state="purgeState"
                @submit="runLifecycleAction"
              >
                <UAlert
                  title="This action cannot be undone"
                  :description="`Type ${selectedSchema?.schemaKey} exactly to confirm the destructive purge.`"
                  icon="i-lucide-triangle-alert"
                  color="error"
                  variant="subtle"
                  class="mb-4"
                />
                <UFormField name="confirmation" :label="`Schema key: ${selectedSchema?.schemaKey}`" required>
                  <UInput
                    v-model="purgeState.confirmation"
                    class="w-full"
                    :placeholder="selectedSchema?.schemaKey"
                    autocomplete="off"
                    :disabled="actionRunning"
                    autofocus
                  />
                </UFormField>
              </UForm>
            </template>
          </div>
        </template>

        <template #footer>
          <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <UButton color="neutral" variant="outline" :disabled="actionRunning" @click="closeLifecycle">
              Cancel
            </UButton>
            <UButton
              :type="lifecycleAction === 'purge' ? 'submit' : 'button'"
              :form="lifecycleAction === 'purge' ? 'schema-inventory-purge-form' : undefined"
              :color="actionColor"
              :icon="lifecycleAction === 'purge' ? 'i-lucide-bomb' : lifecycleAction === 'delete' ? 'i-lucide-trash-2' : undefined"
              :loading="actionRunning"
              :disabled="!actionAllowed"
              @click="lifecycleAction === 'purge' ? undefined : runLifecycleAction()"
            >
              {{ actionLabel }}
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
