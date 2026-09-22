import {
  normalizePublicSiteThemeManifest,
  type PublicSiteThemeManifest
} from '~~/shared/site-theme'

const SITE_THEME_MANIFEST_DATA_KEY = 'site-theme-manifest'

export function useSiteTheme() {
  const {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear
  } = useFetch<PublicSiteThemeManifest>('/api/delivery/site-theme', {
    key: SITE_THEME_MANIFEST_DATA_KEY,
    dedupe: 'defer'
  })
  const theme = computed(() => normalizePublicSiteThemeManifest(data.value))
  const contractError = computed(() => status.value === 'success' && theme.value === null
    ? new Error('The public Theme manifest has an unsupported or malformed contract.')
    : null)
  const themeError = computed(() => error.value ?? contractError.value)
  return { data, theme, pending, status, error: themeError, refresh, execute, clear }
}
