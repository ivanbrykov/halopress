import type { H3Event } from 'h3'
import { setHeader } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from '../db/db'
import { content as contentTable, schemaActive as schemaActiveTable } from '../db/schema'
import { notFound } from './http'
import { getSchemaPermission, hasSchemaPermission, type SchemaPermission } from './schema-permission'

export type DeliveryStatus = string | null

export type DeliveryPolicy = {
  permission: SchemaPermission
  isPublic: boolean
  effectiveStatus: DeliveryStatus
  cacheVisibility: string
  canUsePublicCache: boolean
}

type DeliveryStatusInput = {
  roleKey: string
  requestedStatus?: unknown
  defaultStatus?: DeliveryStatus
}

type DeliveryPolicyOptions = {
  requestedStatus?: unknown
  defaultStatus?: DeliveryStatus
  notFoundMessage?: string
}

/**
 * Anonymous delivery is always published-only. Any authenticated role with
 * effective schema read permission keeps its existing Desk status access,
 * including unrestricted reads when status is omitted or set to `all`.
 */
export function normalizeDeliveryStatus({
  roleKey,
  requestedStatus,
  defaultStatus = null
}: DeliveryStatusInput): DeliveryStatus {
  if (roleKey === 'anonymous') return 'published'

  const requested = typeof requestedStatus === 'string' && requestedStatus.trim().length
    ? requestedStatus.trim()
    : defaultStatus

  return requested === 'all' ? null : requested
}

export async function resolveDeliveryPolicy(
  event: H3Event,
  schemaKey: string,
  options: DeliveryPolicyOptions = {}
): Promise<DeliveryPolicy> {
  const db = await getDb(event)
  const lifecycle = await db
    .select({ status: schemaActiveTable.status })
    .from(schemaActiveTable)
    .where(eq(schemaActiveTable.schemaKey, schemaKey))
    .get()
  if (lifecycle?.status !== 'active') {
    throw notFound(options.notFoundMessage ?? 'Schema not found')
  }

  const permission = await getSchemaPermission(event, schemaKey)
  if (!hasSchemaPermission(permission, 'read')) {
    throw notFound(options.notFoundMessage ?? 'Schema not found')
  }

  const isPublic = permission.roleKey === 'anonymous'
  const effectiveStatus = normalizeDeliveryStatus({
    roleKey: permission.roleKey,
    requestedStatus: options.requestedStatus,
    defaultStatus: options.defaultStatus
  })

  return {
    permission,
    isPublic,
    effectiveStatus,
    cacheVisibility: isPublic ? 'public:published' : `authenticated:${permission.roleKey}`,
    canUsePublicCache: isPublic
  }
}

export async function requireContentOwnerDelivery(event: H3Event, ownerId: string) {
  const db = await getDb(event)
  const owner = await db
    .select({
      schemaKey: contentTable.schemaKey,
      status: contentTable.status,
      publishedRevisionId: contentTable.publishedRevisionId,
      updatedAt: contentTable.updatedAt
    })
    .from(contentTable)
    .where(eq(contentTable.id, ownerId))
    .get()

  if (!owner) {
    throw notFound('Content not found')
  }

  const policy = await resolveDeliveryPolicy(event, owner.schemaKey, {
    defaultStatus: owner.status,
    notFoundMessage: 'Content not found'
  })
  if (policy.isPublic && (!owner.publishedRevisionId || owner.status === 'deleted')) {
    throw notFound('Content not found')
  }

  return owner
}

export function applyPrivateDeliveryHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
}

export function applyPreviewDeliveryHeaders(event: H3Event) {
  applyPrivateDeliveryHeaders(event)
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive')
}

export function applyPublicDeliveryHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  setHeader(event, 'Vary', 'Cookie')
}

export function applyLifecyclePublicDeliveryHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'public, max-age=0, must-revalidate')
  setHeader(event, 'Vary', 'Cookie')
}
