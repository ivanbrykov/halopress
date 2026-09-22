import type { H3Event } from 'h3'
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { publicParentPath } from '../../shared/public-routing'
import {
  isSiteMenuDynamicItem,
  SITE_MENU_MAX_SOURCE_RESULTS,
  type SiteMenuDocument,
  type SiteMenuDynamicItem,
  type SiteMenuSchemaFilter,
  type SiteMenuSource,
  type SiteMenuSourceDiagnostic,
  type SiteMenuSourceOptionsResponse,
  type SiteMenuValidationIssue
} from '../../shared/site-menu'
import {
  assertPublishedFieldCompatibility,
  loadPublishedSchemaFieldsByKey,
  type PublishedSchemaFields,
  type PublishedSearchField
} from '../cms/published-search'
import { PUBLIC_ROUTE_D1_IN_CHUNK_SIZE } from '../cms/public-routes'
import { coerceSearchValue, searchDataTypeForKind } from '../cms/search-helpers'
import type { SchemaRegistry } from '../cms/types'
import type { Db } from '../db/db'
import { getDb } from '../db/db'
import {
  content as contentTable,
  contentListing as contentListingTable,
  contentSearchData,
  page as pageTable,
  publicationRevision as publicationRevisionTable,
  publicRoute as publicRouteTable,
  schema as schemaTable,
  schemaActive as schemaActiveTable,
  schemaRole as schemaRoleTable,
  searchConfig as searchConfigTable
} from '../db/schema'
import { hasDistributedWidgetCache, resolveWidgetCacheKey, withWidgetCache } from './widget-cache'

const SOURCE_CACHE_POLICY = { softTtl: 30, hardTtl: 120 }
export const SITE_MENU_SOURCE_TIMEOUT_MS = 1500
export const SITE_MENU_SOURCE_CONCURRENCY = 2
// Public-route authorization can issue two concurrent clamp queries. Keeping
// source work at four means the complete Layout render never exceeds six D1
// operations, including a final canonical lookup after a timed-out refresh.
export const SITE_MENU_SOURCE_D1_CONCURRENCY = 4
export const SITE_MENU_RENDER_BUDGET_MS = 3000
export const SITE_MENU_PAGE_CACHE_SCOPE = 'public-routes:page'

type SearchConfigRow = typeof searchConfigTable.$inferSelect

export type SiteMenuSourceCandidate = {
  sourceId: string
  documentKind: 'content' | 'page'
  documentId: string
  schemaKey?: string
  label: string
  icon?: SiteMenuSource['icon']
  badge?: SiteMenuSource['badge']
}

type DynamicSourceEntry = {
  item: SiteMenuDynamicItem
  path: Array<string | number>
}

export type PreparedSchemaSource = {
  registry: SchemaRegistry
  fieldById: Map<string, SchemaRegistry['fields'][number]>
  configById: Map<string, SearchConfigRow>
  publishedSchemas: PublishedSchemaFields
  issues: Array<{ path: Array<string | number>, message: string }>
  loadError?: Error
}

export type SiteMenuD1Gate = {
  run: <T>(query: () => Promise<T>, signal?: AbortSignal) => Promise<T>
}

type SiteMenuD1Waiter = {
  signal?: AbortSignal
  resolve: () => void
  reject: (error: unknown) => void
  removeAbortListener: () => void
}

class InvalidSiteMenuSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSiteMenuSourceError'
  }
}

class SiteMenuSourceTimeoutError extends Error {
  constructor() {
    super('Dynamic source exceeded its execution budget')
    this.name = 'SiteMenuSourceTimeoutError'
  }
}

