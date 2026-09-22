<script setup lang="ts">
withDefaults(defineProps<{
  markOnly?: boolean
}>(), {
  markOnly: false
})
</script>

<template>
  <span class="inline-flex items-center gap-2" aria-label="HaloPress">
    <img
      src="/branding/halopress-mark-256.png"
      alt=""
      width="256"
      height="256"
      class="h-full w-auto shrink-0 object-contain"
      decoding="async"
    >
    <span
      v-if="!markOnly"
      class="whitespace-nowrap font-semibold tracking-tight text-highlighted"
    >Halo<span class="text-primary">Press</span></span>
  </span>
</template>
