import type {
  SitePresentationAdminValue,
  SitePresentationPatch
} from '~~/shared/site-presentation'

export type SitePresentationAdminResponse = {
  value: SitePresentationAdminValue
  configured: boolean
  malformedStoredValue: boolean
  updatedAt: string | null
  updatedBy: string | null
  management: {
    source: 'default' | 'desk'
    editable: true
    secret: false
  }
  missingAssetIds: string[]
}

const SITE_PRESENTATION_SETTINGS_DATA_KEY = 'site-presentation-settings'

function useSitePresentationSettingsData() {
  return useFetch<SitePresentationAdminResponse>('/api/settings/site-presentation', {
    key: SITE_PRESENTATION_SETTINGS_DATA_KEY,
    dedupe: 'defer'
  })
}

export function useSitePresentationStatus() {
  const {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear
  } = useSitePresentationSettingsData()

  // Read-only dashboards render their own pending state, so they should not
  // suspend client setup while Nuxt resolves this AsyncData request.
  return { data, pending, status, error, refresh, execute, clear }
}

export async function useSitePresentationSettings() {
  const saving = ref(false)
  // Editors intentionally wait for persisted values before exposing mutable
  // forms, preventing their safe defaults from overwriting stored settings.
  const result = await useSitePresentationSettingsData()

  async function savePatch(patch: SitePresentationPatch) {
    saving.value = true
    try {
      const response = await $fetch<SitePresentationAdminResponse>('/api/settings/site-presentation', {
        method: 'PUT',
        body: patch
      })
      result.data.value = response
      // The editor cache is updated above; refresh the separately keyed public
      // presentation projection used by the delivery layout.
      await Promise.all([
        refreshNuxtData('site-presentation'),
        refreshNuxtData('site-theme-manifest')
      ])
      return response
    } finally {
      saving.value = false
    }
  }

  return { ...result, saving, savePatch }
}