export function createSiteMenuD1Gate(concurrency = SITE_MENU_SOURCE_D1_CONCURRENCY): SiteMenuD1Gate {
  const limit = Math.max(1, Math.min(SITE_MENU_SOURCE_D1_CONCURRENCY, Math.floor(concurrency)))
  let active = 0
  const waiting: SiteMenuD1Waiter[] = []
  const abortReason = (signal: AbortSignal) => (
    signal.reason instanceof Error ? signal.reason : new Error('Dynamic source query was aborted')
  )
  const acquire = async (signal?: AbortSignal) => {
    if (signal?.aborted) throw abortReason(signal)
    if (active < limit) {
      active++
      return
    }
    await new Promise<void>((resolve, reject) => {
      const handleAbort = () => {
        const index = waiting.indexOf(waiter)
        if (index === -1) return
        waiting.splice(index, 1)
        waiter.removeAbortListener()
        waiter.reject(abortReason(signal!))
      }
      const waiter: SiteMenuD1Waiter = {
        signal,
        resolve: () => {
          waiter.removeAbortListener()
          resolve()
        },
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', handleAbort)
      }
      waiting.push(waiter)
      signal?.addEventListener('abort', handleAbort, { once: true })
    })
  }
  const release = () => {
    const next = waiting.shift()
    if (next) {
      // Transfer the occupied slot directly. Decrementing before the queued
      // waiter resumes would briefly advertise capacity that does not exist.
      next.resolve()
      return
    }
    active--
  }
  return {
    run: async <T>(query: () => Promise<T>, signal?: AbortSignal) => {
      await acquire(signal)
      try {
        if (signal?.aborted) throw abortReason(signal)
        return await query()
      } finally {
        release()
      }
    }
  }
}

function dynamicSourceEntries(document: SiteMenuDocument): DynamicSourceEntry[] {
  const entries: DynamicSourceEntry[] = []
  for (const [itemIndex, item] of document.items.entries()) {
    if (isSiteMenuDynamicItem(item)) {
      entries.push({ item, path: ['document', 'items', itemIndex] })
      continue
    }
    for (const [childIndex, child] of item.children.entries()) {
      if (isSiteMenuDynamicItem(child)) {
        entries.push({ item: child, path: ['document', 'items', itemIndex, 'children', childIndex] })
      }
    }
  }
  return entries
}

function parseRegistry(value: string | null): SchemaRegistry | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as SchemaRegistry
    return Array.isArray(parsed?.fields) ? parsed : null
  } catch {
    return null
  }
}

function schemaKeysForDocuments(documents: SiteMenuDocument[]) {
  return [...new Set(documents.flatMap(document => dynamicSourceEntries(document).flatMap(entry => (
    entry.item.source.type === 'schemaQuery' ? [entry.item.source.schemaKey] : []
  ))))]
}

function unavailablePreparedSchema(schemaKey: string, loadError: Error): PreparedSchemaSource {
  return {
    registry: { schemaKey, version: 0, title: schemaKey, fields: [], relations: [] },
    fieldById: new Map(),
    configById: new Map(),
    publishedSchemas: [],
    issues: [],
    loadError
  }
}

