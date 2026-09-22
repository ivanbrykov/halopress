<script setup lang="ts">
type SearchIndexStatus = {
  available: boolean
  tokenizerGeneration: string
  queryEpoch: number | null
  jobs: {
    pending: number
    processing: number
    failed: number
    ready: number
    stale: number
  }
  indexes: {
    pending: number
    building: number
    failed: number
    ready: number
    stale: number
  }
  progress: {
    indexedChunks: number
    totalChunks: number
  }
  latestError: {
    jobId: string
    message: string
    updatedAt: string
  } | null
}

const toast = useToast()
const retrying = ref(false)
const reindexing = ref(false)
const { data, pending, error, refresh } = useFetch<SearchIndexStatus>('/api/settings/search-index')

const progressValue = computed(() => data.value?.progress.indexedChunks ?? null)
const progressMax = computed(() => Math.max(1, data.value?.progress.totalChunks ?? 1))
const progressValueText = () => {
  const progress = data.value?.progress
  return progress ? `${progress.indexedChunks} of ${progress.totalChunks} chunks` : 'Progress unavailable'
}

async function retryFailed() {
  retrying.value = true
  try {
    const result = await $fetch<{ retried: number }>('/api/settings/search-index/retry', { method: 'POST' })
    await refresh()
    toast.add({
      title: result.retried ? 'Failed indexing jobs queued' : 'No failed jobs to retry',
      description: result.retried ? `${result.retried} job(s) will resume from durable checkpoints.` : undefined,
      color: result.retried ? 'success' : 'neutral'
    })
  } catch (retryError: any) {
    toast.add({
      title: 'Could not retry indexing',
      description: retryError?.data?.statusMessage || retryError?.statusMessage || 'Try again.',
      color: 'error'
    })
  } finally {
    retrying.value = false
  }
}

async function reindexAll() {
  reindexing.value = true
  try {
    const result = await $fetch<{ enqueuedSchemas: number }>('/api/settings/search-index/reindex', { method: 'POST' })
    await refresh()
    toast.add({
      title: result.enqueuedSchemas ? 'Full reindex queued' : 'No full-text fields are enabled',
      description: result.enqueuedSchemas ? `${result.enqueuedSchemas} schema(s) will rebuild lazily.` : undefined,
      color: result.enqueuedSchemas ? 'success' : 'neutral'
    })
  } catch (reindexError: any) {
    toast.add({
      title: 'Could not queue a full reindex',
      description: reindexError?.data?.statusMessage || reindexError?.statusMessage || 'Try again.',
      color: 'error'
    })
  } finally {
    reindexing.value = false
  }
}
</script>

<template>
  <section class="space-y-6 rounded-lg border border-default p-5" aria-labelledby="search-index-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h2 id="search-index-heading" class="text-lg font-semibold text-highlighted">
          Search indexing
        </h2>
        <p class="text-sm text-muted">
          Monitor the separate Korean full-text Worker and recover durable jobs without blocking publishing.
        </p>
      </div>
      <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" :loading="pending" @click="refresh()">
        Refresh indexing
      </UButton>
    </div>

    <UAlert
      v-if="error"
      title="Search indexing status is unavailable"
      :description="error.statusMessage || 'Refresh the page and verify the search Worker and D1 migration.'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
    />

    <UProgress v-else-if="pending && !data" aria-label="Loading search indexing status" />

    <div v-else-if="data" class="space-y-6">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UPageCard title="Ready indexes" :description="String(data.indexes.ready)" icon="i-lucide-circle-check" variant="subtle" />
        <UPageCard title="Pending jobs" :description="String(data.jobs.pending)" icon="i-lucide-clock-3" variant="subtle" />
        <UPageCard title="Active jobs" :description="String(data.jobs.processing)" icon="i-lucide-loader-circle" variant="subtle" />
        <UPageCard title="Failed jobs" :description="String(data.jobs.failed)" icon="i-lucide-triangle-alert" variant="subtle" />
      </div>

      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span class="font-medium text-highlighted">Chunk progress</span>
          <span class="text-muted">{{ data.progress.indexedChunks }} / {{ data.progress.totalChunks }}</span>
        </div>
        <UProgress
          :model-value="progressValue"
          :max="progressMax"
          :color="data.jobs.failed ? 'error' : data.jobs.processing ? 'info' : 'success'"
          :get-value-text="progressValueText"
        />
      </div>

      <dl class="grid gap-4 rounded-lg bg-elevated p-4 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-muted">Tokenizer generation</dt>
          <dd class="mt-1 break-all font-mono text-xs text-highlighted">{{ data.tokenizerGeneration }}</dd>
        </div>
        <div>
          <dt class="text-muted">Query epoch</dt>
          <dd class="mt-1 font-medium text-highlighted">{{ data.queryEpoch ?? 'Unavailable' }}</dd>
        </div>
      </dl>

      <UAlert
        v-if="data.latestError"
        title="Latest indexing error"
        :description="`${data.latestError.message} (${data.latestError.jobId})`"
        color="error"
        variant="subtle"
        icon="i-lucide-bug"
      />

      <div class="flex flex-col gap-2 border-t border-muted pt-5 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="retrying"
          :disabled="!data.jobs.failed"
          @click="retryFailed"
        >
          Retry failed
        </UButton>
        <UButton icon="i-lucide-database-backup" :loading="reindexing" @click="reindexAll">
          Reindex all
        </UButton>
      </div>
    </div>
  </section>
</template>
