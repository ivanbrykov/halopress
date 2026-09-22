import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

import type { Db } from '../db/db'
import { content as contentTable } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import { mutateWithDocumentRevision } from './document-revisions'
import type { FieldKind, FieldNode, SchemaAst, SchemaRegistry } from './types'
import { parseContentJson } from './content-json'
import { syncContentProjections } from './content-projections'

export type KindChange = {
  fieldId: string
  fromKey: string
  toKey: string
  fromKind: FieldKind
  toKind: FieldKind
  fromRel?: FieldNode['rel']
  toRel?: FieldNode['rel']
  toField: FieldNode
}

export function getKindChanges(fromAst: SchemaAst | null, toAst: SchemaAst): KindChange[] {
  if (!fromAst) return []
  const prevById = new Map(fromAst.fields.map(field => [field.id, field]))
  const changes: KindChange[] = []

  for (const field of toAst.fields) {
    const prev = prevById.get(field.id)
    if (!prev) continue
    const prevCardinality = prev.rel?.cardinality ?? 'one'
    const nextCardinality = field.rel?.cardinality ?? 'one'
    const refCardinalityChanged = prev.kind === 'reference' && field.kind === 'reference' && prevCardinality !== nextCardinality
    if (prev.kind !== field.kind || refCardinalityChanged) {
      changes.push({
        fieldId: field.id,
        fromKey: prev.key,
        toKey: field.key,
        fromKind: prev.kind,
        toKind: field.kind,
        fromRel: prev.rel,
        toRel: field.rel,
        toField: field
      })
    }
  }

  return changes
}

function toStringValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function toIntegerValue(value: unknown): number | null {
  const num = toNumberValue(value)
  if (num == null) return null
  return Math.trunc(num)
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false
  }
  return null
}

function toDateString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const date = new Date(trimmed)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
  }
  if (typeof value === 'number') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
  }
  return null
}

function toDateTimeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const date = new Date(trimmed)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
  }
  if (typeof value === 'number') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
  }
  return null
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value ? value : null
}

function toReferenceValue(value: unknown, cardinality: 'one' | 'many') {
  if (cardinality === 'many') {
    if (Array.isArray(value)) return value.map(normalizeId).filter(Boolean)
    const one = normalizeId(value)
    return one ? [one] : []
  }
  if (Array.isArray(value)) {
    const first = value.map(normalizeId).find(Boolean) ?? null
    return first
  }
  return normalizeId(value)
}

function assetId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && typeof (value as any).assetId === 'string') {
    return (value as any).assetId || null
  }
  return null
}

function toAssetListValue(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item) => {
    const id = assetId(item)
    if (!id) return []
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const { alt, caption } = item as { alt?: unknown; caption?: unknown }
      return [{
        assetId: id,
        ...(typeof alt === 'string' && alt ? { alt } : {}),
        ...(typeof caption === 'string' && caption ? { caption } : {})
      }]
    }
    return [{ assetId: id }]
  })
}

export function coerceValue(value: unknown, field: FieldNode): unknown {
  switch (field.kind) {
    case 'string':
    case 'text':
    case 'url':
      return toStringValue(value)
    case 'number':
      return toNumberValue(value)
    case 'integer':
      return toIntegerValue(value)
    case 'boolean':
      return toBooleanValue(value)
    case 'date':
      return toDateString(value)
    case 'datetime':
      return toDateTimeString(value)
    case 'enum': {
      const candidate = toStringValue(value)
      if (!candidate) return null
      const allowed = new Set((field.enumValues ?? []).map(v => v.value))
      return allowed.has(candidate) ? candidate : null
    }
    case 'richtext':
      if (typeof value === 'string' || Array.isArray(value) || (value && typeof value === 'object')) return value
      return null
    case 'reference':
      return toReferenceValue(value, field.rel?.cardinality ?? 'one')
    case 'asset':
      return Array.isArray(value) ? assetId(value[0]) : assetId(value)
    case 'asset_list':
      return toAssetListValue(value)
    default:
      return null
  }
}

function valuesEqual(a: unknown, b: unknown) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function migrateSchemaContent(args: {
  event: H3Event
  db: Db
  schemaKey: string
  nextVersion: number
  registry: SchemaRegistry
  changes: KindChange[]
  actorId?: string | null
  trustedOrigin?: string
}) {
  const { db, schemaKey, nextVersion, registry, changes } = args
  if (!changes.length) return { updated: 0 }

  const rows = await db
    .select({
      id: contentTable.id,
      status: contentTable.status,
      publishedRevisionId: contentTable.publishedRevisionId,
      currentRevision: contentTable.currentRevision,
      createdAt: contentTable.createdAt,
      updatedAt: contentTable.updatedAt,
      updatedBy: contentTable.updatedBy,
      contentJson: contentTable.contentJson
    })
    .from(contentTable)
    .where(eq(contentTable.schemaKey, schemaKey))

  let updated = 0
  for (const row of rows) {
    const content = parseContentJson(row.contentJson)
    let mutated = false

    for (const change of changes) {
      const fromKey = change.fromKey
      const toKey = change.toKey
      let currentValue: unknown = content[fromKey]
      if (currentValue === undefined && fromKey !== toKey) {
        currentValue = content[toKey]
      }
      if (currentValue === undefined) continue

      const nextValue = coerceValue(currentValue, change.toField)

      if (nextValue == null || (Array.isArray(nextValue) && nextValue.length === 0)) {
        if (fromKey in content) {
          delete content[fromKey]
          mutated = true
        }
        if (toKey in content) {
          delete content[toKey]
          mutated = true
        }
        continue
      }

      if (fromKey !== toKey && fromKey in content) {
        delete content[fromKey]
        mutated = true
      }

      if (!valuesEqual(content[toKey], nextValue)) {
        content[toKey] = nextValue
        mutated = true
      }
    }

    const nextStatus = row.status === 'published' && row.publishedRevisionId
      ? 'draft'
      : row.status
    await mutateWithDocumentRevision({
      event: args.event,
      db,
      identity: row,
      expectedRevision: row.currentRevision,
      documentKind: 'content',
      documentId: row.id,
      schemaKey,
      action: 'migrate',
      state: { snapshot: content, status: nextStatus, schemaVersion: nextVersion },
      actorId: args.actorId,
      work: async (tx, statements, nextRevision, now) => {
        const updatePayload: Record<string, unknown> = {
          schemaVersion: nextVersion,
          currentRevision: nextRevision,
          updatedAt: now,
          updatedBy: args.actorId ?? null
        }
        if (nextStatus !== row.status) updatePayload.status = nextStatus
        if (mutated) updatePayload.contentJson = JSON.stringify(content)

        await executeDbStatement(tx
          .update(contentTable)
          .set(updatePayload)
          .where(and(
            eq(contentTable.id, row.id),
            eq(contentTable.currentRevision, row.currentRevision)
          )), statements)

        await syncContentProjections({
          db: tx,
          registry,
          content,
          contentId: row.id,
          schemaKey,
          schemaVersion: nextVersion,
          status: nextStatus,
          createdAt: row.createdAt,
          updatedAt: now,
          projectionScope: 'working',
          trustedOrigin: args.trustedOrigin,
          statements
        })
      }
    })
    updated += 1
  }

  return { updated }
}
