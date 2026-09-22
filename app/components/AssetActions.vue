<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, DropdownMenuItem } from '@nuxt/ui'

type AssetSummary = {
  id: string
  kind: string
  mimeType?: string
  sizeBytes?: number
  createdAt?: string
}

const props = withDefaults(defineProps<{
  asset: AssetSummary
  assets?: AssetSummary[]
  variant?: 'menu' | 'bar'
}>(), {
  assets: () => [],
  variant: 'menu'
})

const emit = defineEmits<{
  updated: []
  deleted: []
}>()

const toast = useToast()

const replaceOpen = ref(false)
const deleteOpen = ref(false)
const replacementOpen = ref(false)
const replacing = ref(false)
const deleting = ref(false)
const replaceFile = ref<File | null>(null)
const replacementId = ref<string | null>(null)

const availableAssets = computed(() => (props.assets || []).filter(a => a.id !== props.asset.id))

function kindIcon(kind?: string) {
  if (kind === 'image') return 'i-lucide-image'
  if (kind === 'video') return 'i-lucide-film'
  return 'i-lucide-file'
}

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

const replacementGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const items = availableAssets.value.map(asset => ({
    label: asset.id,
    value: asset.id,
    suffix: [asset.kind, formatBytes(asset.sizeBytes)].filter(Boolean).join(' | '),
    imageUrl: asset.kind === 'image' ? `/assets/${asset.id}/raw` : undefined,
    icon: asset.kind === 'image' ? undefined : kindIcon(asset.kind),
    active: replacementId.value === asset.id,
    onSelect: () => {
      replacementId.value = asset.id
    }
  }))

  return [
    {
      id: 'assets',
      label: items.length ? undefined : 'No replacement assets',
      items
    }
  ]
})

const menuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Replace',
      icon: 'i-lucide-refresh-ccw',
      onSelect() {
        replaceOpen.value = true
      }
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect() {
        deleteOpen.value = true
      }
    }
  ]
])

async function handleReplace() {
  const file = replaceFile.value
  if (!file || replacing.value) return

  replacing.value = true
  try {
    const form = new FormData()
    form.append('file', file, file.name)
    await $fetch(`/api/assets/${props.asset.id}/replace`, { method: 'POST', body: form })
    toast.add({ title: 'Asset replaced', description: props.asset.id })
    replaceOpen.value = false
    replaceFile.value = null
    emit('updated')
  } catch (err: any) {
    toast.add({ title: 'Replace failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    replacing.value = false
  }
}

async function handleDelete() {
  if (deleting.value) return

  deleting.value = true
  try {
    const body = replacementId.value ? { replacementId: replacementId.value } : {}
    await $fetch(`/api/assets/${props.asset.id}/delete`, {
      method: 'POST',
      body
    })
    toast.add({ title: 'Asset deleted', description: props.asset.id })
    deleteOpen.value = false
    replacementId.value = null
    emit('deleted')
  } catch (err: any) {
    toast.add({ title: 'Delete failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    deleting.value = false
  }
}

function onSelectReplacement(item: CommandPaletteItem | undefined) {
  const value = (item as any)?.value || (item as any)?.label
  if (typeof value === 'string' && value) {
    replacementId.value = value
    replacementOpen.value = false
  }
}

watch(deleteOpen, (open) => {
  if (!open) {
    replacementId.value = null
    replacementOpen.value = false
  }
})

watch(replaceOpen, (open) => {
  if (!open) replaceFile.value = null
})
</script>

<template>
  <div v-if="variant === 'bar'" class="flex items-center gap-2">
    <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-ccw" @click="replaceOpen = true;">
      Replace
    </UButton>
    <UButton size="sm" color="error" variant="solid" icon="i-lucide-trash-2" @click="deleteOpen = true;">
      Delete
    </UButton>
  </div>

  <UDropdownMenu v-else :items="menuItems" :ui="{ content: 'w-44' }">
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      icon="i-lucide-more-vertical"
      aria-label="Asset actions"
    />
  </UDropdownMenu>

  <UModal v-model:open="replaceOpen" title="Replace asset" description="Upload a new file. The asset URL stays the same." :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFileUpload
          v-model="replaceFile"
          accept="image/*"
          :multiple="false"
          label="Upload new file"
          description="The new file replaces the current asset content."
          :disabled="replacing"
        />
        <p class="text-xs text-muted">
          Current asset: <span class="font-medium">{{ asset.id }}</span>
        </p>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="replacing" @click="replaceOpen = false;">
        Cancel
      </UButton>
      <UButton color="primary" :loading="replacing" :disabled="!replaceFile" @click="handleReplace">
        Replace
      </UButton>
    </template>
  </UModal>

  <UModal v-model:open="deleteOpen" title="Delete asset" :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          Deleting an asset can break content that references it. Choose a replacement to automatically swap
          references, or leave it empty to remove those relations from content.
        </p>

        <UPopover v-model:open="replacementOpen" :content="{ side: 'bottom', align: 'start' }">
          <UButton color="neutral" variant="outline" icon="i-lucide-image">
            {{ replacementId ? 'Change replacement' : 'Choose replacement (optional)' }}
          </UButton>

          <template #content>
            <UCommandPalette
              :groups="replacementGroups"
              placeholder="Search replacement assets..."
              class="h-72 w-[min(520px,80vw)]"
              :ui="{
                input: '[&>input]:h-9 [&>input]:text-sm',
                viewport: 'p-2 grid grid-cols-2 gap-2',
                group: 'contents',
                label: 'col-span-full px-1 text-xs text-muted',
                item: 'p-0 w-full',
                itemWrapper: 'w-full'
              }"
              @update:model-value="onSelectReplacement"
            >
              <template #item="{ item }">
                <div class="w-full rounded-md border border-default bg-default/60 p-2 hover:bg-elevated/40 transition">
                  <div class="aspect-[4/3] overflow-hidden rounded-sm bg-elevated/50 flex items-center justify-center">
                    <AssetImage
                      v-if="item.imageUrl"
                      :src="item.imageUrl"
                      alt=""
                      preset="card"
                      class="h-full w-full object-cover"
                    />
                    <UIcon v-else :name="item.icon || 'i-lucide-file'" size="28" class="text-muted" />
                  </div>
                  <div class="mt-2 text-xs">
                    <div class="font-medium truncate">{{ item.label }}</div>
                    <div class="text-muted truncate">{{ item.suffix }}</div>
                  </div>
                </div>
              </template>
            </UCommandPalette>
          </template>
        </UPopover>

        <div class="flex items-center justify-between gap-2 text-xs text-muted">
          <span>Replacement: <span class="font-medium">{{ replacementId || 'None selected' }}</span></span>
          <UButton
            v-if="replacementId"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="replacementId = null;"
          >
            Clear
          </UButton>
        </div>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="deleting" @click="deleteOpen = false;">
        Cancel
      </UButton>
      <UButton color="error" :loading="deleting" @click="handleDelete">
        Delete
      </UButton>
    </template>
  </UModal>
</template>
