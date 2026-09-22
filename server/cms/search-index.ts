import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/db'
import { content as contentTable, contentSearchData } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import type { DbStatement } from '../db/transaction'
import type { SchemaRegistry } from './types'
import { coerceSearchValue, isSearchEnabled, normalizeSearchConfig, searchDataTypeForKind } from './search-helpers'
import { parseContentJson } from './content-json'

export type SearchIndexValue = {
  fieldId: string
  fieldKey: string
  dataType: 'text' | 'integer' | 'float' | 'date'
  value: string | number
}

function isBlankSearchValue(value: unknown) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function buildIndexValue(field: SchemaRegistry['fields'][number], content: Record<string, unknown>): SearchIndexValue | null {
  const config = normalizeSearchConfig(field)
  if (!isSearchEnabled(config)) return null

  const dataType = searchDataTypeForKind(field.kind)
  if (!dataType) return null

  const value = coerceSearchValue(field, content[field.key])
  if (isBlankSearchValue(value)) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null

  return {
    fieldId: field.fieldId,
    fieldKey: field.key,
    dataType,
    value
  }
}

async function deleteSearchValueByContent(db: Db, contentId: string, projectionScope: string, fieldId: string, statements?: DbStatement[]) {
  await executeDbStatement(db
    .delete(contentSearchData)
    .where(and(
      eq(contentSearchData.contentId, contentId),
      eq(contentSearchData.projectionScope, projectionScope),
      eq(contentSearchData.fieldId, fieldId)
    )), statements)
}

async function upsertSearchValue(db: Db, contentId: string, projectionScope: string, indexed: SearchIndexValue, statements?: DbStatement[]) {
  await executeDbStatement(db
    .insert(contentSearchData)
    .values({
      contentId,
      projectionScope,
      fieldId: indexed.fieldId,
      dataType: indexed.dataType,
      text: indexed.dataType === 'text' ? String(indexed.value) : null,
      value: indexed.dataType === 'text' ? null : Number(indexed.value)
    })
    .onConflictDoUpdate({
      target: [contentSearchData.contentId, contentSearchData.projectionScope, contentSearchData.fieldId],
      set: {
        dataType: indexed.dataType,
        text: indexed.dataType === 'text' ? String(indexed.value) : null,
        value: indexed.dataType === 'text' ? null : Number(indexed.value)
      }
    }), statements)
}

export function buildContentSearchIndexValues(args: {
  registry: SchemaRegistry
  content: Record<string, unknown>
  onlyFieldIds?: string[]
}) {
  const onlySet = args.onlyFieldIds ? new Set(args.onlyFieldIds) : null
  const values: SearchIndexValue[] = []

  for (const field of args.registry.fields) {
    if (onlySet && !onlySet.has(field.fieldId)) continue
    const indexed = buildIndexValue(field, args.content)
    if (indexed) values.push(indexed)
  }

  return values
}

export async function upsertContentSearchData(args: {
  db: Db
  contentId: string
  registry: SchemaRegistry
  content: Record<string, unknown>
  onlyFieldIds?: string[]
  projectionScope?: 'working' | 'published'
  statements?: DbStatement[]
}) {
  const onlySet = args.onlyFieldIds ? new Set(args.onlyFieldIds) : null
  const projectionScope = args.projectionScope ?? 'working'

  if (!onlySet) {
    await executeDbStatement(args.db
      .delete(contentSearchData)
      .where(and(
        eq(contentSearchData.contentId, args.contentId),
        eq(contentSearchData.projectionScope, projectionScope)
      )), args.statements)
  }

  for (const field of args.registry.fields) {
    if (onlySet && !onlySet.has(field.fieldId)) continue
    const indexed = buildIndexValue(field, args.content)
    if (!indexed) {
      await deleteSearchValueByContent(args.db, args.contentId, projectionScope, field.fieldId, args.statements)
      continue
    }
    await upsertSearchValue(args.db, args.contentId, projectionScope, indexed, args.statements)
  }
}

export async function deleteContentSearchData(args: {
  db: Db
  contentId: string
  projectionScope?: 'working' | 'published'
}) {
  await args.db
    .delete(contentSearchData)
    .where(args.projectionScope
      ? and(eq(contentSearchData.contentId, args.contentId), eq(contentSearchData.projectionScope, args.projectionScope))
      : eq(contentSearchData.contentId, args.contentId))
}

export async function deleteContentSearchDataForFields(args: {
  db: Db
  fieldIds: string[]
  projectionScope?: 'working' | 'published'
  statements?: DbStatement[]
}) {
  if (!args.fieldIds.length) return
  await executeDbStatement(args.db
    .delete(contentSearchData)
    .where(args.projectionScope
      ? and(
          inArray(contentSearchData.fieldId, args.fieldIds),
          eq(contentSearchData.projectionScope, args.projectionScope)
        )
      : inArray(contentSearchData.fieldId, args.fieldIds)), args.statements)
}

export async function syncSearchIndexForSchema(args: {
  db: Db
  schemaKey: string
  registry: SchemaRegistry
  onlyFieldIds?: string[]
}) {
  const rows = await args.db
    .select({
      id: contentTable.id,
      contentJson: contentTable.contentJson
    })
    .from(contentTable)
    .where(eq(contentTable.schemaKey, args.schemaKey))

  let indexed = 0
  for (const row of rows) {
    await upsertContentSearchData({
      db: args.db,
      contentId: row.id,
      registry: args.registry,
      content: parseContentJson(row.contentJson),
      onlyFieldIds: args.onlyFieldIds,
      projectionScope: 'working'
    })
    indexed += 1
  }

  return { indexed }
}
