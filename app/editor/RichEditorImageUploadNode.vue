<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()

const file = ref<File | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)

watch(file, async (newFile) => {
  if (!newFile) return

  loading.value = true
  errorMessage.value = null

  try {
    const formData = new FormData()
    formData.append('file', newFile)

    const response = await $fetch<{ assetId: string }>('/api/assets/upload', {
      method: 'POST',
      body: formData
    })

    const pos = props.getPos()
    if (typeof pos !== 'number') return

    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + 1 })
      .setImage({ src: `/assets/${response.assetId}/raw` })
      .run()
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Image upload failed. Please try again.'
  } finally {
    loading.value = false
    file.value = null
  }
})
</script>

<template>
  <NodeViewWrapper>
    <UFileUpload
      v-model="file"
      accept="image/*"
      label="Upload an image"
      description="PNG, JPG, GIF or SVG"
      :preview="false"
      :disabled="loading"
      class="min-h-48"
    >
      <template #leading>
        <UAvatar
          :icon="loading ? 'i-lucide-loader-circle' : 'i-lucide-image'"
          size="xl"
          :ui="{ icon: [loading && 'animate-spin'] }"
        />
      </template>
    </UFileUpload>

    <p
      v-if="errorMessage"
      class="mt-2 text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>
  </NodeViewWrapper>
</template>
