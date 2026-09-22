import { describe, expect, it } from 'vitest'

import {
  resolveLayoutAssignmentCandidates,
  type LayoutAssignmentProjection
} from '../shared/layout-assignment'
import { createLayoutDocumentFromPreset } from '../shared/site-layout'

function readyProjection(layoutId: string, name: string, revision = 1): LayoutAssignmentProjection {
  const document = createLayoutDocumentFromPreset('blank', layoutId, name)
  return {
    status: 'ready',
    version: document.version,
    layoutId,
    name,
    revision,
    document
  }
}

describe('Layout assignment resolution contract', () => {
  it('uses Page, exact Schema version, and Site assignments in strict precedence order', () => {
    const page = readyProjection('layout-page', 'Page Layout')
    const schema = readyProjection('layout-schema', 'Schema Layout')
    const site = readyProjection('layout-site', 'Site Layout')

    expect(resolveLayoutAssignmentCandidates(true, [
      { source: 'page', layoutId: page.layoutId, projection: page },
      { source: 'schema', layoutId: schema.layoutId, projection: schema },
      { source: 'site', layoutId: site.layoutId, projection: site }
    ])).toMatchObject({ status: 'ready', source: 'page', layoutId: 'layout-page' })

    expect(resolveLayoutAssignmentCandidates(true, [
      { source: 'page', layoutId: null },
      { source: 'schema', layoutId: schema.layoutId, projection: schema },
      { source: 'site', layoutId: site.layoutId, projection: site }
    ])).toMatchObject({ status: 'ready', source: 'schema', layoutId: 'layout-schema' })

    expect(resolveLayoutAssignmentCandidates(true, [
      { source: 'page', layoutId: null },
      { source: 'schema', layoutId: null },
      { source: 'site', layoutId: site.layoutId, projection: site }
    ])).toMatchObject({ status: 'ready', source: 'site', layoutId: 'layout-site' })
  })

  it('preserves a broken highest-precedence source and never silently inherits lower assignments', () => {
    const schema = readyProjection('layout-schema', 'Schema Layout')
    const site = readyProjection('layout-site', 'Site Layout')

    expect(resolveLayoutAssignmentCandidates(true, [
      {
        source: 'page',
        layoutId: 'layout-missing',
        projection: {
          status: 'missing',
          layoutId: 'layout-missing',
          reason: 'Layout resource is missing'
        }
      },
      { source: 'schema', layoutId: schema.layoutId, projection: schema },
      { source: 'site', layoutId: site.layoutId, projection: site }
    ])).toEqual({
      status: 'fallback',
      source: 'built-in',
      reason: 'explicit-assignment-unavailable',
      diagnostic: {
        source: 'page',
        layoutId: 'layout-missing',
        status: 'missing',
        reason: 'Layout resource is missing'
      }
    })

    expect(resolveLayoutAssignmentCandidates(true, [
      {
        source: 'schema',
        layoutId: 'layout-repair',
        projection: {
          status: 'repair-required',
          layoutId: 'layout-repair',
          reason: 'Stored Layout document failed strict validation'
        }
      },
      { source: 'site', layoutId: site.layoutId, projection: site }
    ])).toMatchObject({
      status: 'fallback',
      source: 'built-in',
      reason: 'explicit-assignment-unavailable',
      diagnostic: { source: 'schema', layoutId: 'layout-repair', status: 'repair-required' }
    })
  })

  it('ignores preserved assignments while Site mode is disabled and otherwise uses the built-in fallback when unassigned', () => {
    const page = readyProjection('layout-page', 'Page Layout', 7)

    expect(resolveLayoutAssignmentCandidates(false, [
      { source: 'page', layoutId: page.layoutId, projection: page }
    ])).toEqual({ status: 'fallback', source: 'disabled', reason: 'site-disabled' })

    expect(resolveLayoutAssignmentCandidates(true, [
      { source: 'page', layoutId: null },
      { source: 'schema', layoutId: null },
      { source: 'site', layoutId: null }
    ])).toEqual({ status: 'fallback', source: 'built-in', reason: 'unassigned' })
  })
})
