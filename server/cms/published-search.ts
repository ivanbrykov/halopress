import { and, eq, inArray, or } from 'drizzle-orm'

import type { Db } from '../db/db'
import { contentListing as contentListingTable, schema as schemaTable } from '../db/schema'
import { conflict } from '../utils/http'
import { PUBLIC_ROUTE_D1_IN_CHUNK_SIZE } from './public-routes'
import { normalizeSearchConfig } from './search-helpers'
import type { SchemaRegistry } from './types'

export type PublishedSearchField = {
  fieldId: string
  fieldKey: string
  kind: string
  filterable?: boolean
  sortable?: boolean
}

export type PublishedSchemaFields = Array<{
  version: number
  fields: SchemaRegistry['fields']
}>

export type PublishedSearchQueryRunner = <T>(query: () => Promise<T>) => Promise<T>

type PublishedSchemaVersion = {
  schemaKey: string
  version: number
}

const PUBLISHED_SCHEMA_PAIR_CHUNK_SIZE = Math.floor(PUBLIC_ROUTE_D1_IN_CHUNK_SIZE / 2)

function immediateQueryRunner<T>(query: () => Promise<T>) {
  return query()
}

/**
 * Loads published Schema snapshots for several Schema keys without one query
 * per key. Composite Schema identities use two bound parameters, so each
 * chunk stays within the repository's conservative 90-parameter convention.
 */
export async function loadPublishedSchemaFieldsByKey(
  db: Db,
  schemaKeyInputs: string[],
  status?: string | null,
  runQuery: PublishedSearchQueryRunner = immediateQueryRunner
) {
  const schemaKeys = [...new Set(schemaKeyInputs)]
  const versionRows: PublishedSchemaVersion[] = []
  for (let offset = 0; offset < schemaKeys.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
    const chunk = schemaKeys.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
    if (!chunk.length) continue
    const conditions = [
      inArray(contentListingTable.schemaKey, chunk),
      eq(contentListingTable.projectionScope, 'published')
    ]
    if (status) conditions.push(eq(contentListingTable.status, status))
    versionRows.push(...await runQuery(async () => await db
      .selectDistinct({
        schemaKey: contentListingTable.schemaKey,
        version: contentListingTable.schemaVersion
      })
      .from(contentListingTable)
      .where(and(...conditions)) as PublishedSchemaVersion[]))
  }

  const identities = [...new Map(versionRows.map(row => [
    `${row.schemaKey}:${row.version}`,
    row
  ])).values()]
  const storedRows: Array<{ schemaKey: string, version: number, registryJson: string | null }> = []
  for (let offset = 0; offset < identities.length; offset += PUBLISHED_SCHEMA_PAIR_CHUNK_SIZE) {
    const chunk = identities.slice(offset, offset + PUBLISHED_SCHEMA_PAIR_CHUNK_SIZE)
    if (!chunk.length) continue
    storedRows.push(...await runQuery(async () => await db
      .select({
        schemaKey: schemaTable.schemaKey,
        version: schemaTable.version,
        registryJson: schemaTable.registryJson
      })
      .from(schemaTable)
      .where(or(...chunk.map(identity => and(
        eq(schemaTable.schemaKey, identity.schemaKey),
        eq(schemaTable.version, identity.version)
      )))) as Array<{ schemaKey: string, version: number, registryJson: string | null }>))
  }

  const expectedByKey = new Map<string, Set<number>>()
  for (const identity of identities) {
    const versions = expectedByKey.get(identity.schemaKey) ?? new Set<number>()
    versions.add(identity.version)
    expectedByKey.set(identity.schemaKey, versions)
  }
  const rowsByKey = new Map<string, typeof storedRows>()
  for (const row of storedRows) {
    const rows = rowsByKey.get(row.schemaKey) ?? []
    rows.push(row)
    rowsByKey.set(row.schemaKey, rows)
  }

  const fieldsBySchemaKey = new Map<string, PublishedSchemaFields>()
  const errorsBySchemaKey = new Map<string, Error>()
  for (const schemaKey of schemaKeys) {
    const expected = expectedByKey.get(schemaKey) ?? new Set<number>()
    const rows = rowsByKey.get(schemaKey) ?? []
    if (rows.length !== expected.size || rows.some(row => !expected.has(row.version))) {
      errorsBySchemaKey.set(schemaKey, conflict('Published search schema version is unavailable'))
      continue
    }
    try {
      fieldsBySchemaKey.set(schemaKey, rows
        .sort((left, right) => left.version - right.version)
        .map((stored) => {
          if (!stored.registryJson) throw conflict('Published search schema version is unavailable')
          const registry = JSON.parse(stored.registryJson) as SchemaRegistry
          if (!Array.isArray(registry?.fields)) throw conflict('Published search schema version is unavailable')
          return { version: stored.version, fields: registry.fields }
        }))
    } catch (error) {
      errorsBySchemaKey.set(
        schemaKey,
        error instanceof Error ? error : conflict('Published search schema version is unavailable')
      )
    }
  }

  return { fieldsBySchemaKey, errorsBySchemaKey }
}

export async function getPublishedSchemaFields(
  db: Db,
  schemaKey: string,
  status?: string | null
) {
  const loaded = await loadPublishedSchemaFieldsByKey(db, [schemaKey], status)
  const error = loaded.errorsBySchemaKey.get(schemaKey)
  if (error) throw error
  return loaded.fieldsBySchemaKey.get(schemaKey) ?? []
}

export function assertPublishedFieldCompatibility(args: {
  config: PublishedSearchField
  publishedSchemas: Awaited<ReturnType<typeof getPublishedSchemaFields>>
  capability?: 'filterable' | 'sortable'
}) {
  for (const stored of args.publishedSchemas) {
    const reusedKey = stored.fields.find(candidate => (
      candidate.key === args.config.fieldKey
      && candidate.fieldId !== args.config.fieldId
    ))
    if (reusedKey) {
      throw conflict(`Published search field spans incompatible schema versions: ${args.config.fieldKey}`)
    }
    const field = stored.fields.find(candidate => candidate.fieldId === args.config.fieldId)
    if (!field) continue
    const normalized = normalizeSearchConfig(field)
    if (field.kind !== args.config.kind || (args.capability && !normalized[args.capability])) {
      throw conflict(`Published search field spans incompatible schema versions: ${args.config.fieldKey}`)
    }
  }
}
