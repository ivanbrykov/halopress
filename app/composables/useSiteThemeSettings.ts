import type { SiteTheme } from '~~/shared/site-theme'

export type SiteThemeAdminResponse = {
  value: SiteTheme
  contractVersion: 1
  revision: string
  stylesheetRevision: string
  stylesheetUrl: string
  colorMode: SiteTheme['colorMode']
  warnings: string[]
  source: 'theme' | 'legacy-appearance' | 'default'
  configured: boolean
  malformedStoredValue: boolean
  legacyAppearanceMalformed: boolean
  updatedAt: string | null
  updatedBy: string | null
  management: {
    source: 'theme' | 'legacy-appearance' | 'default'
    editable: true
    secret: false
  }
}

const SITE_THEME_SETTINGS_DATA_KEY = 'site-theme-settings'

function useSiteThemeSettingsData() {
  return useFetch<SiteThemeAdminResponse>('/api/settings/theme', {
    key: SITE_THEME_SETTINGS_DATA_KEY,
    dedupe: 'defer'
  })
}

export function useSiteThemeStatus() {
  const { data, pending, status, error, refresh, execute, clear } = useSiteThemeSettingsData()

  // Read-only status surfaces render their own loading and error states. Keep
  // this return value synchronous and omit AsyncData's Promise methods.
  return { data, pending, status, error, refresh, execute, clear }
}

export async function useSiteThemeSettings() {
  const saving = ref(false)
  // The mutable Theme editor waits for the persisted document so safe defaults
  // cannot overwrite an existing active Theme during hydration.
  const result = await useSiteThemeSettingsData()

  async function refreshTheme() {
    const response = await result.refresh()
    await refreshNuxtData('site-theme-manifest')
    return response
  }

  async function saveTheme(theme: SiteTheme, expectedRevision: string) {
    saving.value = true
    try {
      const response = await $fetch<SiteThemeAdminResponse>('/api/settings/theme', {
        method: 'PUT',
        body: { theme, expectedRevision }
      })
      result.data.value = response
      await refreshNuxtData('site-theme-manifest')
      return response
    } finally {
      saving.value = false
    }
  }

  return { ...result, refresh: refreshTheme, saving, saveTheme }
}
