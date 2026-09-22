<script setup lang="ts">
const props = withDefaults(defineProps<{
  siteName: string
  logoUrl?: string | null
  markOnly?: boolean
}>(), {
  logoUrl: null,
  markOnly: false
})
</script>

<template>
  <span v-if="props.logoUrl" class="inline-flex h-full items-center">
    <img
      :src="props.logoUrl"
      :alt="props.siteName"
      class="h-full max-w-56 object-contain"
      decoding="async"
    >
  </span>
  <AppLogo v-else-if="props.siteName === 'HaloPress'" :mark-only="props.markOnly" />
  <span
    v-else
    class="inline-flex h-full items-center gap-2"
    :aria-label="props.markOnly ? props.siteName : undefined"
  >
    <img
      src="/branding/halopress-mark-256.png"
      alt=""
      class="h-full w-auto shrink-0 object-contain"
      decoding="async"
    >
    <span v-if="!props.markOnly" class="whitespace-nowrap font-semibold tracking-tight text-highlighted">
      {{ props.siteName }}
    </span>
  </span>
</template>
