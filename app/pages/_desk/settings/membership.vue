<script setup lang="ts">
definePageMeta({ layout: 'desk' })

const route = useRoute()
await navigateTo({
  path: '/_desk/settings/access',
  query: route.query,
  hash: '#membership'
}, { replace: true, redirectCode: 301 })
</script>

<template>
  <div />
</template>
