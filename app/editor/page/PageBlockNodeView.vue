<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper } from '@tiptap/vue-3'
import PageBlockView from './PageBlockView.vue'

const props = defineProps<NodeViewProps>()

</script>

<template>
  <NodeViewWrapper :class="['page-block-node', props.selected && 'ring-2 ring-primary/30 rounded-xl']">
    <PageBlockView :attrs="props.node.attrs" />
  </NodeViewWrapper>
</template>