export async function prepareSiteMenuDynamicSourceMetadata(args: {
  db: Db
  documents: SiteMenuDocument[]
  d1Gate?: SiteMenuD1Gate
}) {
  const schemaKeys = schemaKeysForDocuments(args.documents)
  const preparedByKey = new Map<string, PreparedSchemaSource>()
  if (!schemaKeys.length) return preparedByKey
  const d1Gate = args.d1Gate ?? createSiteMenuD1Gate()

  try {
    const activeRows: Array<{
      schemaKey: string
      status: string
      registryJson: string | null
      canRead: boolean | null
    }> = []
    const configRows: SearchConfigRow[] = []
    const [published] = await Promise.all([
      loadPublishedSchemaFieldsByKey(args.db, schemaKeys, 'published', d1Gate.run),
      (async () => {
        for (let offset = 0; offset < schemaKeys.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
          const chunk = schemaKeys.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
          if (!chunk.length) continue
          activeRows.push(...await d1Gate.run(async () => await args.db.select({
            schemaKey: schemaActiveTable.schemaKey,
            status: schemaActiveTable.status,
            registryJson: schemaTable.registryJson,
            canRead: schemaRoleTable.canRead
          }).from(schemaActiveTable).innerJoin(schemaTable, and(
            eq(schemaTable.schemaKey, schemaActiveTable.schemaKey),
            eq(schemaTable.version, schemaActiveTable.activeVersion)
          )).leftJoin(schemaRoleTable, and(
            eq(schemaRoleTable.schemaKey, schemaActiveTable.schemaKey),
            eq(schemaRoleTable.roleKey, 'anonymous')
          )).where(inArray(schemaActiveTable.schemaKey, chunk))))
        }
      })(),
      (async () => {
        for (let offset = 0; offset < schemaKeys.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
          const chunk = schemaKeys.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
          if (!chunk.length) continue
          configRows.push(...await d1Gate.run(async () => await args.db.select().from(searchConfigTable)
            .where(inArray(searchConfigTable.schemaKey, chunk)) as SearchConfigRow[]))
        }
      })()
    ])

    const activeByKey = new Map(activeRows.map(row => [row.schemaKey, row]))
    const configsByKey = new Map<string, SearchConfigRow[]>()
    for (const config of configRows) {
      const configs = configsByKey.get(config.schemaKey) ?? []
      configs.push(config)
      configsByKey.set(config.schemaKey, configs)
    }

    for (const schemaKey of schemaKeys) {
      const active = activeByKey.get(schemaKey)
      const registry = parseRegistry(active?.registryJson ?? null)
      const issues: PreparedSchemaSource['issues'] = []
      if (!active || active.status !== 'active' || !registry) {
        issues.push({ path: ['schemaKey'], message: 'Select an active published Schema' })
      }
      if (!active?.canRead) {
        issues.push({ path: ['schemaKey'], message: 'The Schema must allow anonymous reads' })
      }
      const publishedError = published.errorsBySchemaKey.get(schemaKey)
      if (publishedError) {
        issues.push({ path: ['schemaKey'], message: publishedError.message })
      }
      const configs = configsByKey.get(schemaKey) ?? []
      preparedByKey.set(schemaKey, {
        registry: registry ?? { schemaKey, version: 0, title: schemaKey, fields: [], relations: [] },
        fieldById: new Map((registry?.fields ?? []).map(field => [field.fieldId, field])),
        configById: new Map(configs.map(config => [config.fieldId, config])),
        publishedSchemas: published.fieldsBySchemaKey.get(schemaKey) ?? [],
        issues
      })
    }
  } catch (error) {
    const loadError = error instanceof Error ? error : new Error('Dynamic Menu source metadata is unavailable')
    for (const schemaKey of schemaKeys) preparedByKey.set(schemaKey, unavailablePreparedSchema(schemaKey, loadError))
  }

  return preparedByKey
}

function fieldConfigIssue(args: {
  prepared: PreparedSchemaSource
  fieldId: string
  path: Array<string | number>
  capability: 'filterable' | 'sortable' | 'label'
}) {
  const field = args.prepared.fieldById.get(args.fieldId)
  const config = args.prepared.configById.get(args.fieldId)
  if (!field || !config || field.key !== config.fieldKey || field.kind !== config.kind) {
    return { path: args.path, message: 'Select a field from the exact active Schema configuration' }
  }
  const dataType = searchDataTypeForKind(field.kind)
  if (!dataType || field.kind === 'richtext') {
    return { path: args.path, message: 'Select a supported scalar field' }
  }
  if (args.capability === 'filterable' && !config.filterable) {
    return { path: args.path, message: 'Select a configured filterable field' }
  }
  if (args.capability === 'sortable' && !config.sortable) {
    return { path: args.path, message: 'Select a configured sortable field' }
  }
  if (args.capability === 'label' && config.searchMode === 'off' && !config.filterable && !config.sortable) {
    return { path: args.path, message: 'Select a scalar field available in the published search projection' }
  }
  try {
    assertPublishedFieldCompatibility({
      config: config as PublishedSearchField,
      publishedSchemas: args.prepared.publishedSchemas,
      capability: args.capability === 'label' ? undefined : args.capability
    })
  } catch (error) {
    return {
      path: args.path,
      message: error instanceof Error ? error.message : 'Field is incompatible with published Schema versions'
    }
  }
  return null
}

function coerceFilterValues(
  filter: SiteMenuSchemaFilter,
  field: SchemaRegistry['fields'][number]
): Array<string | number> | null {
  const values = filter.operator === 'exact' ? [filter.value] : filter.values
  const coerced = values.map(value => coerceSearchValue(field, value))
  if (coerced.some(value => typeof value !== 'string' && typeof value !== 'number')) return null
  return coerced as Array<string | number>
}

