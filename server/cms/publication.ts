import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/db'
import { publicationRevision } from '../db/schema'

export type PublicationDocumentKind = 'content' | 'page'
export type PublicationState = 'never-published' | 'published' | 'published-with-draft' | 'unpublished' | 'deleted'

export type PublicationIdentity = {
  status: string
  publishedRevisionId?: string | null
  firstPublishedAt?: Date | null
  publishedAt?: Date | null
}

export function getPublicationState(identity: PublicationIdentity): PublicationState {
  if (identity.status === 'deleted') return 'deleted'
  if (identity.publishedRevisionId) {
    return identity.status === 'published' ? 'published' : 'published-with-draft'
  }
  if (identity.firstPublishedAt) return 'unpublished'
  return 'never-published'
}

export function publicationMetadata(identity: PublicationIdentity) {
  const publicationState = getPublicationState(identity)
  return {
    publicationState,
    hasPublishedRevision: Boolean(identity.publishedRevisionId),
    hasDraftChanges: publicationState === 'published-with-draft',
    publishedAt: identity.publishedAt ?? null
  }
}

export function publicationRevisionValues(args: {
  id: string
  documentKind: PublicationDocumentKind
  documentId: string
  schemaKey?: string | null
  schemaVersion?: number | null
  title?: string | null
  content: unknown
  layoutId?: string | null
  createdBy?: string | null
  createdAt: Date
}) {
  return {
    id: args.id,
    documentKind: args.documentKind,
    documentId: args.documentId,
    schemaKey: args.schemaKey ?? null,
    schemaVersion: args.schemaVersion ?? null,
    title: args.title ?? null,
    contentJson: JSON.stringify(args.content),
    layoutId: args.layoutId ?? null,
    createdBy: args.createdBy ?? null,
    createdAt: args.createdAt
  }
}

export async function getPublicationRevision(
  db: Db,
  documentKind: PublicationDocumentKind,
  documentId: string,
  revisionId: string | null | undefined
) {
  if (!revisionId) return null
  return await db
    .select()
    .from(publicationRevision)
    .where(and(
      eq(publicationRevision.id, revisionId),
      eq(publicationRevision.documentKind, documentKind),
      eq(publicationRevision.documentId, documentId)
    ))
    .get()
}
