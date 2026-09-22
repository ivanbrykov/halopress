<script setup lang="ts">
import type { TimelineItem } from '@nuxt/ui'

type RevisionHistoryItem = {
  revision: number
  action: string
  status: string
  title?: string | null
  createdBy?: string | null
  createdAt: string
  changes?: unknown
  snapshot?: unknown
}

const props = withDefaults(defineProps<{
  open: boolean
  historyUrl: string
  currentRevision: number
  canRestore?: boolean
  title?: string
}>(), {
  canRestore: false,
  title: 'Revision history'
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  restored: [value: unknown]
  conflict: [error: unknown]
}>()

const toast = useToast()
const { confirm } = useConfirmDialog()
const locale = useDisplayLocale()
const pending = ref(false)
const restoring = ref(false)
const items = ref<RevisionHistoryItem[]>([])
const retentionLimit = ref(100)
const selectedRevision = ref<number>()

const selectedItem = computed(() => items.value.find(item => item.revision === selectedRevision.value) ?? null)
const timelineItems = computed<Array<TimelineItem & { revision: number }>>(() => items.value.map(item => ({
  value: item.revision,
  revision: item.revision,
  date: formatDateTime(item.createdAt, locale.value),
  title: item.title || `${formatAction(item.action)} · revision ${item.revision}`,
  description: [formatAction(item.action), item.status, item.createdBy].filter(Boolean).join(' · '),
  icon: actionIcon(item.action)
})))

const formattedChanges = computed(() => formatJson(selectedItem.value?.changes))
const formattedSnapshot = computed(() => formatJson(selectedItem.value?.snapshot))

function formatAction(action: string) {
  return action
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function actionIcon(action: string) {
  if (action.includes('publish')) return 'i-lucide-upload'
  if (action.includes('delete')) return 'i-lucide-trash-2'
  if (action.includes('recover') || action.includes('restore')) return 'i-lucide-rotate-ccw'
  if (action.includes('archive') || action.includes('unpublish')) return 'i-lucide-archive'
  return 'i-lucide-save'
}

function formatJson(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function isConflict(error: any) {
  return error?.statusCode === 409 || error?.status === 409 || error?.response?.status === 409
}

async function loadHistory() {
  if (!props.historyUrl) return
  pending.value = true
  try {
    const response = await $fetch<{ items: RevisionHistoryItem[]; retentionLimit: number }>(props.historyUrl)
    items.value = response.items ?? []
    retentionLimit.value = response.retentionLimit ?? 100
    if (!items.value.some(item => item.revision === selectedRevision.value)) {
      selectedRevision.value = items.value[0]?.revision
    }
  } catch (error: any) {
    toast.add({
      title: 'History unavailable',
      description: error?.statusMessage || 'Could not load revision history.',
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}

async function restoreSelected() {
  const revision = selectedItem.value?.revision
  if (!revision || !props.canRestore || restoring.value) return
  const ok = await confirm({
    title: `Restore revision ${revision}?`,
    body: 'The selected snapshot will become a new revision. Existing history will remain unchanged.',
    confirmLabel: 'Restore',
    confirmColor: 'warning'
  })
  if (!ok) return

  restoring.value = true
  try {
    const response = await $fetch(`${props.historyUrl}/${revision}/restore` as any, {
      method: 'POST' as any,
      body: { revision: props.currentRevision }
    })
    toast.add({ title: `Restored revision ${revision}`, color: 'success' })
    emit('restored', response)
    await loadHistory()
  } catch (error: any) {
    if (isConflict(error)) {
      emit('conflict', error)
      return
    }
    toast.add({
      title: 'Restore failed',
      description: error?.statusMessage || 'Could not restore this revision.',
      color: 'error'
    })
  } finally {
    restoring.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) void loadHistory()
})
</script>

<template>
  <USlideover
    :open="open"
    :title="title"
    :description="`Inspect changes and restore an earlier snapshot. The latest ${retentionLimit} saves and all transition revisions are retained.`"
    :ui="{ content: 'w-full sm:max-w-2xl', body: 'p-0' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div v-if="pending && !items.length" class="space-y-3 p-4 sm:p-6">
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-14 w-full" />
      </div>

      <UAlert
        v-else-if="!items.length"
        class="m-4 sm:m-6"
        title="No revisions yet"
        description="Meaningful saves and publication changes will appear here."
        icon="i-lucide-history"
        color="neutral"
        variant="subtle"
      />

      <div v-else class="grid min-h-0 grid-cols-1 divide-y divide-default lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div class="min-h-0 overflow-y-auto p-4 sm:p-6">
          <UTimeline
            v-model="selectedRevision"
            :items="timelineItems"
            value-key="value"
            color="neutral"
            size="sm"
            class="w-full"
          />
        </div>

        <div v-if="selectedItem" class="min-h-0 space-y-6 overflow-y-auto p-4 sm:p-6">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge color="neutral" variant="soft">
              Revision {{ selectedItem.revision }}
            </UBadge>
            <UBadge variant="subtle" class="capitalize">
              {{ selectedItem.status }}
            </UBadge>
            <span class="text-xs text-muted">
              {{ formatDateTime(selectedItem.createdAt, locale) }}
            </span>
          </div>

          <section class="space-y-2" aria-labelledby="revision-changes-heading">
            <h3 id="revision-changes-heading" class="text-sm font-semibold text-highlighted">
              Changes
            </h3>
            <pre v-if="formattedChanges" class="max-h-72 overflow-auto rounded-md border border-default bg-elevated p-3 text-xs text-toned whitespace-pre-wrap break-words">{{ formattedChanges }}</pre>
            <p v-else class="text-sm text-muted">
              No structured change summary is available for this revision.
            </p>
          </section>

          <section class="space-y-2" aria-labelledby="revision-snapshot-heading">
            <h3 id="revision-snapshot-heading" class="text-sm font-semibold text-highlighted">
              Snapshot
            </h3>
            <pre class="max-h-[32rem] overflow-auto rounded-md border border-default bg-elevated p-3 text-xs text-toned whitespace-pre-wrap break-words">{{ formattedSnapshot }}</pre>
          </section>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span class="text-xs text-muted">
          Restore creates a new immutable revision.
        </span>
        <UButton
          v-if="canRestore && selectedItem"
          label="Restore this revision"
          icon="i-lucide-rotate-ccw"
          color="warning"
          :loading="restoring"
          @click="restoreSelected"
        />
      </div>
    </template>
  </USlideover>
</template>