function validateSchemaSource(
  source: Extract<SiteMenuSource, { type: 'schemaQuery' }>,
  prepared: PreparedSchemaSource
) {
  if (prepared.loadError) throw prepared.loadError
  const issues = [...prepared.issues]
  const filteredFieldIds = new Set<string>()

  for (const [index, filter] of source.filters.entries()) {
    if (filteredFieldIds.has(filter.fieldId)) {
      issues.push({ path: ['filters', index, 'fieldId'], message: 'Use each filter field at most once' })
      continue
    }
    filteredFieldIds.add(filter.fieldId)
    const configIssue = fieldConfigIssue({
      prepared,
      fieldId: filter.fieldId,
      path: ['filters', index, 'fieldId'],
      capability: 'filterable'
    })
    if (configIssue) {
      issues.push(configIssue)
      continue
    }
    const config = prepared.configById.get(filter.fieldId)!
    if (filter.operator === 'exactSet' && config.searchMode !== 'exact_set') {
      issues.push({ path: ['filters', index, 'operator'], message: 'Exact-set requires an exact-set configured field' })
    }
    if (filter.operator === 'exact' && config.searchMode !== 'exact' && config.searchMode !== 'exact_set') {
      issues.push({ path: ['filters', index, 'operator'], message: 'Exact requires an exact or exact-set configured field' })
    }
    const field = prepared.fieldById.get(filter.fieldId)!
    const values = coerceFilterValues(filter, field)
    if (!values) {
      issues.push({ path: ['filters', index], message: 'Filter values do not match the selected field kind' })
    } else if (filter.operator === 'exactSet' && new Set(values.map(value => `${typeof value}:${value}`)).size !== values.length) {
      issues.push({ path: ['filters', index, 'values'], message: 'Exact-set values must be unique' })
    }
  }

  if (source.sort.type === 'field') {
    const issue = fieldConfigIssue({
      prepared,
      fieldId: source.sort.fieldId,
      path: ['sort', 'fieldId'],
      capability: 'sortable'
    })
    if (issue) issues.push(issue)
  }

  if (source.label.type === 'field') {
    const issue = fieldConfigIssue({
      prepared,
      fieldId: source.label.fieldId,
      path: ['label', 'fieldId'],
      capability: 'label'
    })
    if (issue) issues.push(issue)
  }

  return { prepared, issues }
}

export async function validateSiteMenuDynamicSources(
  db: Db,
  document: SiteMenuDocument
): Promise<SiteMenuValidationIssue[]> {
  const issues: SiteMenuValidationIssue[] = []
  const preparedByKey = await prepareSiteMenuDynamicSourceMetadata({ db, documents: [document] })
  for (const entry of dynamicSourceEntries(document)) {
    if (entry.item.source.type !== 'schemaQuery') continue
    const prepared = preparedByKey.get(entry.item.source.schemaKey)
    if (!prepared) continue
    const result = validateSchemaSource(entry.item.source, prepared)
    for (const issue of result.issues) {
      issues.push({
        path: [...entry.path, 'source', ...issue.path].join('.'),
        message: issue.message
      })
    }
  }
  return issues
}

function searchColumnForDataType(dataType: string) {
  return dataType === 'text' ? sql.raw('dynamic_menu_search.text') : sql.raw('dynamic_menu_search.value')
}

function sqlValueList(values: Array<string | number>) {
  return sql.join(values.map(value => sql`${value}`), sql`, `)
}

function searchMatchCondition(args: {
  contentIdColumn: SQLWrapper
  fieldId: string
  dataType: string
  condition: SQL
}) {
  return sql`exists (
    select 1
    from content_search_data dynamic_menu_search
    where dynamic_menu_search.content_id = ${args.contentIdColumn}
      and dynamic_menu_search.projection_scope = ${'published'}
      and dynamic_menu_search.field_id = ${args.fieldId}
      and dynamic_menu_search.data_type = ${args.dataType}
      and ${args.condition}
  )`
}

function searchSortExpression(fieldId: string, dataType: string) {
  const column = searchColumnForDataType(dataType)
  return sql`(
    select ${column}
    from content_search_data dynamic_menu_search
    where dynamic_menu_search.content_id = ${contentListingTable.contentId}
      and dynamic_menu_search.projection_scope = ${'published'}
      and dynamic_menu_search.field_id = ${fieldId}
      and dynamic_menu_search.data_type = ${dataType}
    limit 1
  )`
}

function boundedLabel(value: unknown, fallback = 'Untitled') {
  const text = String(value ?? '').trim() || fallback
  return [...text].slice(0, 80).join('')
}

