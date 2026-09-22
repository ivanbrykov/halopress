<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

export type AssetListItem = { assetId: string; alt?: string; caption?: string }

const props = withDefaults(defineProps<{
  modelValue: AssetListItem[] | null | undefined
  label?: string
  required?: boolean
  minItems?: number
  maxItems?: number
}>(), {
  minItems: 0,
  maxItems: undefined
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: AssetListItem[]): void
}>()

const file = ref<File | null>(null)
const uploading = ref(false)
const paletteOpen = ref(false)
const announcement = ref('')
const toast = useToast()
const items = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])
const atMaximum = computed(() => props.maxItems != null && items.value.length >= props.maxItems)

const { data: assetList, refresh: refreshAssets } = useFetch<{ items: Array<{ id: string; kind: string; sizeBytes: number }> }>('/api/assets/list', {
  query: { limit: 100 },
  lazy: true
})

function update(next: AssetListItem[], message?: string) {
  emit('update:modelValue', next)
  if (message) announcement.value = message
}

function addAsset(assetId: string) {
  if (!assetId || atMaximum.value) return
  const next = [...items.value, { assetId, alt: '', caption: '' }]
  update(next, `Added asset ${next.length} of ${next.length}`)
  paletteOpen.value = false
}

const assetGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [{
  id: 'assets',
  label: assetList.value?.items.length ? undefined : 'No assets found',
  items: (assetList.value?.items ?? []).map(asset => ({
    label: asset.id,
    value: asset.id,
    suffix: asset.kind,
    imageUrl: asset.kind === 'image' ? `/assets/${asset.id}/raw` : undefined,
    disabled: atMaximum.value,
    onSelect: () => addAsset(asset.id)
  }))
}])

watch(paletteOpen, (open) => {
  if (open) refreshAssets()
})
watch(file, async (nextFile) => {
  if (!nextFile || atMaximum.value) return
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', nextFile, nextFile.name)
    const result = await $fetch<{ assetId: string }>('/api/assets/upload', { method: 'POST', body: form })
    addAsset(result.assetId)
    toast.add({ title: 'Uploaded', description: result.assetId })
    await refreshAssets()
  } catch (error: any) {
    toast.add({ title: 'Upload failed', description: error?.statusMessage || 'Error', color: 'error' })
  } finally {
    uploading.value = false
    file.value = null
  }
})

function patchItem(index: number, patch: Partial<AssetListItem>) {
  update(items.value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
}

function move(index: number, offset: -1 | 1) {
  const target = index + offset
  if (target < 0 || target >= items.value.length) return
  const next = [...items.value]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  update(next, `Moved asset to position ${target + 1} of ${next.length}`)
}

function remove(index: number) {
  const next = items.value.filter((_, itemIndex) => itemIndex !== index)
  update(next, `Removed asset. ${next.length} remaining`)
}
</script>

<template>
  <fieldset class="min-w-0 space-y-3">
    <legend class="text-sm font-medium text-highlighted">
      {{ label || 'Asset list' }}<span v-if="required" class="ms-0.5 text-error" aria-hidden="true">*</span>
    </legend>
    <p class="text-xs text-muted">
      Add images in display order. Alt text describes the image; captions are shown publicly.
    </p>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

    <ol v-if="items.length" class="space-y-3" aria-label="Ordered assets">
      <li v-for="(item, index) in items" :key="`${item.assetId}-${index}`" class="rounded-lg border border-default bg-default p-3">
        <div class="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <AssetImage
            :src="`/assets/${item.assetId}/raw`"
            :alt="item.alt || ''"
            preset="card"
            sizes="144px"
            class="aspect-[4/3] w-full rounded-md bg-elevated object-cover"
          />
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="truncate text-xs text-muted">{{ index + 1 }}. {{ item.assetId }}</span>
              <div class="flex gap-1">
                <UButton :aria-label="`Move asset ${index + 1} up`" icon="i-lucide-arrow-up" size="xs" color="neutral" variant="outline" :disabled="index === 0" @click="move(index, -1)" />
                <UButton :aria-label="`Move asset ${index + 1} down`" icon="i-lucide-arrow-down" size="xs" color="neutral" variant="outline" :disabled="index === items.length - 1" @click="move(index, 1)" />
                <UButton :aria-label="`Remove asset ${index + 1}`" icon="i-lucide-trash" size="xs" color="error" variant="outline" @click="remove(index)" />
              </div>
            </div>
            <UFormField :label="`Alt text for asset ${index + 1}`">
              <UInput :model-value="item.alt" placeholder="Describe the image" class="w-full" @update:model-value="patchItem(index, { alt: String($event || '') })" />
            </UFormField>
            <UFormField :label="`Caption for asset ${index + 1}`">
              <UTextarea :model-value="item.caption" :rows="2" placeholder="Optional caption" class="w-full" @update:model-value="patchItem(index, { caption: String($event || '') })" />
            </UFormField>
          </div>
        </div>
      </li>
    </ol>

    <UAlert v-else title="No assets selected" description="Upload an image or choose one from the asset library." icon="i-lucide-images" variant="subtle" />

    <div class="grid gap-3 sm:grid-cols-2">
      <UFileUpload v-model="file" accept="image/*" :disabled="uploading || atMaximum" :interactive="!uploading && !atMaximum" label="Upload image" description="Drag & drop or click to select." class="min-h-28" />
      <div class="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-default bg-elevated/30 p-4">
        <UModal v-model:open="paletteOpen" title="Select existing asset" :ui="{ content: 'bg-default flex flex-col focus:outline-none w-[min(720px,96vw)]', body: 'p-0 sm:p-0', footer: 'justify-end' }">
          <UButton color="neutral" variant="outline" icon="i-lucide-images" :disabled="atMaximum">Select existing</UButton>
          <template #body>
            <UCommandPalette :groups="assetGroups" placeholder="Search assets..." class="h-[70vh] max-h-[520px] w-full" />
          </template>
          <template #footer>
            <UButton color="neutral" variant="outline" @click="paletteOpen = false;">Close</UButton>
          </template>
        </UModal>
      </div>
    </div>
    <p class="text-xs text-muted">
      {{ items.length }} selected<span v-if="minItems || maxItems"> · {{ minItems || 0 }}–{{ maxItems ?? 'any' }} allowed</span>
    </p>
  </fieldset>
</template>
