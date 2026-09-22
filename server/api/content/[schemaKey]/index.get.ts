import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../../db/db'
import { content as contentTable, contentListing as contentListingTable, contentRef as contentRefTable } from '../../../db/schema'
import { standalonePageRouteIsUnclaimed } from '../../../cms/page-delivery'
import { applyLifecyclePublicDeliveryHeaders, applyPrivateDeliveryHeaders, resolveDeliveryPolicy } from '../../../utils/delivery-policy'
import { PUBLIC_PAGE_ROUTE_PREFIX } from '../../../../shared/public-routing'
import { attachCanonicalPublicPaths } from '../../../cms/public-routes'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const q = getQuery(event)
  const policy = await resolveDeliveryPolicy(event, schemaKey, { requestedStatus: q.status })
  const pageSize = Math.min(Number(q.pageSize ?? q.limit ?? 20) || 20, 50)
  const cursor = typeof q.cursor === 'string' && q.cursor.length ? q.cursor : null
  const order = q.order === 'asc' ? 'asc' : 'desc'
  const status = policy.effectiveStatus
  const projectionScope = policy.isPublic || q.status === 'published' ? 'published' : 'working'
  if (policy.isPublic) applyLifecyclePublicDeliveryHeaders(event)
  else applyPrivateDeliveryHeaders(event)

  const refField = typeof q.refField === 'string' ? q.refField : null
  const refId = typeof q.refId === 'string' ? q.refId : null

  const db = await getDb(event)

  const whereParts = [
    eq(contentTable.schemaKey, schemaKey),
    eq(contentListingTable.projectionScope, projectionScope)
  ] as any[]
  if (schemaKey === PUBLIC_PAGE_ROUTE_PREFIX && q.routeScope === 'public-page') {
    whereParts.push(standalonePageRouteIsUnclaimed(contentTable.id))
  }
  if (status) whereParts.push(eq(contentListingTable.status, status))
  if (cursor) {
    whereParts.push(order === 'asc'
      ? gt(contentTable.id, cursor)
      : lt(contentTable.id, cursor))
  }

  const assetIdSubquery = sql<string | null>`(select ${contentRefTable.targetId} from ${contentRefTable} where ${contentRefTable.contentId} = ${contentTable.id} and ${contentRefTable.projectionScope} = ${projectionScope} and ${contentRefTable.targetKind} = 'asset' limit 1)`

  const base = db
    .select({
      id: contentTable.id,
      schemaKey: contentTable.schemaKey,
      schemaVersion: contentListingTable.schemaVersion,
      title: contentListingTable.title,
      description: contentListingTable.description,
      image: contentListingTable.image,
      status: contentListingTable.status,
      createdAt: contentListingTable.createdAt,
      updatedAt: contentListingTable.updatedAt,
      assetId: assetIdSubquery
    })
    .from(contentTable)
    .innerJoin(contentListingTable, and(
      eq(contentListingTable.contentId, contentTable.id),
      eq(contentListingTable.projectionScope, projectionScope)
    ))

  const fetchSize = pageSize + 1

  let query = base
    .where(and(...whereParts))
    .orderBy(order === 'asc' ? asc(contentTable.id) : desc(contentTable.id))
    .limit(fetchSize)

  if (refField && refId) {
    query = base
      .innerJoin(contentRefTable, and(
        eq(contentRefTable.contentId, contentTable.id),
        eq(contentRefTable.projectionScope, projectionScope),
        eq(contentRefTable.fieldPath, refField),
        eq(contentRefTable.targetId, refId)
      ))
      .where(and(...whereParts))
      .orderBy(order === 'asc' ? asc(contentTable.id) : desc(contentTable.id))
      .limit(fetchSize)
  }

  const rows = await query
  const hasMore = rows.length > pageSize
  const items = await attachCanonicalPublicPaths(db, hasMore ? rows.slice(0, pageSize) : rows)

  const nextCursor = hasMore ? String(items[items.length - 1]!.id) : null
  return { items, nextCursor }
})