function displaySearchValue(value: string | number | null, field: SchemaRegistry['fields'][number]) {
  if (value == null) return null
  if (field.kind === 'boolean') return Number(value) === 1 ? 'True' : 'False'
  if (field.kind === 'date' || field.kind === 'datetime') {
    const date = new Date(Number(value))
    if (!Number.isNaN(date.getTime())) {
      return field.kind === 'date' ? date.toISOString().slice(0, 10) : date.toISOString()
    }
  }
  return String(value)
}

async function resolveSchemaSource(
  db: Db,
  item: SiteMenuDynamicItem & { source: Extract<SiteMenuSource, { type: 'schemaQuery' }> },
  prepared: PreparedSchemaSource,
  d1Gate: SiteMenuD1Gate,
  signal: AbortSignal
): Promise<SiteMenuSourceCandidate[]> {
  const { issues } = validateSchemaSource(item.source, prepared)
  if (issues.length) throw new InvalidSiteMenuSourceError(issues[0]!.message)

  const whereParts = [
    eq(contentListingTable.schemaKey, item.source.schemaKey),
    eq(contentListingTable.projectionScope, 'published'),
    eq(contentListingTable.status, 'published'),
    isNotNull(contentTable.publishedRevisionId),
    ne(contentTable.status, 'deleted'),
    eq(schemaActiveTable.status, 'active'),
    eq(schemaRoleTable.roleKey, 'anonymous'),
    eq(schemaRoleTable.canRead, true),
    eq(publicRouteTable.routeKind, 'canonical'),
    eq(publicRouteTable.documentKind, 'content')
  ]

  for (const filter of item.source.filters) {
    const field = prepared.fieldById.get(filter.fieldId)!
    const dataType = searchDataTypeForKind(field.kind)!
    const values = coerceFilterValues(filter, field)!
    const column = searchColumnForDataType(dataType)
    const condition = filter.operator === 'exact'
      ? sql`${column} = ${values[0]!}`
      : sql`${column} in (${sqlValueList(values)})`
    whereParts.push(searchMatchCondition({
      contentIdColumn: contentListingTable.contentId,
      fieldId: filter.fieldId,
      dataType,
      condition
    }))
  }

  const rowsQuery = db.select({
    id: contentListingTable.contentId,
    title: contentListingTable.title
  }).from(contentListingTable).innerJoin(contentTable, and(
    eq(contentTable.id, contentListingTable.contentId),
    eq(contentTable.schemaKey, contentListingTable.schemaKey)
  )).innerJoin(schemaActiveTable, eq(schemaActiveTable.schemaKey, contentListingTable.schemaKey))
    .innerJoin(schemaRoleTable, eq(schemaRoleTable.schemaKey, contentListingTable.schemaKey))
    .innerJoin(publicRouteTable, and(
      eq(publicRouteTable.documentId, contentListingTable.contentId),
      eq(publicRouteTable.schemaKey, contentListingTable.schemaKey)
    )).where(and(...whereParts)).limit(item.source.limit)

  const direction = item.source.sort.direction
  let rows: Array<{ id: string, title: string | null }>
  if (item.source.sort.type === 'system') {
    const column = item.source.sort.field === 'createdAt'
      ? contentListingTable.createdAt
      : contentListingTable.updatedAt
    rows = await d1Gate.run(async () => await rowsQuery.orderBy(
      direction === 'desc' ? desc(column) : asc(column),
      direction === 'desc' ? desc(contentListingTable.contentId) : asc(contentListingTable.contentId)
    ), signal)
  } else {
    const field = prepared.fieldById.get(item.source.sort.fieldId)!
    const expression = searchSortExpression(item.source.sort.fieldId, searchDataTypeForKind(field.kind)!)
    rows = await d1Gate.run(async () => await rowsQuery.orderBy(
      direction === 'desc' ? desc(expression) : asc(expression),
      direction === 'desc' ? desc(contentListingTable.contentId) : asc(contentListingTable.contentId)
    ), signal)
  }

  let labelValueById = new Map<string, string | number | null>()
  if (item.source.label.type === 'field' && rows.length) {
    const labelFieldId = item.source.label.fieldId
    const values: Array<{ contentId: string, text: string | null, value: number | null }> = await d1Gate.run(async () => await db.select({
      contentId: contentSearchData.contentId,
      text: contentSearchData.text,
      value: contentSearchData.value
    }).from(contentSearchData).where(and(
      eq(contentSearchData.projectionScope, 'published'),
      eq(contentSearchData.fieldId, labelFieldId),
      inArray(contentSearchData.contentId, rows.map(row => row.id))
    )), signal)
    labelValueById = new Map(values.map(value => [value.contentId, value.text ?? value.value]))
  }

  const labelField = item.source.label.type === 'field'
    ? prepared.fieldById.get(item.source.label.fieldId)
    : undefined
  return rows.map(row => ({
    sourceId: item.id,
    documentKind: 'content' as const,
    documentId: row.id,
    schemaKey: item.source.schemaKey,
    label: boundedLabel(labelField
      ? displaySearchValue(labelValueById.get(row.id) ?? null, labelField) ?? row.title
      : row.title),
    icon: item.source.icon,
    badge: item.source.badge
  }))
}

