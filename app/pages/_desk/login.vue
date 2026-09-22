<script setup lang="ts">
definePageMeta({ layout: 'blank' })
await navigateTo('/login?callbackUrl=/_desk', { redirectCode: 302, replace: true })
</script>

<template>
  <div />
</template>
