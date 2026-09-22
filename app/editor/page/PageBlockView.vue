<script setup lang="ts">
import { resolvePageBlock, type StoredPageBlockAttrs } from '~~/shared/page-blocks'
import PageBlockFAQ from '~/components/page-blocks/PageBlockFAQ.vue'
import PageBlockLogos from '~/components/page-blocks/PageBlockLogos.vue'
import PageBlockMedia from '~/components/page-blocks/PageBlockMedia.vue'
import PageBlockTestimonial from '~/components/page-blocks/PageBlockTestimonial.vue'

const props = defineProps<{
  attrs: StoredPageBlockAttrs
}>()

const resolved = computed(() => resolvePageBlock(props.attrs))
</script>

<template>
  <PageBlockTestimonial
    v-if="resolved.status === 'known' && resolved.key === 'pageTestimonial'"
    v-bind="resolved.props"
    :media="resolved.media"
    class="w-full"
    data-page-block-view
  />
  <PageBlockLogos
    v-else-if="resolved.status === 'known' && resolved.key === 'pageLogos'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  />
  <PageBlockFAQ
    v-else-if="resolved.status === 'known' && resolved.key === 'pageFAQ'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  />
  <UPageHero
    v-else-if="resolved.status === 'known' && resolved.key === 'pageHero'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  >
    <PageBlockMedia :media="resolved.media" />
  </UPageHero>
  <UPageCard
    v-else-if="resolved.status === 'known' && resolved.key === 'pageCard'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  >
    <PageBlockMedia :media="resolved.media" />
  </UPageCard>
  <UPageSection
    v-else-if="resolved.status === 'known' && resolved.key === 'pageSection'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  >
    <PageBlockMedia :media="resolved.media" />
  </UPageSection>
  <UPageCTA
    v-else-if="resolved.status === 'known' && resolved.key === 'pageCTA'"
    v-bind="resolved.props"
    class="w-full"
    data-page-block-view
  >
    <PageBlockMedia :media="resolved.media" />
  </UPageCTA>

  <div
    v-else-if="resolved.status !== 'known'"
    class="rounded-lg border border-dashed border-muted p-6 text-sm text-muted"
    data-page-block-fallback
    :data-page-block-status="resolved.status"
  >
    {{ resolved.reason }}<span v-if="resolved.key">: {{ resolved.key }}</span>
  </div>
</template>
