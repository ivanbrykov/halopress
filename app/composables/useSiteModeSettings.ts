import type { SiteMode } from '~~/shared/site-mode'

export type SiteModeAdminResponse = {
  value: SiteMode
  configured: boolean
  malformedStoredValue: boolean
  updatedAt: string | null
  updatedBy: string | null
  management: {
    source: 'default' | 'desk'
    editable: true
    secret: false
  }
}

const SITE_MODE_DATA_KEY = 'site-mode'

export function useSiteMode() {
  const {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear
  } = useFetch<SiteModeAdminResponse>('/api/settings/site-mode', {
    key: SITE_MODE_DATA_KEY,
    dedupe: 'defer'
  })
  const enabled = computed(() => data.value?.value.enabled === true)

  // Nuxt still awaits this request during SSR. Keeping the wrapper synchronous
  // lets client callers render pending/error state instead of suspending setup.
  // Return only the reactive surface so the raw thenable methods do not leak.
  return { data, pending, status, error, refresh, execute, clear, enabled }
}

export function useSiteModeSettings() {
  const result = useSiteMode()
  const saving = ref(false)

  async function saveEnabled(enabled: boolean) {
    saving.value = true
    try {
      const response = await $fetch<SiteModeAdminResponse>('/api/settings/site-mode', {
        method: 'PUT',
        body: { enabled }
      })
      result.data.value = response
      await Promise.all([
        refreshNuxtData(SITE_MODE_DATA_KEY),
        refreshNuxtData('site-theme-manifest'),
        refreshNuxtData('layout-assignment-options'),
        refreshNuxtData('site-layout-assignment-settings')
      ])
      return response
    } finally {
      saving.value = false
    }
  }

  return { ...result, saving, saveEnabled }
}
