<script setup lang="ts">
definePageMeta({ layout: false })

const { presentation } = await useSitePresentation()
const items = computed(() => siteNavigationItems(presentation.value, '/'))
const parent = computed(() => items.value[0])
const activeChild = computed(() => parent.value?.children?.[0])
</script>

<template>
  <section
    data-site-menu-horizontal-fixture
    :data-parent-value="parent?.value"
    :data-child-value="activeChild?.value"
  >
    <UNavigationMenu
      v-if="parent"
      :items="items"
      :default-value="String(parent.value)"
      orientation="horizontal"
      :ui="{
        link: 'site-menu-horizontal-fixture-link',
        childLink: 'site-menu-horizontal-fixture-child-link'
      }"
    />
  </section>

  <section
    data-site-menu-vertical-fixture
    :data-parent-value="parent?.value"
    :data-child-value="activeChild?.value"
    :data-parent-open="String(Boolean(parent?.defaultOpen))"
  >
    <UNavigationMenu :items="items" orientation="vertical" />
  </section>
</template>
