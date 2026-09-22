import { and, desc, eq, or } from 'drizzle-orm'
import type { Db } from '../db/db'
import {
  schema as schemaTable,
  schemaActive as schemaActiveTable,
  schemaDraft as schemaDraftTable,
  schemaRole as schemaRoleTable
} from '../db/schema'
import type { SchemaAst, SchemaRegistry } from './types'

export async function listActiveSchemas(db: Db, options: { roleKey?: string, includeInactive?: boolean } = {}) {
  const base = db
    .select({
      schemaKey: schemaActiveTable.schemaKey,
      activeVersion: schemaActiveTable.activeVersion,
      status: schemaActiveTable.status,
      deactivatedAt: schemaActiveTable.deactivatedAt,
      deactivatedBy: schemaActiveTable.deactivatedBy,
      reactivatedAt: schemaActiveTable.reactivatedAt,
      reactivatedBy: schemaActiveTable.reactivatedBy,
      updatedAt: schemaActiveTable.updatedAt,
      title: schemaTable.title
    })
    .from(schemaActiveTable)
    .leftJoin(schemaTable, and(eq(schemaTable.schemaKey, schemaActiveTable.schemaKey), eq(schemaTable.version, schemaActiveTable.activeVersion)))

  const rows = options.roleKey
    ? await base
        .innerJoin(schemaRoleTable, and(
          eq(schemaRoleTable.schemaKey, schemaActiveTable.schemaKey),
          eq(schemaRoleTable.roleKey, options.roleKey)
        ))
        .where(and(
          options.includeInactive ? undefined : eq(schemaActiveTable.status, 'active'),
          or(
            eq(schemaRoleTable.canRead, true),
            eq(schemaRoleTable.canWrite, true),
            eq(schemaRoleTable.canPublish, true),
            eq(schemaRoleTable.canArchive, true),
            eq(schemaRoleTable.canDelete, true),
            eq(schemaRoleTable.canAdmin, true)
          )
        ))
        .orderBy(schemaActiveTable.schemaKey)
    : await base
        .where(options.includeInactive ? undefined : eq(schemaActiveTable.status, 'active'))
        .orderBy(schemaActiveTable.schemaKey)

  return rows.map((r: any) => ({
    schemaKey: r.schemaKey,
    activeVersion: r.activeVersion,
    status: r.status,
    deactivatedAt: r.deactivatedAt ?? null,
    deactivatedBy: r.deactivatedBy ?? null,
    reactivatedAt: r.reactivatedAt ?? null,
    reactivatedBy: r.reactivatedBy ?? null,
    updatedAt: r.updatedAt,
    title: r.title ?? r.schemaKey
  }))
}

export async function getPublishedSchema(db: Db, schemaKey: string, options: { includeInactive?: boolean } = {}) {
  const active = await db
    .select()
    .from(schemaActiveTable)
    .where(eq(schemaActiveTable.schemaKey, schemaKey))
    .get()

  if (!active) return null
  if (!options.includeInactive && active.status !== 'active') return null

  const row = await db
    .select()
    .from(schemaTable)
    .where(and(eq(schemaTable.schemaKey, schemaKey), eq(schemaTable.version, active.activeVersion)))
    .get()

  if (!row) return null

  return {
    schemaKey,
    version: row.version,
    title: row.title ?? schemaKey,
    ast: JSON.parse(row.astJson) as SchemaAst,
    jsonSchema: JSON.parse(row.jsonSchema),
    uiSchema: row.uiSchema ? JSON.parse(row.uiSchema) : null,
    registry: row.registryJson ? (JSON.parse(row.registryJson) as SchemaRegistry) : null,
    status: active.status,
    deactivatedAt: active.deactivatedAt ?? null,
    deactivatedBy: active.deactivatedBy ?? null,
    reactivatedAt: active.reactivatedAt ?? null,
    reactivatedBy: active.reactivatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: active.updatedAt
  }
}

export async function getActiveSchema(db: Db, schemaKey: string) {
  return await getPublishedSchema(db, schemaKey)
}

export async function getSchemaLifecycle(db: Db, schemaKey: string) {
  return await db
    .select()
    .from(schemaActiveTable)
    .where(eq(schemaActiveTable.schemaKey, schemaKey))
    .get() ?? null
}

export async function listSchemaVersions(db: Db, schemaKey: string) {
  const rows = await db
    .select({
      schemaKey: schemaTable.schemaKey,
      version: schemaTable.version,
      title: schemaTable.title,
      createdAt: schemaTable.createdAt,
      note: schemaTable.note
    })
    .from(schemaTable)
    .where(eq(schemaTable.schemaKey, schemaKey))
    .orderBy(desc(schemaTable.version))

  return rows
}

export async function getSchemaVersion(db: Db, schemaKey: string, version: number) {
  const row = await db
    .select()
    .from(schemaTable)
    .where(and(eq(schemaTable.schemaKey, schemaKey), eq(schemaTable.version, version)))
    .get()

  if (!row) return null

  return {
    schemaKey,
    version: row.version,
    title: row.title ?? schemaKey,
    ast: JSON.parse(row.astJson) as SchemaAst,
    jsonSchema: JSON.parse(row.jsonSchema),
    uiSchema: row.uiSchema ? JSON.parse(row.uiSchema) : null,
    registry: row.registryJson ? (JSON.parse(row.registryJson) as SchemaRegistry) : null,
    diff: row.diffJson ? JSON.parse(row.diffJson) : null,
    createdAt: row.createdAt,
    note: row.note ?? null
  }
}

export async function getDraft(db: Db, schemaKey: string) {
  const row = await db
    .select()
    .from(schemaDraftTable)
    .where(eq(schemaDraftTable.schemaKey, schemaKey))
    .get()

  if (!row) return null
  return {
    schemaKey,
    title: row.title ?? schemaKey,
    ast: JSON.parse(row.astJson) as SchemaAst,
    revision: row.currentRevision,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null
  }
}
