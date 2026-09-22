<script setup lang="ts">
import type { PageBlockMedia } from '~/editor/page/types'

const props = withDefaults(defineProps<{
  quote?: string
  author?: string
  role?: string
  company?: string
  media?: PageBlockMedia
}>(), {
  quote: '',
  author: '',
  role: '',
  company: '',
  media: () => ({})
})

const authorDescription = computed(() => [props.role, props.company].filter(Boolean).join(', '))
const avatar = computed(() => props.media.url
  ? { src: props.media.url, alt: props.media.alt || props.author, loading: 'lazy' as const }
  : { icon: 'i-lucide-user-round' })
</script>

<template>
  <UPageSection data-page-testimonial>
    <UPageCard variant="subtle" class="mx-auto max-w-4xl">
      <div class="space-y-6">
        <UIcon name="i-lucide-quote" class="size-8 text-primary" aria-hidden="true" />
        <blockquote class="text-xl font-medium text-highlighted sm:text-2xl">
          “{{ quote }}”
        </blockquote>
        <UUser
          :name="author"
          :description="authorDescription"
          :avatar="avatar"
          size="lg"
        />
        <p v-if="!media.url && media.requiredAction" class="text-xs text-muted" role="note">
          {{ media.requiredAction }}
        </p>
      </div>
    </UPageCard>
  </UPageSection>
</template>
