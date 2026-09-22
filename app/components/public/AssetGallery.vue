<script setup lang="ts">
type Item = { assetId: string; alt?: string; caption?: string }
const props = defineProps<{ value: unknown; label?: string }>()

function normalize(value: unknown): Item[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((item) => {
    if (typeof item === 'string' && item) return [{ assetId: item }]
    if (item && typeof item === 'object' && typeof (item as any).assetId === 'string') {
      return [{
        assetId: (item as any).assetId,
        ...(typeof (item as any).alt === 'string' ? { alt: (item as any).alt } : {}),
        ...(typeof (item as any).caption === 'string' ? { caption: (item as any).caption } : {})
      }]
    }
    return []
  })
}

const items = computed(() => normalize(props.value))
const current = ref(0)
const slides = ref<Array<HTMLElement | undefined>>([])

function setSlideRef(element: unknown, index: number) {
  slides.value[index] = typeof HTMLElement !== 'undefined' && element instanceof HTMLElement ? element : undefined
}

function go(index: number) {
  if (!items.value.length) return
  current.value = Math.min(Math.max(index, 0), items.value.length - 1)
  slides.value[current.value]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') { event.preventDefault(); go(current.value - 1) }
  if (event.key === 'ArrowRight') { event.preventDefault(); go(current.value + 1) }
  if (event.key === 'Home') { event.preventDefault(); go(0) }
  if (event.key === 'End') { event.preventDefault(); go(items.value.length - 1) }
}
</script>

<template>
  <UAlert v-if="items.length === 0" title="No media available" description="Images will appear here when they are published." icon="i-lucide-image-off" variant="subtle" />
  <figure v-else-if="items.length === 1" class="space-y-2">
    <AssetImage :src="`/assets/${items[0]!.assetId}/raw`" :alt="items[0]!.alt || ''" preset="content" sizes="(max-width: 768px) 100vw, 960px" class="max-h-[70vh] w-full rounded-xl bg-elevated object-contain" />
    <figcaption v-if="items[0]!.caption" class="text-sm text-muted">{{ items[0]!.caption }}</figcaption>
  </figure>
  <section v-else :aria-label="label || 'Media gallery'" class="space-y-3" tabindex="0" @keydown="onKeydown">
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm font-medium text-highlighted">{{ label || 'Media gallery' }}</p>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted" role="status" aria-live="polite">Image {{ current + 1 }} of {{ items.length }}</span>
        <UButton aria-label="Previous image" icon="i-lucide-chevron-left" size="sm" color="neutral" variant="outline" :disabled="current === 0" @click="go(current - 1)" />
        <UButton aria-label="Next image" icon="i-lucide-chevron-right" size="sm" color="neutral" variant="outline" :disabled="current === items.length - 1" @click="go(current + 1)" />
      </div>
    </div>
    <ol class="asset-gallery flex snap-x snap-mandatory gap-4 overflow-x-auto rounded-xl" aria-label="Gallery images">
      <li v-for="(item, index) in items" :key="`${item.assetId}-${index}`" :ref="element => setSlideRef(element, index)" class="w-full shrink-0 snap-start">
        <figure class="space-y-2">
          <AssetImage :src="`/assets/${item.assetId}/raw`" :alt="item.alt || ''" preset="content" sizes="(max-width: 768px) 100vw, 960px" class="max-h-[70vh] w-full rounded-xl bg-elevated object-contain" />
          <figcaption v-if="item.caption" class="text-sm text-muted">{{ item.caption }}</figcaption>
        </figure>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.asset-gallery { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { .asset-gallery { scroll-behavior: auto; } }
</style>
