<script setup lang="ts">
definePageMeta({
  layout: 'desk'
})

const toast = useToast()
const locale = useDisplayLocale()
const { data, refresh } = await useFetch<{ items: Array<{ id: string; kind: string; status: string; mimeType: string; sizeBytes: number; createdAt: string }> }>('/api/assets/list', { query: { limit: 100 } })
const formatCreatedAt = (value: string) => formatDateTime(value, locale.value)

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const text = value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${text} ${units[i]}`
}

const uploadOpen = ref(false)
const uploading = ref(false)
const files = ref<File[] | null>(null)

watch(uploadOpen, (open) => {
  if (!open) files.value = null
})

watch(files, async (selected) => {
  if (!selected || !selected.length || uploading.value) return

  uploading.value = true
  try {
    for (const f of selected) {
      const form = new FormData()
      form.append('file', f, f.name)
      const res = await $fetch<{ assetId: string }>('/api/assets/upload', { method: 'POST', body: form })
      toast.add({ title: 'Uploaded', description: res.assetId })
    }
    await refresh()
    uploadOpen.value = false
  } catch (err: any) {
    toast.add({ title: 'Upload failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    uploading.value = false
    files.value = null
  }
})
</script>

<template>
  <UDashboardPanel id="desk-assets">
    <template #header>
      <DeskNavbar title="Assets" description="Upload and manage files you can reuse across your site.">
        <template #actions>
          <UModal v-model:open="uploadOpen" title="Upload assets" description="Add new files to the asset library."
            :ui="{ footer: 'justify-end' }">
            <UButton icon="i-lucide-plus" color="primary">
              Upload
            </UButton>
            <template #body>
              <UFileUpload v-model="files" multiple accept="image/*" label="Upload images"
                description="Drag & drop or click to select." :disabled="uploading" :interactive="!uploading"
                class="w-full min-h-32" />
              <p v-if="uploading" class="text-xs text-muted mt-2">
                Uploading…
              </p>
            </template>
            <template #footer>
              <UButton color="neutral" variant="outline" :disabled="uploading" @click="uploadOpen = false;">
                Close
              </UButton>
            </template>
          </UModal>
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <UPageGrid>
        <UCard v-for="a in (data?.items || [])" :key="a.id"
          :ui="{ root: 'overflow-hidden', body: 'p-0 sm:p-0', footer: 'p-3 sm:p-4' }">
          <template #default>
            <NuxtLink :to="`/_desk/assets/${a.id}`">
              <AssetImage v-if="a.kind === 'image'" :src="`/assets/${a.id}/raw`" alt="" preset="card"
                class="w-full aspect-4/3 object-cover" />
              <div v-else class="w-full aspect-4/3 flex items-center justify-center bg-elevated/50">
                <UIcon name="i-lucide-file" size="40" class="text-muted" />
              </div>
            </NuxtLink>
          </template>

          <template #footer>
            <div class="flex items-center justify-between gap-2">
              <UBadge variant="soft">
                {{ a.kind }}
              </UBadge>
              <span class="text-xs text-muted">
                {{ formatBytes(a.sizeBytes) }}
              </span>
            </div>
            <div class="flex items-end justify-between gap-2 mt-1">
              <span class="text-xs text-muted">
                {{ formatCreatedAt(a.createdAt) }}
              </span>
              <AssetActions :asset="a" :assets="data?.items || []" variant="menu" @updated="refresh()"
                @deleted="refresh()" />
            </div>
          </template>
        </UCard>
      </UPageGrid>
    </template>
  </UDashboardPanel>
</template>
