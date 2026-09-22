import { and, asc, desc, eq } from 'drizzle-orm'
import { getQuery, setHeader } from 'h3'

import { getDb } from '../../db/db'
import { contentListing as contentListingTable } from '../../db/schema'
import { applyPrivateDeliveryHeaders, resolveDeliveryPolicy } from '../../utils/delivery-policy'
import { badRequest } from '../../utils/http'
import { applyWidgetCacheHeaders, resolveWidgetCacheKey, withWidgetCache } from '../../utils/widget-cache'
import { attachCanonicalPublicPaths } from '../../cms/public-routes'

const POLICY = {
  softTtl: 60,
  hardTtl: 300,
  staleIfError: 86400
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const schemaKey = typeof q.schema === 'string'
    ? q.schema
    : (typeof q.schemaKey === 'string' ? q.schemaKey : null)

  if (!schemaKey) throw badRequest('schema required')
  const policy = await resolveDeliveryPolicy(event, schemaKey, {
    requestedStatus: q.status,
    defaultStatus: 'published'
  })

  const limit = Math.min(Number(q.limit ?? 6) || 6, 50)
  const status = policy.effectiveStatus
  const projectionScope = status === 'published' ? 'published' : 'working'
  const sortRaw = typeof q.sort === 'string' && q.sort.length ? q.sort : '-created'
  const sortDesc = sortRaw.startsWith('-')
  const sortKey = sortDesc ? sortRaw.slice(1) : sortRaw
  const sortField = sortKey === 'updated' || sortKey === 'updatedAt' ? 'updatedAt' : 'createdAt'
  const sortNormalized = `${sortDesc ? '-' : ''}${sortField === 'createdAt' ? 'created' : 'updated'}`

  const loadItems = async () => {
    const db = await getDb(event)
    const whereParts = [
      eq(contentListingTable.schemaKey, schemaKey),
      eq(contentListingTable.projectionScope, projectionScope)
    ] as any[]
    if (status) whereParts.push(eq(contentListingTable.status, status))

    const orderField = sortField === 'updatedAt' ? contentListingTable.updatedAt : contentListingTable.createdAt
    const orderTie = sortDesc ? desc(contentListingTable.contentId) : asc(contentListingTable.contentId)
    const orderPrimary = sortDesc ? desc(orderField) : asc(orderField)

    return db
      .select({
        id: contentListingTable.contentId,
        schemaKey: contentListingTable.schemaKey,
        schemaVersion: contentListingTable.schemaVersion,
        title: contentListingTable.title,
        description: contentListingTable.description,
        image: contentListingTable.image,
        status: contentListingTable.status,
        createdAt: contentListingTable.createdAt,
        updatedAt: contentListingTable.updatedAt
      })
      .from(contentListingTable)
      .where(and(...whereParts))
      .orderBy(orderPrimary, orderTie)
      .limit(limit)
  }

  let data: Awaited<ReturnType<typeof loadItems>>
  let cacheStatus: string
  let backend: string

  if (policy.canUsePublicCache) {
    const params = { schemaKey, limit, status, sort: sortNormalized, projectionScope, visibility: policy.cacheVisibility }
    const cacheKey = await resolveWidgetCacheKey(event, 'recent', 'v1', params, `schema:${schemaKey}`)

    applyWidgetCacheHeaders(event, POLICY, ['widget', 'recent', schemaKey])
    const cached = await withWidgetCache(event, cacheKey, POLICY, loadItems)
    data = cached.data
    cacheStatus = cached.status
    backend = cached.backend
  } else {
    applyPrivateDeliveryHeaders(event)
    data = await loadItems()
    cacheStatus = 'bypass'
    backend = 'none'
  }

  setHeader(event, 'X-Widget-Cache', cacheStatus)
  setHeader(event, 'X-Widget-Cache-Backend', backend)
  data = await attachCanonicalPublicPaths(await getDb(event), data)

  return {
    widget: 'recent',
    schemaKey,
    items: data
  }
})
