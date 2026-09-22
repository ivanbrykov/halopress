<script setup lang="ts">
import { computed } from 'vue'
import PageDocumentRenderer from '../../app/components/PageDocumentRenderer.vue'
import { buildPageDocumentFromPattern, type PagePatternKey } from '../../shared/page-patterns'

const props = defineProps<{
  patternKey: PagePatternKey
  patternVersion: number
}>()

const document = computed(() => buildPageDocumentFromPattern(props.patternKey))
</script>

<template>
  <div
    :data-page-pattern-fixture="`${patternKey}-v${patternVersion}`"
    class="bg-default text-default motion-reduce:transition-none"
  >
    <PageDocumentRenderer :document="document" />
  </div>
</template>
