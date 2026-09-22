<script setup lang="ts">
import type { SiteModeAdminResponse } from '~/composables/useSiteModeSettings'

definePageMeta({ layout: 'desk' })

const { data: siteMode } = await useFetch<SiteModeAdminResponse>('/api/settings/site-mode', {
  key: 'site-mode',
  dedupe: 'defer'
})
const destination = siteMode.value?.value.enabled === true
  ? '/_desk/site/themes'
  : '/_desk/site/general#built-in-appearance'

await navigateTo(destination, { replace: true, redirectCode: 302 })
</script>

<template>
  <div />
</template>
