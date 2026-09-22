<script setup lang="ts">
import BuiltInLayoutRenderer from '~/components/layout-renderer/BuiltInLayoutRenderer.vue'

// This Nuxt application layout is a code-owned fallback for ordinary routes.
// Persisted HaloPress Layout IDs never select, resolve, or reference this file.
</script>

<template>
  <BuiltInLayoutRenderer>
    <slot />
  </BuiltInLayoutRenderer>
</template>
