import { describe, expect, it } from 'vitest'

import {
  deriveLayoutAssignmentOverviewStatus,
  deriveLayoutResourceOverviewStatus,
  deriveThemeOverviewStatus
} from '../app/utils/site-overview-status'

function themeData(overrides: Record<string, unknown> = {}) {
  return {
    source: 'default' as const,
    configured: false,
    malformedStoredValue: false,
    legacyAppearanceMalformed: false,
    revision: '0123456789abcdef',
    ...overrides
  }
}

function assignmentData(overrides: Record<string, unknown> = {}) {
  return {
    storedLayoutId: null,
    malformedStoredValue: false,
    modeEnabled: true,
    assignment: null,
    ...overrides
  }
}

describe('Site overview derived status', () => {
  it('keeps Theme loading and failure distinct from real default resource state', () => {
    expect(deriveThemeOverviewStatus({ data: null, pending: true, failed: false })).toEqual({
      state: 'loading',
      label: 'Loading',
      detail: 'Checking active Theme',
      color: 'neutral'
    })
    expect(deriveThemeOverviewStatus({ data: null, pending: false, failed: true })).toEqual({
      state: 'unavailable',
      label: 'Unavailable',
      detail: 'Theme status unavailable',
      color: 'error'
    })
    expect(deriveThemeOverviewStatus({ data: themeData(), pending: false, failed: false })).toEqual({
      state: 'default',
      label: 'Built-in default',
      detail: 'Revision 0123456789ab',
      color: 'info'
    })
  })

  it('reports configured, legacy-adapted, and malformed Theme sources deterministically', () => {
    expect(deriveThemeOverviewStatus({
      data: themeData({ source: 'theme', configured: true }),
      pending: false,
      failed: false
    })).toMatchObject({ state: 'configured', label: 'Configured', color: 'success' })
    expect(deriveThemeOverviewStatus({
      data: themeData({ source: 'legacy-appearance' }),
      pending: false,
      failed: false
    })).toMatchObject({ state: 'legacy-adapted', label: 'Legacy adapted', color: 'info' })

    for (const data of [
      themeData({ malformedStoredValue: true }),
      themeData({ legacyAppearanceMalformed: true }),
      themeData({ source: 'theme', configured: false })
    ]) {
      expect(deriveThemeOverviewStatus({ data, pending: false, failed: false })).toEqual({
        state: 'repair',
        label: 'Needs repair',
        detail: data.source === 'theme' && !data.configured
          ? 'Theme source is inconsistent'
          : 'Safe defaults active',
        color: 'warning'
      })
    }
  })

  it('never presents pending or failed Layout resource requests as a zero count', () => {
    expect(deriveLayoutResourceOverviewStatus({ data: null, pending: true, failed: false }))
      .toMatchObject({ state: 'loading', label: 'Loading' })
    expect(deriveLayoutResourceOverviewStatus({ data: null, pending: false, failed: true }))
      .toMatchObject({ state: 'unavailable', label: 'Unavailable' })
    expect(deriveLayoutResourceOverviewStatus({ data: { items: [] }, pending: false, failed: false }))
      .toEqual({ state: 'empty', label: '0 Layouts', color: 'info' })
    expect(deriveLayoutResourceOverviewStatus({
      data: { items: [{ id: 'layout-one', name: 'One', status: 'ready' }] },
      pending: false,
      failed: false
    })).toEqual({ state: 'ready', label: '1 Layout', color: 'success' })
    expect(deriveLayoutResourceOverviewStatus({
      data: {
        items: [
          { id: 'layout-one', name: 'One', status: 'ready' },
          { id: 'layout-two', name: 'Two', status: 'repair-required' }
        ]
      },
      pending: false,
      failed: false
    })).toEqual({ state: 'repair', label: '2 Layouts · 1 repair', color: 'warning' })
  })

  it('distinguishes default Layout loading, failure, malformed, and unassigned states', () => {
    expect(deriveLayoutAssignmentOverviewStatus({ data: null, pending: true, failed: false }, null))
      .toMatchObject({ state: 'loading', label: 'Default: loading' })
    expect(deriveLayoutAssignmentOverviewStatus({ data: null, pending: false, failed: true }, null))
      .toMatchObject({ state: 'unavailable', label: 'Default unavailable' })
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData({ malformedStoredValue: true }),
      pending: false,
      failed: false
    }, null)).toMatchObject({ state: 'malformed', label: 'Default needs repair' })
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData(),
      pending: false,
      failed: false
    }, null)).toEqual({ state: 'unassigned', label: 'Default: unassigned', color: 'neutral' })
  })

  it('shows a resolved default Layout name and preserves its inactive Site-mode state', () => {
    const ready = {
      status: 'ready' as const,
      version: 1 as const,
      layoutId: 'layout-home',
      name: 'Home shell',
      revision: 4,
      document: {}
    }
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData({ storedLayoutId: 'layout-home', assignment: ready }),
      pending: false,
      failed: false
    }, null)).toEqual({ state: 'ready', label: 'Default: Home shell · ready', color: 'success' })
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData({ storedLayoutId: 'layout-home', assignment: ready, modeEnabled: false }),
      pending: false,
      failed: false
    }, null)).toEqual({ state: 'inactive', label: 'Default: Home shell · inactive', color: 'neutral' })
  })

  it.each([
    ['missing', 'Default Layout missing'],
    ['retired', 'Default Layout retired'],
    ['invalid', 'Default Layout invalid']
  ] as const)('reports a %s assigned Layout', (status, label) => {
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData({
        storedLayoutId: 'layout-old',
        assignment: { status, layoutId: 'layout-old', reason: `${status} Layout` }
      }),
      pending: false,
      failed: false
    }, null)).toMatchObject({ state: status, label, color: 'warning' })
  })

  it('resolves the name of a repair-required default from the loaded Layout list', () => {
    expect(deriveLayoutAssignmentOverviewStatus({
      data: assignmentData({
        storedLayoutId: 'layout-broken',
        assignment: { status: 'repair-required', layoutId: 'layout-broken', reason: 'Invalid document' }
      }),
      pending: false,
      failed: false
    }, [{ id: 'layout-broken', name: 'Campaign shell', status: 'repair-required' }])).toEqual({
      state: 'repair',
      label: 'Default: Campaign shell · needs repair',
      color: 'warning'
    })
  })
})
