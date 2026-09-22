<script setup lang="ts">
withDefaults(defineProps<{
  alt?: string
  loading?: 'eager' | 'lazy'
  fetchpriority?: 'high' | 'low' | 'auto'
}>(), {
  alt: '',
  loading: 'lazy',
  fetchpriority: 'auto'
})
</script>

<template>
  <span class="relative block overflow-hidden">
    <img
      src="/branding/halopress-brand-artwork-light.png"
      :alt="alt"
      width="1254"
      height="1254"
      :loading="loading"
      :fetchpriority="fetchpriority"
      decoding="async"
      class="absolute inset-0 size-full object-cover dark:hidden"
    >
    <img
      src="/branding/halopress-brand-artwork-dark.png"
      :alt="alt"
      width="1254"
      height="1254"
      :loading="loading"
      :fetchpriority="fetchpriority"
      decoding="async"
      class="absolute inset-0 hidden size-full object-cover dark:block"
    >
  </span>
</template>
