<script setup lang="ts">
type FAQItem = {
  question: string
  answer: string
}

const props = withDefaults(defineProps<{
  headline?: string
  title?: string
  description?: string
  items?: FAQItem[]
}>(), {
  headline: '',
  title: '',
  description: '',
  items: () => []
})

const accordionItems = computed(() => props.items.map((item, index) => ({
  label: item.question,
  content: item.answer,
  value: `faq-${index + 1}`
})))
</script>

<template>
  <UPageSection
    :headline="headline"
    :title="title"
    :description="description"
    data-page-faq
  >
    <UAccordion
      :items="accordionItems"
      :default-value="accordionItems[0]?.value"
      :unmount-on-hide="false"
      class="mx-auto w-full max-w-3xl"
    />
  </UPageSection>
</template>
