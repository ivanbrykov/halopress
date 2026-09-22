<script setup lang="ts">
import {
  authoredFieldHeadingPrefix,
  normalizeAuthoredDocument
} from '~~/shared/authored-document'

const props = withDefaults(defineProps<{
  document: unknown
  fieldId?: string
  fieldKey?: string
}>(), {
  fieldId: '',
  fieldKey: ''
})

const headingIdPrefix = computed(() => props.fieldId && props.fieldKey
  ? authoredFieldHeadingPrefix(props.fieldId, props.fieldKey)
  : undefined)
const normalized = computed(() => normalizeAuthoredDocument(props.document, {
  headingIdPrefix: headingIdPrefix.value
}))
</script>

<template>
  <div class="site-document site-rich-text-document" data-site-richtext-renderer>
    <SiteDocumentNode v-for="(node, index) in normalized.content" :key="index" :node="node" />
  </div>
</template>
