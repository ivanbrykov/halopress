<script setup lang="ts">
import type { LayoutRenderProjection } from '~~/shared/layout-rendering'
import LayoutRenderer from './LayoutRenderer.vue'

const props = defineProps<{ projection: LayoutRenderProjection }>()
</script>

<template>
  <LayoutRenderer v-if="props.projection.status === 'ready'" :projection="props.projection">
    <slot />
  </LayoutRenderer>
  <slot v-else name="fallback" :projection="props.projection" />
</template>
