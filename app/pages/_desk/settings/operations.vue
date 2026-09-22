<script setup lang="ts">
definePageMeta({ layout: 'desk' })
</script>

<template>
  <SettingsShell
    section="operations"
    title="Operations"
    description="Monitor background services and recover rebuildable derived data."
  >
    <SettingsSearchIndexingPanel />
  </SettingsShell>
</template>
