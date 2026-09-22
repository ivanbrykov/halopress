<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'

defineProps<NodeViewProps>()
</script>

<template>
  <NodeViewWrapper
    as="section"
    class="page-hero-unit relative my-4 rounded-xl border border-muted bg-muted/30 p-5 sm:p-8"
    :class="[
      node.attrs.orientation === 'horizontal' && 'page-hero-unit--horizontal',
      node.attrs.reverse && 'page-hero-unit--reverse'
    ]"
    data-type="page-hero"
    :data-orientation="node.attrs.orientation"
    :data-reverse="node.attrs.reverse ? 'true' : undefined"
  >
    <div
      class="absolute right-3 top-3 rounded-full border border-muted bg-default/90 px-2 py-1 text-[0.6875rem] font-medium text-muted"
      contenteditable="false"
      data-page-hero-chrome
    >
      Editable Hero
    </div>
    <NodeViewContent class="page-hero-unit__content min-w-0 pt-6" />
  </NodeViewWrapper>
</template>

<style scoped>
.page-hero-unit__content :deep(> * + *) {
  margin-block-start: 0.9rem;
}

.page-hero-unit__content :deep(h1) {
  max-width: 48rem;
  font-size: clamp(2rem, 5vw, 4.5rem);
  font-weight: 750;
  line-height: 1.08;
  letter-spacing: -0.035em;
}

.page-hero-unit__content :deep(p) {
  max-width: 42rem;
}

.page-hero-unit__content :deep(img) {
  width: 100%;
  max-height: 32rem;
  border-radius: 0.75rem;
  object-fit: cover;
}

@media (min-width: 48rem) {
  .page-hero-unit--horizontal .page-hero-unit__content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 0.8fr);
    column-gap: 2rem;
    align-items: center;
  }

  .page-hero-unit--horizontal .page-hero-unit__content :deep(:not(img)) {
    grid-column: 1;
  }

  .page-hero-unit--horizontal .page-hero-unit__content :deep(img) {
    grid-row: 1 / span 4;
    grid-column: 2;
  }

  .page-hero-unit--horizontal.page-hero-unit--reverse .page-hero-unit__content :deep(:not(img)) {
    grid-column: 2;
  }

  .page-hero-unit--horizontal.page-hero-unit--reverse .page-hero-unit__content :deep(img) {
    grid-column: 1;
  }
}
</style>
