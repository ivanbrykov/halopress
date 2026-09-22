<script setup lang="ts">
definePageMeta({ layout: 'desk' })

const route = useRoute()
</script>

<template>
  <SettingsShell
    section="access"
    title="Authentication & membership"
    description="Manage sign-in providers and decide how new public members receive access."
  >
    <div class="space-y-8">
      <SettingsAuthenticationPanel />
      <SettingsMembershipPanel :scroll-to-invitations="route.query.tab === 'invites'" />
    </div>
  </SettingsShell>
</template>
