import type {
  LayoutAdminResource,
  LayoutDocument,
  LayoutListResponse,
  LayoutPresetKey
} from '~~/shared/site-layout'

const LAYOUT_RESOURCES_DATA_KEY = 'layout-resources'

function useLayoutResourcesData() {
  return useFetch<LayoutListResponse>('/api/site/layouts', {
    key: LAYOUT_RESOURCES_DATA_KEY,
    dedupe: 'defer'
  })
}

export function useLayoutResourceStatus() {
  const { data, pending, status, error, refresh, execute, clear } = useLayoutResourcesData()
  return { data, pending, status, error, refresh, execute, clear }
}

export function useLayoutResources() {
  const result = useLayoutResourcesData()
  const creating = ref(false)
  const saving = ref(false)
  const renaming = ref(false)
  const duplicating = ref(false)
  const deleting = ref(false)

  function replaceResource(resource: LayoutAdminResource) {
    const response = result.data.value
    if (!response) return
    const exists = response.items.some(item => item.id === resource.id)
    const items = exists
      ? response.items.map(item => item.id === resource.id ? resource : item)
      : [...response.items, resource]
    result.data.value = {
      ...response,
      items: [...items].sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  async function createLayout(input: { name: string, presetKey: LayoutPresetKey }) {
    creating.value = true
    try {
      const resource = await $fetch<LayoutAdminResource>('/api/site/layouts', {
        method: 'POST',
        body: input
      })
      replaceResource(resource)
      return resource
    } finally {
      creating.value = false
    }
  }

  async function loadLayout(layoutId: string) {
    const resource = await $fetch<LayoutAdminResource>(`/api/site/layouts/${encodeURIComponent(layoutId)}`)
    replaceResource(resource)
    return resource
  }

  async function saveLayout(layoutId: string, revision: number, document: LayoutDocument) {
    saving.value = true
    try {
      const resource = await $fetch<LayoutAdminResource>(`/api/site/layouts/${encodeURIComponent(layoutId)}`, {
        method: 'PUT',
        body: { revision, document }
      })
      replaceResource(resource)
      return resource
    } finally {
      saving.value = false
    }
  }

  async function renameLayout(layoutId: string, revision: number, name: string) {
    renaming.value = true
    try {
      const resource = await $fetch<LayoutAdminResource>(`/api/site/layouts/${encodeURIComponent(layoutId)}`, {
        method: 'PATCH',
        body: { revision, name }
      })
      replaceResource(resource)
      return resource
    } finally {
      renaming.value = false
    }
  }

  async function duplicateLayout(layoutId: string, name: string) {
    duplicating.value = true
    try {
      const resource = await $fetch<LayoutAdminResource>(`/api/site/layouts/${encodeURIComponent(layoutId)}/duplicate`, {
        method: 'POST',
        body: { name }
      })
      replaceResource(resource)
      return resource
    } finally {
      duplicating.value = false
    }
  }

  async function deleteLayout(layoutId: string, revision: number) {
    deleting.value = true
    try {
      const response = await $fetch<{ deleted: true, id: string, revision: number }>(`/api/site/layouts/${encodeURIComponent(layoutId)}`, {
        method: 'DELETE',
        query: { revision }
      })
      if (result.data.value) {
        result.data.value = {
          ...result.data.value,
          items: result.data.value.items.filter(item => item.id !== layoutId)
        }
      }
      return response
    } catch (error) {
      const usage = layoutUsageFromFetchError(error)
      const resource = result.data.value?.items.find(item => item.id === layoutId)
      if (usage && resource) replaceResource({ ...resource, usage, canDelete: false })
      throw error
    } finally {
      deleting.value = false
    }
  }

  // Keep this synchronous wrapper plain. Nuxt AsyncData is thenable, and
  // spreading it would leak Promise methods into this mutation contract.
  return {
    data: result.data,
    pending: result.pending,
    status: result.status,
    error: result.error,
    refresh: result.refresh,
    execute: result.execute,
    clear: result.clear,
    creating,
    saving,
    renaming,
    duplicating,
    deleting,
    createLayout,
    loadLayout,
    saveLayout,
    renameLayout,
    duplicateLayout,
    deleteLayout
  }
}
