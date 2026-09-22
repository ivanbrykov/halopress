<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
}>(), {
  description: undefined
})

defineSlots<{
  actions?: () => any
  title?: () => any
  leading?: () => any
}>()
</script>

<template>
  <UDashboardNavbar>
    <template #leading>
      <slot name="leading">
        <UDashboardSidebarCollapse />
      </slot>
    </template>

    <template #title>
      <slot name="title">
        <div class="flex flex-col min-w-0">
          <span class="truncate">{{ title }}</span>
          <span v-if="description" class="text-xs text-muted truncate">{{ description }}</span>
        </div>
      </slot>
    </template>

    <template #right>
      <div class="flex items-center gap-1.5 justify-end">
        <slot name="actions" />
      </div>
    </template>
  </UDashboardNavbar>
</template>
