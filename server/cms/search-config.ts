import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/db'
import { searchConfig } from '../db/schema'
import type { DbStatement } from '../db/transaction'
import { executeDbStatement } from '../db/transaction'
import type { SchemaRegistry } from './types'
import { normalizeSearchConfig } from './search-helpers'
import { deleteContentSearchDataForFields } from './search-index'

export async function syncSearchConfig(args: {
  db: Db
  schemaKey: string
  registry: SchemaRegistry
  statements?: DbStatement[]
}) {
  const { db, schemaKey, registry } = args
  const desiredIds = new Set<string>()

  for (const field of registry.fields) {
    const config = normalizeSearchConfig(field)
    desiredIds.add(field.fieldId)
    await executeDbStatement(db
      .insert(searchConfig)
      .values({
        schemaKey,
        fieldId: field.fieldId,
        fieldKey: field.key,
        kind: field.kind,
        searchMode: config.mode,
        filterable: config.filterable,
        sortable: config.sortable,
        fullText: config.fullText
      })
      .onConflictDoUpdate({
        target: [searchConfig.schemaKey, searchConfig.fieldId],
        set: {
          fieldKey: field.key,
          kind: field.kind,
          searchMode: config.mode,
          filterable: config.filterable,
          sortable: config.sortable,
          fullText: config.fullText
        }
      }), args.statements)
  }

  const existing = await db
    .select({ fieldId: searchConfig.fieldId })
    .from(searchConfig)
    .where(eq(searchConfig.schemaKey, schemaKey))

  const removedIds: string[] = []
  for (const row of existing) {
    if (desiredIds.has(row.fieldId)) continue
    removedIds.push(row.fieldId)
    await executeDbStatement(db
      .delete(searchConfig)
      .where(and(eq(searchConfig.schemaKey, schemaKey), eq(searchConfig.fieldId, row.fieldId))), args.statements)
  }

  await deleteContentSearchDataForFields({
    db,
    fieldIds: removedIds,
    projectionScope: 'working',
    statements: args.statements
  })
}
