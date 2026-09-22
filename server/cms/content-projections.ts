import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/db'
import { contentListing, contentRef, contentRefList, contentSearchData, documentAssetRef } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import type { DbStatement } from '../db/transaction'
import { syncDocumentAssetRefs, type ProjectionScope } from './asset-refs'
import { upsertContentListingSnapshot } from './content-listing'
import { syncContentRefs } from './ref-sync'
import { upsertContentSearchData } from './search-index'
import type { SchemaRegistry } from './types'

export function contentAssetFieldIds(registry: SchemaRegistry, content: Record<string, unknown>) {
  const ids: string[] = []
  for (const field of registry.fields) {
    if (field.kind !== 'asset' && field.kind !== 'asset_list') continue
    const value = content[field.key]
    if (typeof value === 'string' && value) ids.push(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item) ids.push(item)
        else if (item && typeof item === 'object' && typeof (item as any).assetId === 'string') ids.push((item as any).assetId)
      }
    }
  }
  return [...new Set(ids)].sort()
}

export async function syncContentProjections(args: {
  db: Db
  registry: SchemaRegistry
  content: Record<string, unknown>
  contentId: string
  schemaKey: string
  schemaVersion: number
  status: string
  createdAt: Date
  updatedAt: Date
  projectionScope: ProjectionScope
  trustedOrigin?: string
  additionalAssetIds?: string[]
  statements?: DbStatement[]
}) {
  await syncContentRefs(args)
  await upsertContentListingSnapshot(args)
  await upsertContentSearchData(args)
  await syncDocumentAssetRefs({
    db: args.db,
    documentKind: 'content',
    documentId: args.contentId,
    projectionScope: args.projectionScope,
    content: args.content,
    additionalAssetIds: [...contentAssetFieldIds(args.registry, args.content), ...(args.additionalAssetIds ?? [])],
    trustedOrigin: args.trustedOrigin,
    statements: args.statements
  })
}

export async function deleteContentProjections(args: {
  db: Db
  contentId: string
  projectionScope: ProjectionScope
  statements?: DbStatement[]
}) {
  const owner = and(
    eq(contentRef.contentId, args.contentId),
    eq(contentRef.projectionScope, args.projectionScope)
  )
  await executeDbStatement(args.db.delete(contentListing).where(and(
    eq(contentListing.contentId, args.contentId),
    eq(contentListing.projectionScope, args.projectionScope)
  )), args.statements)
  await executeDbStatement(args.db.delete(contentSearchData).where(and(
    eq(contentSearchData.contentId, args.contentId),
    eq(contentSearchData.projectionScope, args.projectionScope)
  )), args.statements)
  await executeDbStatement(args.db.delete(contentRef).where(owner), args.statements)
  await executeDbStatement(args.db.delete(contentRefList).where(and(
    eq(contentRefList.ownerContentId, args.contentId),
    eq(contentRefList.projectionScope, args.projectionScope)
  )), args.statements)
  await executeDbStatement(args.db.delete(documentAssetRef).where(and(
    eq(documentAssetRef.documentKind, 'content'),
    eq(documentAssetRef.documentId, args.contentId),
    eq(documentAssetRef.projectionScope, args.projectionScope)
  )), args.statements)
}
