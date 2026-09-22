import { getQuery } from 'h3'
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import type { FieldKind } from '../cms/types'
import { getDb } from '../db/db'
import {
  contentListing as contentListingTable,
  contentSearchData,
  searchConfig
} from '../db/schema'
import { assertPublishedFieldCompatibility, getPublishedSchemaFields } from '../cms/published-search'
import {
  coerceSearchValue,
  searchDataTypeForKind
} from '../cms/search-helpers'
import { applyLifecyclePublicDeliveryHeaders, applyPrivateDeliveryHeaders, resolveDeliveryPolicy } from '../utils/delivery-policy'
import { badRequest } from '../utils/http'

type FilterInput = {
  field: string
  op?: 'exact' | 'range' | 'exact_set'
  value?: unknown
  values?: unknown
  min?: unknown
  max?: unknown
}

type ContentFieldRow = typeof searchConfig.$inferSelect

function parseFilters(raw: unknown) {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as FilterInput[]
      return [parsed as FilterInput]
    } catch {
      throw badRequest('Invalid filters')
    }
  }
  if (Array.isArray(raw)) return raw as FilterInput[]
  if (typeof raw === 'object') return [raw as FilterInput]
  throw badRequest('Invalid filters')
}

function ensureArray(value: unknown) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    return trimmed.split(',').map(v => v.trim()).filter(Boolean)
  }
  if (value == null) return []
  return [value]
}

function sqlValueList(values: Array<string | number>) {
  return sql.join(values.map(value => sql`${value}`), sql`, `)
}

function searchColumnForDataType(dataType: string) {
  return dataType === 'text' ? sql.raw('csd.text') : sql.raw('csd.value')
}

function searchMatchCondition(args: {
  contentIdColumn: SQLWrapper
  fieldId: string
  dataType: string
  condition: SQL | undefined
  projectionScope: string
}) {
  return sql`exists (
    select 1
    from content_search_data csd
    where csd.content_id = ${args.contentIdColumn}
      and csd.projection_scope = ${args.projectionScope}
      and csd.field_id = ${args.fieldId}
      and csd.data_type = ${args.dataType}
      and ${args.condition}
  )`
}

