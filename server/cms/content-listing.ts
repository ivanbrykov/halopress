import { eq } from 'drizzle-orm'
import type { Db } from '../db/db'
import { content as contentTable, contentListing } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import type { DbStatement } from '../db/transaction'
import type { SchemaRegistry } from './types'
import { getPublishedSchema } from './repo'
import { parseContentJson } from './content-json'
import { buildListingProjection } from './listing'

export function buildContentListingSnapshot(args: {
  registry: SchemaRegistry | null
  content: Record<string, unknown>
  contentId: string
  schemaKey: string
  schemaVersion: number
  status: string
  createdAt: Date
  updatedAt: Date
  projectionScope?: 'working' | 'published'
}) {
  const { registry, content, contentId, schemaKey, schemaVersion, status, createdAt, updatedAt } = args
  const listing = buildListingProjection({ registry, content })

  return {
    contentId,
    projectionScope: args.projectionScope ?? 'working',
    schemaKey,
    schemaVersion,
    title: listing.title,
    description: listing.description,
    image: listing.image,
    status,
    createdAt,
    updatedAt
  }
}

export async function upsertContentListingSnapshot(args: {
  db: Db
  registry: SchemaRegistry | null
  content: Record<string, unknown>
  contentId: string
  schemaKey: string
  schemaVersion: number
  status: string
  createdAt: Date
  updatedAt: Date
  projectionScope?: 'working' | 'published'
  statements?: DbStatement[]
}) {
  const snapshot = buildContentListingSnapshot(args)
  await executeDbStatement(args.db
    .insert(contentListing)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [contentListing.contentId, contentListing.projectionScope],
      set: {
        schemaKey: snapshot.schemaKey,
        projectionScope: snapshot.projectionScope,
        schemaVersion: snapshot.schemaVersion,
        title: snapshot.title,
        description: snapshot.description,
        image: snapshot.image,
        status: snapshot.status,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt
      }
    }), args.statements)
}

export async function syncContentListing(args: {
  db: Db
  schemaKey?: string
  onlyMissing?: boolean
}) {
  const { db, schemaKey, onlyMissing = true } = args
  let existingIds = new Set<string>()

  if (onlyMissing) {
    const existingRows = await (schemaKey
      ? db.select({ contentId: contentListing.contentId }).from(contentListing).where(eq(contentListing.schemaKey, schemaKey))
      : db.select({ contentId: contentListing.contentId }).from(contentListing))
    existingIds = new Set(existingRows.map((row: any) => row.contentId as string))
  }

  const rows = await (schemaKey
    ? db
      .select({
        id: contentTable.id,
        schemaKey: contentTable.schemaKey,
        schemaVersion: contentTable.schemaVersion,
        status: contentTable.status,
        contentJson: contentTable.contentJson,
        createdAt: contentTable.createdAt,
        updatedAt: contentTable.updatedAt
      })
      .from(contentTable)
      .where(eq(contentTable.schemaKey, schemaKey))
    : db
      .select({
        id: contentTable.id,
        schemaKey: contentTable.schemaKey,
        schemaVersion: contentTable.schemaVersion,
        status: contentTable.status,
        contentJson: contentTable.contentJson,
        createdAt: contentTable.createdAt,
        updatedAt: contentTable.updatedAt
      })
      .from(contentTable))

  const registryCache = new Map<string, SchemaRegistry | null>()
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    if (onlyMissing && existingIds.has(row.id)) {
      skipped += 1
      continue
    }

    const content = parseContentJson(row.contentJson)

    if (!registryCache.has(row.schemaKey)) {
      const active = await getPublishedSchema(db, row.schemaKey, { includeInactive: true })
      registryCache.set(row.schemaKey, active?.registry ?? null)
    }

    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)

    try {
      await upsertContentListingSnapshot({
        db,
        registry: registryCache.get(row.schemaKey) ?? null,
        content,
        contentId: row.id,
        schemaKey: row.schemaKey,
        schemaVersion: row.schemaVersion,
        status: row.status,
        createdAt,
        updatedAt,
        projectionScope: 'working'
      })
      updated += 1
    } catch {
      failed += 1
    }
  }

  return { total: rows.length, updated, skipped, failed }
}
