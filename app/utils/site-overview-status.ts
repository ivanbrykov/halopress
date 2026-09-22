import type { LayoutAssignmentProjection } from '~~/shared/layout-assignment'

export type SiteOverviewStatusColor = 'neutral' | 'info' | 'success' | 'warning' | 'error'

type SiteThemeOverviewResource = {
  source: 'theme' | 'legacy-appearance' | 'default'
  configured: boolean
  malformedStoredValue: boolean
  legacyAppearanceMalformed: boolean
  revision: string
}

type LayoutOverviewResource = {
  id: string
  name: string
  status: 'ready' | 'repair-required'
}

type LayoutAssignmentOverviewResource = {
  storedLayoutId: string | null
  malformedStoredValue: boolean
  modeEnabled: boolean
  assignment: LayoutAssignmentProjection | null
}

type ResourceState<T> = {
  data: T | null | undefined
  pending: boolean
  failed: boolean
}

export type SiteOverviewStatus = {
  state: string
  label: string
  color: SiteOverviewStatusColor
}

export type ThemeOverviewStatus = SiteOverviewStatus & {
  detail: string
}

function shortRevision(revision: string) {
  return revision.slice(0, 12) || 'unavailable'
}

export function deriveThemeOverviewStatus(
  { data, pending, failed }: ResourceState<SiteThemeOverviewResource>
): ThemeOverviewStatus {
  if (pending) {
    return { state: 'loading', label: 'Loading', detail: 'Checking active Theme', color: 'neutral' }
  }
  if (failed || !data) {
    return { state: 'unavailable', label: 'Unavailable', detail: 'Theme status unavailable', color: 'error' }
  }
  if (data.malformedStoredValue || data.legacyAppearanceMalformed) {
    return { state: 'repair', label: 'Needs repair', detail: 'Safe defaults active', color: 'warning' }
  }
  if (data.source === 'theme' && data.configured) {
    return {
      state: 'configured',
      label: 'Configured',
      detail: `Revision ${shortRevision(data.revision)}`,
      color: 'success'
    }
  }
  if (data.source === 'legacy-appearance') {
    return {
      state: 'legacy-adapted',
      label: 'Legacy adapted',
      detail: `Revision ${shortRevision(data.revision)}`,
      color: 'info'
    }
  }
  if (data.source === 'default') {
    return {
      state: 'default',
      label: 'Built-in default',
      detail: `Revision ${shortRevision(data.revision)}`,
      color: 'info'
    }
  }
  return { state: 'repair', label: 'Needs repair', detail: 'Theme source is inconsistent', color: 'warning' }
}

export function deriveLayoutResourceOverviewStatus(
  { data, pending, failed }: ResourceState<{ items: LayoutOverviewResource[] }>
): SiteOverviewStatus {
  if (pending) return { state: 'loading', label: 'Loading', color: 'neutral' }
  if (failed || !data) return { state: 'unavailable', label: 'Unavailable', color: 'error' }

  const count = data.items.length
  const repairCount = data.items.filter(item => item.status === 'repair-required').length
  const countLabel = `${count} ${count === 1 ? 'Layout' : 'Layouts'}`
  if (repairCount > 0) {
    return {
      state: 'repair',
      label: `${countLabel} · ${repairCount} repair`,
      color: 'warning'
    }
  }
  return {
    state: count === 0 ? 'empty' : 'ready',
    label: countLabel,
    color: count === 0 ? 'info' : 'success'
  }
}

export function deriveLayoutAssignmentOverviewStatus(
  { data, pending, failed }: ResourceState<LayoutAssignmentOverviewResource>,
  layouts: LayoutOverviewResource[] | null | undefined
): SiteOverviewStatus {
  if (pending) return { state: 'loading', label: 'Default: loading', color: 'neutral' }
  if (failed || !data) return { state: 'unavailable', label: 'Default unavailable', color: 'error' }
  if (data.malformedStoredValue) {
    return { state: 'malformed', label: 'Default needs repair', color: 'warning' }
  }
  if (!data.storedLayoutId) {
    return { state: 'unassigned', label: 'Default: unassigned', color: 'neutral' }
  }

  const assignment = data.assignment
  if (!assignment) return { state: 'unavailable', label: 'Default unavailable', color: 'error' }
  if (assignment.status === 'ready') {
    return data.modeEnabled
      ? { state: 'ready', label: `Default: ${assignment.name} · ready`, color: 'success' }
      : { state: 'inactive', label: `Default: ${assignment.name} · inactive`, color: 'neutral' }
  }
  if (assignment.status === 'repair-required') {
    const name = layouts?.find(layout => layout.id === assignment.layoutId)?.name
    return {
      state: 'repair',
      label: name ? `Default: ${name} · needs repair` : 'Default Layout needs repair',
      color: 'warning'
    }
  }
  if (assignment.status === 'missing') {
    return { state: 'missing', label: 'Default Layout missing', color: 'warning' }
  }
  if (assignment.status === 'retired') {
    return { state: 'retired', label: 'Default Layout retired', color: 'warning' }
  }
  return { state: 'invalid', label: 'Default Layout invalid', color: 'warning' }
}
