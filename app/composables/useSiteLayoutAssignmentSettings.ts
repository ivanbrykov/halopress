import type {
  LayoutAssignmentPatch,
  LayoutAssignmentProjection,
  LayoutAssignmentSetting
} from '~~/shared/layout-assignment'

export type LayoutAssignmentAdminResponse = {
  value: LayoutAssignmentSetting
  storedLayoutId: string | null
  configured: boolean
  malformedStoredValue: boolean
  updatedAt: string | null
  updatedBy: string | null
  modeEnabled: boolean
  assignment: LayoutAssignmentProjection | null
}

export const SITE_LAYOUT_ASSIGNMENT_SETTINGS_DATA_KEY = 'site-layout-assignment-settings'

export function useSiteLayoutAssignmentSettings() {
  const {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear
  } = useFetch<LayoutAssignmentAdminResponse>('/api/settings/site-layout', {
    key: SITE_LAYOUT_ASSIGNMENT_SETTINGS_DATA_KEY,
    dedupe: 'defer'
  })
  const saving = ref(false)

  async function saveLayoutAssignment(layoutId: string | null) {
    const body: LayoutAssignmentPatch = { layoutId }
    saving.value = true
    try {
      const response = await $fetch<LayoutAssignmentAdminResponse>('/api/settings/site-layout', {
        method: 'PUT',
        body
      })
      data.value = response
      await refreshNuxtData(LAYOUT_ASSIGNMENT_OPTIONS_DATA_KEY)
      return response
    } finally {
      saving.value = false
    }
  }

  // Editors can render the pending/error state immediately while Nuxt still
  // includes this request in server prefetch. Do not leak raw Promise methods.
  return {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear,
    saving,
    saveLayoutAssignment
  }
}
