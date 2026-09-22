import {
  defaultSitePresentation,
  toPublicSitePresentation,
  type PublicSitePresentation
} from '~~/shared/site-presentation'

export async function useSitePresentation() {
  const fallback = toPublicSitePresentation(defaultSitePresentation(), new Set(), 'v1-default')
  const result = await useFetch<PublicSitePresentation>('/api/delivery/site-presentation', {
    key: 'site-presentation',
    default: () => fallback
  })
  return {
    ...result,
    presentation: computed(() => result.data.value ?? fallback)
  }
}
