export function usePublicPageDeliveryHeaders() {
  const event = useRequestEvent()
  const cacheControl = useResponseHeader('Cache-Control')
  const vary = useResponseHeader('Vary')
  const robots = useResponseHeader('X-Robots-Tag')

  function applyPublic() {
    cacheControl.value = 'public, max-age=60, stale-while-revalidate=300'
    vary.value = 'Cookie'
    robots.value = undefined
  }

  function applyPrivateNoindex() {
    if (event) event.context.publicDeliveryPrivateNoindex = true
    cacheControl.value = 'private, no-store'
    vary.value = 'Cookie'
    robots.value = 'noindex, nofollow, noarchive'
  }

  return { applyPublic, applyPrivateNoindex }
}
