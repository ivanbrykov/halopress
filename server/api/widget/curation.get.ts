import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { getQuery, setHeader } from 'h3'

import { getDb } from '../../db/db'
import { contentListing as contentListingTable, contentRefList, contentSearchData, searchConfig } from '../../db/schema'
import { assertPublishedFieldCompatibility, getPublishedSchemaFields, type PublishedSearchField } from '../../cms/published-search'
import { coerceSearchValue, searchDataTypeForKind } from '../../cms/search-helpers'
import { applyPrivateDeliveryHeaders, requireContentOwnerDelivery, resolveDeliveryPolicy } from '../../utils/delivery-policy'
import { badRequest } from '../../utils/http'
import { applyWidgetCacheHeaders, resolveWidgetCacheKey, withWidgetCache } from '../../utils/widget-cache'
import { attachCanonicalPublicPaths } from '../../cms/public-routes'

type ContentItem = {
  id: string
  schemaKey: string
  schemaVersion: number
  title: string | null
  description: string | null
  image: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}

const POLICY = {
  softTtl: 300,
  hardTtl: 7200,
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

  const fieldKey = typeof q.field === 'string' ? q.field : null
  if (!fieldKey) throw badRequest('field required')

  const ownerId = typeof q.ownerId === 'string'
    ? q.ownerId
    : (typeof q.curationId === 'string' ? q.curationId : null)

  const rawValues = q.values
  const values = Array.isArray(rawValues)
    ? rawValues.map(v => String(v)).filter(Boolean)
    : typeof rawValues === 'string'
      ? rawValues.split(',').map(v => v.trim()).filter(Boolean)
      : []

  const limit = Math.min(Number(q.limit ?? 6) || 6, 50)
  const status = policy.effectiveStatus
  const projectionScope = status === 'published' ? 'published' : 'working'
  const owner = ownerId ? await requireContentOwnerDelivery(event, ownerId) : null
  const db = await getDb(event)

  let field: PublishedSearchField | undefined
  if (!ownerId) {
    if (!values.length) throw badRequest('values required')
    field = await db
      .select({
        fieldId: searchConfig.fieldId,
        fieldKey: searchConfig.fieldKey,
        kind: searchConfig.kind
      })
      .from(searchConfig)
      .where(and(
        eq(searchConfig.schemaKey, schemaKey),
        eq(searchConfig.fieldKey, fieldKey)
      ))
      .get()

    if (field && projectionScope === 'published') {
      const publishedSchemas = await getPublishedSchemaFields(db, schemaKey, status)
      assertPublishedFieldCompatibility({ config: field, publishedSchemas })
    }
  }

  const loadItems = async () => {
    if (ownerId) {
      const listRows = await db
        .select({
          itemId: contentRefList.itemId,
          position: contentRefList.position
        })
        .from(contentRefList)
        .where(and(
          eq(contentRefList.ownerContentId, ownerId),
          eq(contentRefList.projectionScope, projectionScope),
          eq(contentRefList.fieldKey, fieldKey),
          eq(contentRefList.itemKind, 'content')
        ))
        .orderBy(asc(contentRefList.position))
        .limit(limit) as Array<{ itemId: string | null; position: number | null }>

      const orderedIds = listRows
        .map(row => row.itemId)
        .filter((id): id is string => Boolean(id))
      if (!orderedIds.length) return []

      const whereParts = [
        eq(contentListingTable.schemaKey, schemaKey),
        eq(contentListingTable.projectionScope, projectionScope),
        inArray(contentListingTable.contentId, orderedIds)
      ] as any[]
      if (status) whereParts.push(eq(contentListingTable.status, status))

      const items = await db
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
        .where(and(...whereParts)) as ContentItem[]

      const byId = new Map(items.map(item => [item.id, item]))
      return orderedIds
        .map(id => byId.get(id))
        .filter((item): item is ContentItem => Boolean(item))
    }

    if (!field) return []

    const dataType = searchDataTypeForKind(field.kind as any)
    if (!dataType) return []

    const coercedValues = values
      .map(value => coerceSearchValue({ kind: field.kind as any, enumValues: [] } as any, value))
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    if (!coercedValues.length) return []

    const whereParts = [
      eq(contentListingTable.schemaKey, schemaKey),
      eq(contentListingTable.projectionScope, projectionScope),
      eq(contentSearchData.projectionScope, projectionScope),
      eq(contentSearchData.fieldId, field.fieldId),
      eq(contentSearchData.dataType, dataType),
      eq(contentSearchData.contentId, contentListingTable.contentId),
      dataType === 'text'
        ? inArray(contentSearchData.text, coercedValues as string[])
        : inArray(contentSearchData.value, coercedValues as number[])
    ] as any[]
    if (status) whereParts.push(eq(contentListingTable.status, status))

    const items = await db
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
      .innerJoin(contentSearchData, eq(contentSearchData.contentId, contentListingTable.contentId))
      .where(and(...whereParts))
      .orderBy(desc(contentListingTable.updatedAt), desc(contentListingTable.contentId))
      .limit(limit) as ContentItem[]

    return items
  }

  let data: Awaited<ReturnType<typeof loadItems>>
  let cacheStatus: string
  let backend: string

  if (policy.canUsePublicCache) {
    const params = {
      schemaKey,
      fieldKey,
      values,
      ownerId,
      ownerUpdatedAt: owner?.updatedAt?.getTime(),
      projectionScope,
      limit,
      status,
      visibility: policy.cacheVisibility
    }
    const cacheKey = await resolveWidgetCacheKey(event, 'curation', 'v2', params, `schema:${schemaKey}`)

    applyWidgetCacheHeaders(event, POLICY, ['widget', 'curation', schemaKey, fieldKey])
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
    widget: 'curation',
    schemaKey,
    fieldKey,
    ownerId,
    values,
    items: data
  }
})
