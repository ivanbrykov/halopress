type PublicRouteSeo = {
  title: string
  description: string
  canonicalUrl: string
  imageUrl?: string
  ogType: 'website' | 'article'
  structuredData: Record<string, unknown>
}

export function usePublicRouteSeo(seo: MaybeRef<PublicRouteSeo | null | undefined>) {
  const resolved = computed(() => unref(seo))
  useSeoMeta({
    title: () => resolved.value?.title,
    description: () => resolved.value?.description,
    ogTitle: () => resolved.value?.title,
    ogDescription: () => resolved.value?.description,
    ogUrl: () => resolved.value?.canonicalUrl,
    ogImage: () => resolved.value?.imageUrl,
    ogType: () => resolved.value?.ogType,
    twitterTitle: () => resolved.value?.title,
    twitterDescription: () => resolved.value?.description,
    twitterImage: () => resolved.value?.imageUrl,
    twitterCard: 'summary_large_image'
  })
  useHead(() => ({
    link: resolved.value?.canonicalUrl
      ? [{ rel: 'canonical', href: resolved.value.canonicalUrl }]
      : [],
    script: resolved.value?.structuredData
      ? [{
          key: 'public-route-structured-data',
          type: 'application/ld+json',
          textContent: JSON.stringify(resolved.value.structuredData).replace(/</g, '\\u003c')
        }]
      : []
  }))
}
