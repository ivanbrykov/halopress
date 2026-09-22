import type { ComputedRef } from 'vue'
import type { PublicSitePresentation } from '~~/shared/site-presentation'

export function useAuthenticatedPreviewSiteHead(presentation: ComputedRef<PublicSitePresentation>) {
  useHead(() => ({
    titleTemplate: title => title || presentation.value.general.siteName,
    htmlAttrs: { lang: presentation.value.general.locale },
    link: presentation.value.general.faviconUrl === '/favicon.ico'
      ? [
          { key: 'halo-preview-favicon-ico', rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
          { key: 'halo-preview-favicon-png', rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon.png' },
          { key: 'halo-preview-touch-icon', rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }
        ]
      : [
          { key: 'halo-preview-favicon', rel: 'icon', href: presentation.value.general.faviconUrl },
          { key: 'halo-preview-touch-icon', rel: 'apple-touch-icon', href: presentation.value.general.faviconUrl }
        ],
    meta: [
      { key: 'halo-preview-description', name: 'description', content: presentation.value.general.description, tagPriority: 'low' },
      { key: 'halo-preview-og-title', property: 'og:title', content: presentation.value.general.siteName, tagPriority: 'low' },
      { key: 'halo-preview-og-description', property: 'og:description', content: presentation.value.general.description, tagPriority: 'low' },
      { key: 'halo-preview-og-image', property: 'og:image', content: presentation.value.general.socialImageUrl, tagPriority: 'low' },
      { key: 'halo-preview-twitter-card', name: 'twitter:card', content: 'summary_large_image', tagPriority: 'low' }
    ]
  }))
}
