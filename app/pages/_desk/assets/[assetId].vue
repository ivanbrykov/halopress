<script setup lang="ts">
definePageMeta({
  layout: 'desk'
})

const route = useRoute()
const router = useRouter()
const locale = useDisplayLocale()

const assetId = computed(() => route.params.assetId as string)

const { data, refresh, status } = await useFetch<{ asset: { id: string; kind: string; status: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; durationMs: number | null; createdAt: string; createdBy: string | null } }>(
  () => `/api/assets/${assetId.value}`
)

const { data: listData, refresh: refreshList } = await useFetch<{ items: Array<{ id: string; kind: string; status: string; mimeType: string; sizeBytes: number; createdAt: string }> }>(
  '/api/assets/list',
  { query: { limit: 200 } }
)

const asset = computed(() => data.value?.asset)
const isImage = computed(() => asset.value?.kind === 'image')
const previewUrl = computed(() => asset.value ? `/assets/${asset.value.id}/raw` : '')
const formatCreatedAt = (value: string) => formatDateTime(value, locale.value)

function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes || 0)
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const text = value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${text} ${units[i]}`
}

function handleUpdated() {
  refresh()
  refreshList()
}

function handleDeleted() {
  router.push('/_desk/assets')
}
</script>

<template>
  <UDashboardPanel id="desk-asset-detail">
    <template #header>
      <DeskNavbar title="Asset" description="Preview and manage this file.">
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-arrow-left" to="/_desk/assets">
            Back
          </UButton>
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="status === 'pending'"
        variant="naked"
        title="Loading asset..."
        role="status"
        aria-live="polite"
      >
        <template #leading>
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-muted" />
        </template>
      </UEmpty>

      <UEmpty
        v-else-if="!asset"
        variant="naked"
        icon="i-lucide-file-question-mark"
        title="Asset not found"
        description="This file may have been deleted, or the link may be incorrect."
      />

      <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="asset-preview-heading" class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 id="asset-preview-heading" class="font-medium">
                Preview
              </h2>
              <div class="text-xs text-muted truncate">{{ asset.id }}</div>
            </div>
            <AssetActions
              :asset="asset"
              :assets="listData?.items || []"
              variant="bar"
              @updated="handleUpdated"
              @deleted="handleDeleted"
            />
          </div>

          <div class="rounded-md border border-default bg-elevated/30 p-4">
            <AssetImage
              v-if="isImage"
              :src="previewUrl"
              class="w-full max-h-[420px] object-contain"
              alt=""
              preset="content"
            />
            <div v-else class="flex flex-col items-center justify-center gap-3 h-48 text-muted">
              <UIcon name="i-lucide-file" size="48" />
              <span class="text-sm">No preview available</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="asset-info-heading" class="space-y-4">
          <h2 id="asset-info-heading" class="font-medium">
            Asset info
          </h2>
          <dl class="grid gap-3 text-sm">
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">ID</dt>
              <dd class="font-medium break-all text-right">{{ asset.id }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">Kind</dt>
              <dd class="text-right">{{ asset.kind }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">MIME</dt>
              <dd class="text-right">{{ asset.mimeType }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">Size</dt>
              <dd class="text-right">{{ formatBytes(asset.sizeBytes) }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">Dimensions</dt>
              <dd class="text-right">
                <span v-if="asset.width && asset.height">{{ asset.width }} x {{ asset.height }}</span>
                <span v-else class="text-muted">Unknown</span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">Status</dt>
              <dd class="text-right">{{ asset.status }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">Created</dt>
              <dd class="text-right">{{ formatCreatedAt(asset.createdAt) }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted">URL</dt>
              <dd class="text-right break-all">{{ previewUrl }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
