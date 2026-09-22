<script setup lang="ts">
useHead(() => ({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'halopress-theme-light', name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#F7F5FB' },
    { key: 'halopress-theme-dark', name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#100D2D' }
  ]
}))
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
