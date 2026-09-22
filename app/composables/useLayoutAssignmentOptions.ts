import type {
  LayoutAssignmentOption,
  LayoutAssignmentOptionsResponse
} from '~~/shared/layout-assignment'

export const LAYOUT_ASSIGNMENT_OPTIONS_DATA_KEY = 'layout-assignment-options'

export function useLayoutAssignmentOptions() {
  const {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear
  } = useFetch<LayoutAssignmentOptionsResponse>('/api/site/layout-assignments/options', {
    key: LAYOUT_ASSIGNMENT_OPTIONS_DATA_KEY,
    dedupe: 'defer'
  })

  const modeEnabled = computed(() => data.value?.modeEnabled === true)
  const readyItems = computed<LayoutAssignmentOption[]>(() => (
    data.value?.items.filter(item => item.status === 'ready') ?? []
  ))

  // Keep this wrapper synchronous and expose only the reactive AsyncData surface.
  // Nuxt's raw useFetch return is thenable and must not be spread from a plain wrapper.
  return {
    data,
    pending,
    status,
    error,
    refresh,
    execute,
    clear,
    modeEnabled,
    readyItems
  }
}
