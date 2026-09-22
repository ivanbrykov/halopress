export function useHaloPressBrandHead() {
  useHead({
    link: [
      { rel: 'icon', href: '/favicon.ico', type: 'image/x-icon', sizes: 'any' },
      { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '64x64' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }
    ]
  })
}