function directChildCondition(prefix: string) {
  if (prefix === '/') {
    return and(
      ne(publicRouteTable.path, '/'),
      sql`instr(substr(${publicRouteTable.path}, 2), '/') = 0`
    )!
  }
  const childPrefix = `${prefix}/`
  return and(
    sql`substr(${publicRouteTable.path}, 1, length(${childPrefix})) = ${childPrefix}`,
    sql`instr(substr(${publicRouteTable.path}, length(${childPrefix}) + 1), '/') = 0`
  )!
}

function pageSourcePrefix(
  source: Extract<SiteMenuSource, { type: 'pagePrefix' }>,
  context: { documentKind: string, canonicalPath: string | null }
) {
  if (source.scope.type === 'fixed') return source.scope.prefix
  if (context.documentKind !== 'page' || !context.canonicalPath) return null
  return publicParentPath(context.canonicalPath)
}

async function resolvePageSource(
  db: Db,
  item: SiteMenuDynamicItem & { source: Extract<SiteMenuSource, { type: 'pagePrefix' }> },
  context: { documentKind: string, canonicalPath: string | null },
  d1Gate: SiteMenuD1Gate,
  signal: AbortSignal
): Promise<SiteMenuSourceCandidate[]> {
  const prefix = pageSourcePrefix(item.source, context)
  if (prefix == null) return []
  const titleOrder = sql`coalesce(nullif(trim(${publicationRevisionTable.title}), ''), 'Untitled page') collate nocase`
  let query = db.select({
    id: pageTable.id,
    title: publicationRevisionTable.title,
    path: publicRouteTable.path
  }).from(publicRouteTable).innerJoin(pageTable, eq(pageTable.id, publicRouteTable.documentId))
    .innerJoin(publicationRevisionTable, and(
      eq(publicationRevisionTable.id, pageTable.publishedRevisionId),
      eq(publicationRevisionTable.documentKind, 'page'),
      eq(publicationRevisionTable.documentId, pageTable.id)
    )).where(and(
      eq(publicRouteTable.routeKind, 'canonical'),
      eq(publicRouteTable.documentKind, 'page'),
      ne(pageTable.status, 'deleted'),
      isNotNull(pageTable.publishedRevisionId),
      directChildCondition(prefix)
    )).limit(item.source.limit)

  query = item.source.sort === 'path'
    ? query.orderBy(asc(publicRouteTable.path), asc(pageTable.id))
    : query.orderBy(asc(titleOrder), asc(publicRouteTable.path), asc(pageTable.id))
  const rows: Array<{ id: string, title: string | null, path: string }> = await d1Gate.run(
    async () => await query,
    signal
  )
  return rows.map(row => ({
    sourceId: item.id,
    documentKind: 'page' as const,
    documentId: row.id,
    label: boundedLabel(row.title, 'Untitled page'),
    icon: item.source.icon,
    badge: item.source.badge
  }))
}

export async function withSourceTimeout<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timeoutError = new SiteMenuSourceTimeoutError()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      loader(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError)
          reject(timeoutError)
        }, timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function mapWithSiteMenuConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

