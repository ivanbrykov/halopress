import { and, eq, or } from 'drizzle-orm'
import type { H3Event } from 'h3'

import { getDb } from '../db/db'
import { content as contentTable, documentAssetRef, schemaActive } from '../db/schema'
import { getAuthSession } from './auth'
import { applyLifecyclePublicDeliveryHeaders, applyPrivateDeliveryHeaders } from './delivery-policy'
import { conflict, notFound } from './http'
import { applyPortablePublicResourceHeaders } from './portable-content-delivery'

export async function assertAssetIsNotRetained(db: Awaited<ReturnType<typeof getDb>>, assetId: string) {
  const retainedBy = await db
    .select({ documentId: documentAssetRef.documentId })
    .from(documentAssetRef)
    .where(eq(documentAssetRef.assetId, assetId))
    .limit(1)
  if (retainedBy[0]) throw conflict('Asset is referenced by a working or published document')
}

export async function assertAssetIsNotPublished(db: Awaited<ReturnType<typeof getDb>>, assetId: string) {
  const retainedBy = await db
    .select({ documentId: documentAssetRef.documentId })
    .from(documentAssetRef)
    .where(and(
      eq(documentAssetRef.assetId, assetId),
      eq(documentAssetRef.projectionScope, 'published')
    ))
    .limit(1)
  if (retainedBy[0]) throw conflict('Asset is referenced by a published document')
}

export async function requireAssetDelivery(event: H3Event, assetId: string) {
  const session = await getAuthSession(event)
  if (session?.user && session.user.accountType !== 'member') {
    applyPrivateDeliveryHeaders(event)
    return { isPublic: false }
  }

  const db = await getDb(event)
  const publishedRef = await db.select({ assetId: documentAssetRef.assetId })
    .from(documentAssetRef)
    .leftJoin(contentTable, and(
      eq(documentAssetRef.documentKind, 'content'),
      eq(documentAssetRef.documentId, contentTable.id)
    ))
    .leftJoin(schemaActive, and(
      eq(schemaActive.schemaKey, contentTable.schemaKey),
      eq(schemaActive.status, 'active')
    ))
    .where(and(
      eq(documentAssetRef.assetId, assetId),
      eq(documentAssetRef.projectionScope, 'published'),
      or(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentKind, 'settings'),
        and(eq(documentAssetRef.documentKind, 'content'), eq(schemaActive.status, 'active'))
      )
    ))
    .limit(1)
  if (!publishedRef[0]) throw notFound('Asset not found')
  applyLifecyclePublicDeliveryHeaders(event)
  applyPortablePublicResourceHeaders(event)
  return { isPublic: true }
}
