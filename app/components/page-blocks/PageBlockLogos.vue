<script setup lang="ts">
type LogoItem = {
  name: string
  src?: string
  alt?: string
}

withDefaults(defineProps<{
  title?: string
  items?: LogoItem[]
}>(), {
  title: '',
  items: () => []
})
</script>

<template>
  <UPageLogos :title="title" data-page-logos>
    <div class="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
      <div
        v-for="(item, index) in items"
        :key="`${item.name}-${index}`"
        class="flex min-h-20 items-center justify-center rounded-lg border border-muted bg-default p-4"
      >
        <img v-if="item.src" :src="item.src" :alt="item.alt || item.name" class="max-h-10 max-w-full object-contain">
        <span v-else class="text-center text-xs text-muted" role="note">
          <UIcon name="i-lucide-image-plus" class="mx-auto mb-1 size-5 text-primary" />
          {{ item.name }} · Add logo
        </span>
      </div>
    </div>
  </UPageLogos>
</template>
