import type {
  SiteMenuAdminResource,
  SiteMenuDocument,
  SiteMenuListResponse,
  SiteMenuPreviewResponse,
  SiteMenuSourceOptionsResponse,
  SiteMenuUpdate
} from '~~/shared/site-menu'

const SITE_MENUS_DATA_KEY = 'site-menu-sets'
const SITE_MENU_SOURCE_OPTIONS_DATA_KEY = 'site-menu-source-options'

function useSiteMenusData() {
  return useFetch<SiteMenuListResponse>('/api/site/menus', {
    key: SITE_MENUS_DATA_KEY,
    dedupe: 'defer'
  })
}

export function useSiteMenusStatus() {
  const { data, pending, status, error, refresh, execute, clear } = useSiteMenusData()
  return { data, pending, status, error, refresh, execute, clear }
}

export function useSiteMenuSourceOptions() {
  const { data, pending, status, error, refresh, execute, clear } = useFetch<SiteMenuSourceOptionsResponse>(
    '/api/site/menus/options',
    {
      key: SITE_MENU_SOURCE_OPTIONS_DATA_KEY,
      dedupe: 'defer'
    }
  )
  return { data, pending, status, error, refresh, execute, clear }
}

export async function useSiteMenuSourceOptionsEditor() {
  const { data, pending, status, error, refresh, execute, clear } = await useFetch<SiteMenuSourceOptionsResponse>(
    '/api/site/menus/options',
    {
      key: SITE_MENU_SOURCE_OPTIONS_DATA_KEY,
      dedupe: 'defer'
    }
  )
  return { data, pending, status, error, refresh, execute, clear }
}

type SiteMenusDataState = Pick<Awaited<ReturnType<typeof useSiteMenusData>>,
  'data' | 'pending' | 'status' | 'error' | 'refresh' | 'execute' | 'clear'>

function createSiteMenusEditor(result: SiteMenusDataState) {
  const saving = ref(false)
  const creating = ref(false)
  const deleting = ref(false)
  const previewing = ref(false)

  function replaceResource(resource: SiteMenuAdminResource) {
    const response = result.data.value
    if (!response) return
    const index = response.items.findIndex(item => item.id === resource.id)
    const items = index === -1
      ? [...response.items, resource]
      : response.items.map(item => item.id === resource.id ? resource : item)
    result.data.value = { ...response, items }
  }

  async function createMenu(name: string) {
    creating.value = true
    try {
      const resource = await $fetch<SiteMenuAdminResource>('/api/site/menus', {
        method: 'POST',
        body: { name }
      })
      replaceResource(resource)
      return resource
    } finally {
      creating.value = false
    }
  }

  async function saveMenu(menuId: string, update: SiteMenuUpdate) {
    saving.value = true
    try {
      const resource = await $fetch<SiteMenuAdminResource>(`/api/site/menus/${encodeURIComponent(menuId)}`, {
        method: 'PUT',
        body: update
      })
      replaceResource(resource)
      await refreshNuxtData('site-presentation')
      return resource
    } finally {
      saving.value = false
    }
  }

  async function deleteMenu(menuId: string) {
    deleting.value = true
    try {
      await $fetch(`/api/site/menus/${encodeURIComponent(menuId)}`, { method: 'DELETE' })
      if (result.data.value) {
        result.data.value = {
          ...result.data.value,
          items: result.data.value.items.filter(item => item.id !== menuId)
        }
      }
    } catch (error) {
      const usage = siteMenuUsageFromFetchError(error)
      const resource = result.data.value?.items.find(item => item.id === menuId)
      if (usage && resource) {
        replaceResource({ ...resource, usage, canDelete: false })
      }
      throw error
    } finally {
      deleting.value = false
    }
  }

  async function previewMenu(menuId: string, document: SiteMenuDocument, examplePageId?: string) {
    previewing.value = true
    try {
      return await $fetch<SiteMenuPreviewResponse>(
        `/api/site/menus/${encodeURIComponent(menuId)}/preview`,
        {
          method: 'POST',
          body: {
            document,
            examplePageId: examplePageId || undefined
          }
        }
      )
    } finally {
      previewing.value = false
    }
  }

  // Keep this synchronous wrapper a plain object. Nuxt AsyncData exposes
  // Promise methods that a raw spread can leak and an accidental await can assimilate.
  return {
    data: result.data,
    pending: result.pending,
    status: result.status,
    error: result.error,
    refresh: result.refresh,
    execute: result.execute,
    clear: result.clear,
    saving,
    creating,
    deleting,
    previewing,
    createMenu,
    saveMenu,
    deleteMenu,
    previewMenu
  }
}

export function useSiteMenus() {
  return createSiteMenusEditor(useSiteMenusData())
}

export async function useSiteMenusEditor() {
  // Mutable Menu forms intentionally wait for the persisted payload so SSR
  // and hydration start from the same document instead of a loading shell.
  return createSiteMenusEditor(await useSiteMenusData())
}
