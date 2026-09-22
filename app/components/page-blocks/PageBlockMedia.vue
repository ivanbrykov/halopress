<script setup lang="ts">
import type { PageBlockMedia } from '~/editor/page/types'

defineProps<{
  media: PageBlockMedia
}>()
</script>

<template>
  <img
    v-if="media.url"
    :src="media.url"
    :alt="media.alt || ''"
    :width="media.width"
    :height="media.height"
    class="w-full rounded-lg object-cover"
  >
  <div
    v-else-if="media.requiredAction"
    class="flex min-h-48 w-full items-center justify-center rounded-lg border border-dashed border-muted bg-muted/40 p-6 text-center"
    role="note"
    data-page-block-media-placeholder
  >
    <div class="max-w-sm space-y-2 text-sm text-muted">
      <UIcon name="i-lucide-image-plus" class="mx-auto size-6 text-primary" />
      <p class="font-medium text-highlighted">Media required</p>
      <p>{{ media.requiredAction }}</p>
    </div>
  </div>
</template>