function diagnostic(
  item: SiteMenuDynamicItem,
  status: SiteMenuSourceDiagnostic['status'],
  count: number,
  message: string
): SiteMenuSourceDiagnostic {
  return { sourceId: item.id, sourceType: item.source.type, status, count, message }
}

export async function resolveSiteMenuDynamicSources(args: {
  event: H3Event
  db: Db
  document: SiteMenuDocument
  context: { documentKind: string, canonicalPath: string | null }
  deadlineAt?: number
  preparedSchemaByKey?: Map<string, PreparedSchemaSource>
  d1Gate?: SiteMenuD1Gate
}) {
  const entries = dynamicSourceEntries(args.document)
  const d1Gate = args.d1Gate ?? createSiteMenuD1Gate()
  const preparedSchemaByKey = args.preparedSchemaByKey ?? await prepareSiteMenuDynamicSourceMetadata({
    db: args.db,
    documents: [args.document],
    d1Gate
  })
  const resolved = await mapWithSiteMenuConcurrency(entries, SITE_MENU_SOURCE_CONCURRENCY, async ({ item }) => {
    if (item.source.type === 'pagePrefix'
      && item.source.scope.type === 'currentParent'
      && pageSourcePrefix(item.source, args.context) == null) {
      return {
        item,
        candidates: [] as SiteMenuSourceCandidate[],
        diagnostic: diagnostic(item, 'context-unavailable', 0, 'Choose a canonical standalone Page context to resolve this source.')
      }
    }

    const contextualPath = item.source.type === 'pagePrefix' && item.source.scope.type === 'currentParent'
      ? args.context.canonicalPath
      : null
    const scope = item.source.type === 'schemaQuery'
      ? `schema:${item.source.schemaKey}`
      : SITE_MENU_PAGE_CACHE_SCOPE
    try {
      const remainingBudget = args.deadlineAt == null
        ? SITE_MENU_SOURCE_TIMEOUT_MS
        : Math.min(SITE_MENU_SOURCE_TIMEOUT_MS, args.deadlineAt - Date.now())
      if (remainingBudget <= 0) throw new SiteMenuSourceTimeoutError()
      const candidates = await withSourceTimeout(async (signal) => {
        const loadCandidates = async () => (
          item.source.type === 'schemaQuery'
            ? resolveSchemaSource(
                args.db,
                item as SiteMenuDynamicItem & { source: Extract<SiteMenuSource, { type: 'schemaQuery' }> },
                preparedSchemaByKey.get(item.source.schemaKey)
                ?? unavailablePreparedSchema(item.source.schemaKey, new Error('Dynamic Menu source metadata is unavailable')),
                d1Gate,
                signal
              )
            : resolvePageSource(
                args.db,
                item as SiteMenuDynamicItem & { source: Extract<SiteMenuSource, { type: 'pagePrefix' }> },
                args.context,
                d1Gate,
                signal
              )
        )
        if (!hasDistributedWidgetCache(args.event)) {
          return (await loadCandidates()).slice(0, SITE_MENU_MAX_SOURCE_RESULTS)
        }
        const cacheKey = await resolveWidgetCacheKey(args.event, 'site-menu-source', 'v1', {
          sourceId: item.id,
          source: item.source,
          contextualPath
        }, scope)
        const cached = await withWidgetCache(args.event, cacheKey, SOURCE_CACHE_POLICY, loadCandidates)
        return cached.data.slice(0, SITE_MENU_MAX_SOURCE_RESULTS)
      }, remainingBudget)
      return {
        item,
        candidates,
        diagnostic: diagnostic(
          item,
          candidates.length ? 'ready' : 'empty',
          candidates.length,
          candidates.length ? `Resolved ${candidates.length} public menu items.` : 'No public items match this source.'
        )
      }
    } catch (error) {
      const status = error instanceof SiteMenuSourceTimeoutError
        ? 'timeout'
        : error instanceof InvalidSiteMenuSourceError ? 'invalid' : 'error'
      const message = status === 'invalid' && error instanceof Error
        ? error.message
        : status === 'timeout'
          ? 'The source timed out and was omitted.'
          : 'The source could not be resolved and was omitted.'
      return { item, candidates: [] as SiteMenuSourceCandidate[], diagnostic: diagnostic(item, status, 0, message) }
    }
  })

  return {
    candidatesBySourceId: new Map(resolved.map(result => [result.item.id, result.candidates])),
    diagnostics: resolved.map(result => result.diagnostic)
  }
}

