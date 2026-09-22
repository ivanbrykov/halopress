import { z } from 'zod'

import {
  layoutIdSchema,
  type LayoutDocument,
  type ResolvedLayoutProjection
} from './site-layout'

export const SITE_LAYOUT_ASSIGNMENT_VERSION = 1 as const

// Layout assignments persist only stable Layout resource IDs. They never carry
// Nuxt layout names, Vue/component identifiers, import paths, classes, or other
// runtime lookup data. Resolution always reads the resource's current revision.
export const layoutAssignmentSettingSchema = z.object({
  version: z.literal(SITE_LAYOUT_ASSIGNMENT_VERSION),
  layoutId: layoutIdSchema.nullable()
}).strict()

export const layoutAssignmentPatchSchema = z.object({
  layoutId: layoutIdSchema.nullable()
}).strict()

export type LayoutAssignmentSetting = z.output<typeof layoutAssignmentSettingSchema>
export type LayoutAssignmentPatch = z.output<typeof layoutAssignmentPatchSchema>
export type LayoutAssignmentSource = 'page' | 'schema' | 'site'
export type LayoutAssignmentProjection = ResolvedLayoutProjection | {
  status: 'invalid'
  layoutId: string
  reason: string
}

export type LayoutAssignmentCandidate = {
  source: LayoutAssignmentSource
  layoutId: string | null
  projection?: LayoutAssignmentProjection
}

export type ResolvedLayoutAssignment =
  | {
      status: 'ready'
      source: LayoutAssignmentSource
      layoutId: string
      name: string
      revision: number
      document: LayoutDocument
    }
    | {
      status: 'fallback'
      source: 'built-in' | 'disabled'
      reason: 'unassigned' | 'site-disabled' | 'explicit-assignment-unavailable'
      diagnostic?: {
        source: LayoutAssignmentSource
        layoutId: string
        status: 'invalid' | 'missing' | 'retired' | 'repair-required'
        reason: string
      }
    }

export type LayoutAssignmentOption = {
  id: string
  name: string
  revision: number
  status: 'ready' | 'repair-required'
  reason?: string
}

export type LayoutAssignmentOptionsResponse = {
  modeEnabled: boolean
  items: LayoutAssignmentOption[]
}

export function defaultLayoutAssignmentSetting(): LayoutAssignmentSetting {
  return { version: SITE_LAYOUT_ASSIGNMENT_VERSION, layoutId: null }
}

/**
 * Resolve already-loaded candidates in strict precedence order.
 *
 * The first explicit assignment is authoritative even when it is broken. In
 * that case lower-precedence assignments are intentionally ignored and the
 * built-in shell is returned with source-preserving diagnostics.
 */
export function resolveLayoutAssignmentCandidates(
  modeEnabled: boolean,
  candidates: LayoutAssignmentCandidate[]
): ResolvedLayoutAssignment {
  if (!modeEnabled) {
    return { status: 'fallback', source: 'disabled', reason: 'site-disabled' }
  }

  const explicit = candidates.find(candidate => candidate.layoutId !== null)
  if (!explicit) {
    return { status: 'fallback', source: 'built-in', reason: 'unassigned' }
  }

  const projection = explicit.projection
  if (projection?.status === 'ready') {
    return {
      status: 'ready',
      source: explicit.source,
      layoutId: projection.layoutId,
      name: projection.name,
      revision: projection.revision,
      document: projection.document
    }
  }

  return {
    status: 'fallback',
    source: 'built-in',
    reason: 'explicit-assignment-unavailable',
    diagnostic: {
      source: explicit.source,
      layoutId: explicit.layoutId!,
      status: projection?.status ?? 'missing',
      reason: projection?.reason ?? 'Assigned Layout resource is unavailable'
    }
  }
}
