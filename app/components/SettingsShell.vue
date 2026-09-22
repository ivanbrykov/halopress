<script setup lang="ts">
import type { SettingsSectionId } from '~~/shared/settings-sections'

defineProps<{
  section: SettingsSectionId
  title: string
  description: string
}>()

</script>

<template>
  <UDashboardPanel :id="`desk-settings-${section}`">
    <template #header>
      <DeskNavbar :title="title" :description="description">
        <template v-if="$slots.actions" #actions>
          <slot name="actions" />
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <main class="mx-auto w-full max-w-6xl pb-10">
        <slot />
      </main>
    </template>
  </UDashboardPanel>
</template>