export async function getSiteMenuSourceOptions(event: H3Event): Promise<SiteMenuSourceOptionsResponse> {
  const db = await getDb(event)
  const d1Gate = createSiteMenuD1Gate()
  const schemaRows: Array<{ schemaKey: string, registryJson: string | null }> = await d1Gate.run(async () => await db.select({
    schemaKey: schemaActiveTable.schemaKey,
    registryJson: schemaTable.registryJson
  }).from(schemaActiveTable).innerJoin(schemaTable, and(
    eq(schemaTable.schemaKey, schemaActiveTable.schemaKey),
    eq(schemaTable.version, schemaActiveTable.activeVersion)
  )).innerJoin(schemaRoleTable, and(
    eq(schemaRoleTable.schemaKey, schemaActiveTable.schemaKey),
    eq(schemaRoleTable.roleKey, 'anonymous'),
    eq(schemaRoleTable.canRead, true)
  )).where(eq(schemaActiveTable.status, 'active')).orderBy(asc(schemaActiveTable.schemaKey)))

  const registryRows: Array<{
    row: { schemaKey: string, registryJson: string | null }
    registry: SchemaRegistry
  }> = schemaRows.flatMap((row) => {
    const registry = parseRegistry(row.registryJson)
    return registry ? [{ row, registry }] : []
  })
  const configs: SearchConfigRow[] = []
  const schemaKeys = registryRows.map(({ row }) => row.schemaKey)
  for (let offset = 0; offset < schemaKeys.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
    const chunk = schemaKeys.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
    if (!chunk.length) continue
    configs.push(...await d1Gate.run(async () => await db.select().from(searchConfigTable)
      .where(inArray(searchConfigTable.schemaKey, chunk)) as SearchConfigRow[]))
  }
  const configsBySchemaKey = new Map<string, SearchConfigRow[]>()
  for (const config of configs) {
    const rows = configsBySchemaKey.get(config.schemaKey) ?? []
    rows.push(config)
    configsBySchemaKey.set(config.schemaKey, rows)
  }
  const schemas = [] as SiteMenuSourceOptionsResponse['schemas']
  for (const { row, registry } of registryRows) {
    const configById = new Map((configsBySchemaKey.get(row.schemaKey) ?? []).map(config => [config.fieldId, config]))
    schemas.push({
      schemaKey: row.schemaKey,
      label: registry.title || row.schemaKey,
      fields: registry.fields.flatMap((field) => {
        const config = configById.get(field.fieldId)
        if (!config || config.fieldKey !== field.key || config.kind !== field.kind) return []
        const scalar = Boolean(searchDataTypeForKind(field.kind)) && field.kind !== 'richtext'
        return [{
          fieldId: field.fieldId,
          fieldKey: field.key,
          label: field.title || field.key,
          kind: field.kind,
          searchMode: config.searchMode as 'off' | 'exact' | 'exact_set' | 'range',
          filterable: config.filterable,
          sortable: config.sortable,
          labelEligible: scalar && (config.searchMode !== 'off' || config.filterable || config.sortable),
          enumValues: field.enumValues ?? []
        }]
      })
    })
  }

  const pages: Array<{ id: string, title: string | null, path: string }> = await d1Gate.run(async () => await db.select({
    id: pageTable.id,
    title: publicationRevisionTable.title,
    path: publicRouteTable.path
  }).from(publicRouteTable).innerJoin(pageTable, eq(pageTable.id, publicRouteTable.documentId))
    .innerJoin(publicationRevisionTable, and(
      eq(publicationRevisionTable.id, pageTable.publishedRevisionId),
      eq(publicationRevisionTable.documentKind, 'page'),
      eq(publicationRevisionTable.documentId, pageTable.id)
    )).where(and(
      eq(publicRouteTable.routeKind, 'canonical'),
      eq(publicRouteTable.documentKind, 'page'),
      ne(pageTable.status, 'deleted'),
      isNotNull(pageTable.publishedRevisionId)
    )).orderBy(asc(publicRouteTable.path)))

  return {
    schemas,
    pages: pages.map(page => ({ id: page.id, title: boundedLabel(page.title, 'Untitled page'), path: page.path }))
  }
}
