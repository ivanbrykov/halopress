export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/_install') return

  const { data, error } = await useFetch('/api/system/install/status')
  if (error.value) return
  if (!data.value?.ready) {
    return await navigateTo('/_install')
  }
})