function searchSortExpression(fieldId: string, dataType: string, projectionScope: string) {
  const column = searchColumnForDataType(dataType)
  return sql`(
    select ${column}
    from content_search_data csd
    where csd.content_id = ${contentListingTable.contentId}
      and csd.projection_scope = ${projectionScope}
      and csd.field_id = ${fieldId}
      and csd.data_type = ${dataType}
    limit 1
  )`
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const schemaKey = typeof q.schemaKey === 'string' ? q.schemaKey : null
  if (!schemaKey) throw badRequest('schemaKey required')
  const policy = await resolveDeliveryPolicy(event, schemaKey, { requestedStatus: q.status })
  const projectionScope = policy.effectiveStatus === 'published' ? 'published' : 'working'
  if (policy.isPublic) applyLifecyclePublicDeliveryHeaders(event)
  else applyPrivateDeliveryHeaders(event)

  const limit = Math.min(Number(q.limit ?? 20) || 20, 50)
  const cursor = q.cursor ? new Date(Number(q.cursor)) : null
  const status = policy.effectiveStatus

  const sortParam = typeof q.sort === 'string' ? q.sort : null
  const sortField = typeof q.sortField === 'string' ? q.sortField : null
  const sortDirParam = typeof q.sortDir === 'string' ? q.sortDir : null
  const requestedFields = ensureArray((q as any).fields)

  let sortKey: string | null = sortField
  let sortDir: 'asc' | 'desc' = sortDirParam === 'desc' ? 'desc' : 'asc'
  if (sortParam && !sortKey) {
    const [field, dir] = sortParam.split(':')
    sortKey = field || null
    if (dir === 'desc') sortDir = 'desc'
  }

  const filters = parseFilters(q.filters)
  const db = await getDb(event)

  const fieldRows = await db
    .select()
    .from(searchConfig)
    .where(eq(searchConfig.schemaKey, schemaKey)) as ContentFieldRow[]

  const fieldByKey = new Map(fieldRows.map(row => [row.fieldKey, row]))
  const fieldConfigs = requestedFields
    .map(fieldKey => fieldByKey.get(String(fieldKey)))
    .filter((field): field is ContentFieldRow => Boolean(field))
  const publishedSchemas = projectionScope === 'published' && (
    filters.length > 0
    || Boolean(sortKey)
    || fieldConfigs.length > 0
  )
    ? await getPublishedSchemaFields(db, schemaKey, status)
    : []
  if (projectionScope === 'published') {
    for (const config of fieldConfigs) {
      assertPublishedFieldCompatibility({ config, publishedSchemas })
    }
  }

  const whereParts = [
    eq(contentListingTable.schemaKey, schemaKey),
    eq(contentListingTable.projectionScope, projectionScope)
  ] as any[]
  if (status) whereParts.push(eq(contentListingTable.status, status))
  if (cursor && !sortKey) whereParts.push(lt(contentListingTable.updatedAt, cursor))

  for (const filter of filters) {
    if (!filter?.field || typeof filter.field !== 'string') throw badRequest('Filter field required')
    const config = fieldByKey.get(filter.field)
    if (!config) throw badRequest(`Unknown field: ${filter.field}`)
    if (!config.filterable) throw badRequest(`Field not filterable: ${filter.field}`)
    if (projectionScope === 'published') {
      assertPublishedFieldCompatibility({ config, publishedSchemas, capability: 'filterable' })
    }

    const kind = config.kind as FieldKind
    const dataType = searchDataTypeForKind(kind as any)
    if (!dataType) throw badRequest(`Unsupported field type: ${filter.field}`)

    const op = filter.op ?? (config.searchMode as 'exact' | 'range' | 'exact_set' | 'off')
    if (!op || op === 'off') throw badRequest(`Search mode disabled: ${filter.field}`)
    if (op === 'range' && dataType === 'text') throw badRequest(`Range not supported: ${filter.field}`)

    if (dataType === 'text') {
      if (op === 'exact') {
        const value = coerceSearchValue({ kind, enumValues: [] } as any, filter.value)
        if (value == null) throw badRequest(`Invalid value: ${filter.field}`)
        whereParts.push(searchMatchCondition({
          contentIdColumn: contentListingTable.contentId,
          fieldId: config.fieldId,
          dataType,
          projectionScope,
          condition: sql`${searchColumnForDataType(dataType)} = ${value as string}`
        }))
      } else if (op === 'exact_set') {
        const values = ensureArray(filter.values ?? filter.value)
          .map(v => coerceSearchValue({ kind, enumValues: [] } as any, v))
          .filter((value): value is string => typeof value === 'string')
        if (!values.length) throw badRequest(`Invalid values: ${filter.field}`)
        whereParts.push(searchMatchCondition({
          contentIdColumn: contentListingTable.contentId,
          fieldId: config.fieldId,
          dataType,
          projectionScope,
          condition: sql`${searchColumnForDataType(dataType)} in (${sqlValueList(values)})`
        }))
      } else {
        throw badRequest(`Unsupported filter: ${filter.field}`)
      }
      continue
    }

    if (op === 'exact') {
      const value = coerceSearchValue({ kind } as any, filter.value)
      if (typeof value !== 'number') throw badRequest(`Invalid value: ${filter.field}`)
      whereParts.push(searchMatchCondition({
        contentIdColumn: contentListingTable.contentId,
        fieldId: config.fieldId,
        dataType,
        projectionScope,
        condition: sql`${searchColumnForDataType(dataType)} = ${value}`
      }))
      continue
    }

    if (op === 'exact_set') {
      const values = ensureArray(filter.values ?? filter.value)
        .map(v => coerceSearchValue({ kind } as any, v))
        .filter((value): value is number => typeof value === 'number')
      if (!values.length) throw badRequest(`Invalid values: ${filter.field}`)
      whereParts.push(searchMatchCondition({
        contentIdColumn: contentListingTable.contentId,
        fieldId: config.fieldId,
        dataType,
        projectionScope,
        condition: sql`${searchColumnForDataType(dataType)} in (${sqlValueList(values)})`
      }))
      continue
    }

    if (op === 'range') {
      const min = filter.min != null ? coerceSearchValue({ kind } as any, filter.min) : null
      const max = filter.max != null ? coerceSearchValue({ kind } as any, filter.max) : null
      if (typeof min !== 'number' && typeof max !== 'number') {
        throw badRequest(`Range requires min or max: ${filter.field}`)
      }
      const rangeParts = [] as any[]
      if (typeof min === 'number') rangeParts.push(gte(sql.raw('csd.value'), min))
      if (typeof max === 'number') rangeParts.push(lte(sql.raw('csd.value'), max))
      whereParts.push(searchMatchCondition({
        contentIdColumn: contentListingTable.contentId,
        fieldId: config.fieldId,
        dataType,
        projectionScope,
        condition: and(...rangeParts)
      }))
      continue
    }

    throw badRequest(`Unsupported filter: ${filter.field}`)
  }

  let query = db
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
    .limit(limit)

  if (sortKey) {
    const config = fieldByKey.get(sortKey)
    if (!config) throw badRequest(`Unknown sort field: ${sortKey}`)
    if (!config.sortable) throw badRequest(`Field not sortable: ${sortKey}`)
    if (projectionScope === 'published') {
      assertPublishedFieldCompatibility({ config, publishedSchemas, capability: 'sortable' })
    }

    const dataType = searchDataTypeForKind(config.kind as FieldKind)
    if (!dataType) throw badRequest(`Unsupported sort field: ${sortKey}`)
    const sortExpr = searchSortExpression(config.fieldId, dataType, projectionScope)
    query = query.orderBy(
      sortDir === 'desc' ? desc(sortExpr) : asc(sortExpr),
      desc(contentListingTable.updatedAt),
      desc(contentListingTable.contentId)
    )
  } else {
    query = query.orderBy(desc(contentListingTable.updatedAt), desc(contentListingTable.contentId))
  }

  const rows = await query
  const nextCursor = !sortKey && rows.length
    ? String(new Date(rows[rows.length - 1]!.updatedAt).getTime())
    : null

  const searchDataByContentId = new Map<string, Record<string, string | number | null>>()
  if (rows.length && fieldConfigs.length) {
    const contentIds = rows.map((row: (typeof rows)[number]) => row.id)
    const fieldIds = fieldConfigs.map(field => field.fieldId)
    const fieldKeyById = new Map(fieldConfigs.map(field => [field.fieldId, field.fieldKey]))
    const searchRows = await db
      .select({
        contentId: contentSearchData.contentId,
        fieldId: contentSearchData.fieldId,
        dataType: contentSearchData.dataType,
        text: contentSearchData.text,
        value: contentSearchData.value
      })
      .from(contentSearchData)
      .where(and(
        inArray(contentSearchData.contentId, contentIds),
        inArray(contentSearchData.fieldId, fieldIds),
        eq(contentSearchData.projectionScope, projectionScope)
      ))

    for (const row of searchRows) {
      const fieldKey = fieldKeyById.get(row.fieldId)
      if (!fieldKey) continue
      const record = searchDataByContentId.get(row.contentId) ?? {}
      record[fieldKey] = row.dataType === 'text' ? row.text : row.value
      searchDataByContentId.set(row.contentId, record)
    }
  }

  const items = rows.map((row: (typeof rows)[number]) => {
    const item = {
      id: row.id,
      schemaKey: row.schemaKey,
      schemaVersion: row.schemaVersion,
      title: row.title,
      description: row.description,
      image: row.image,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }

    if (!fieldConfigs.length) return item

    return {
      ...item,
      searchData: searchDataByContentId.get(row.id) ?? {}
    }
  })

  return { items, nextCursor }
})
