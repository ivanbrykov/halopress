import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { legacyPagePath } from '../../shared/public-routing'
import type { PublicSeoOverrides } from '../../shared/public-seo'

import type { Db } from '../db/db'
import { documentAssetRef, page as pageTable, publicationRevision } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import { conflict } from '../utils/http'
import { newId } from '../utils/ids'
import { getTrustedRequestOrigin } from '../utils/request-origin'
import {
  pageLayoutAssignmentOwner,
  syncLayoutAssignmentReference
} from '../utils/layout-assignments'
import { syncDocumentAssetRefs } from './asset-refs'
import { mutateWithDocumentRevision } from './document-revisions'
import { normalizePageContent } from './page-content'
import { getPublicationRevision, publicationMetadata, publicationRevisionValues } from './publication'
import { assertEditorialTransition } from './publication-transitions'
import { getCanonicalPublicRoute, pageCanonicalPath, publishCanonicalRoute } from './public-routes'

function mutationMetadata(existing: any, expectedRevision: number, overrides: Record<string, unknown>) {
  const identity = { ...existing, ...overrides }
  return {
    ...publicationMetadata(identity),
    revision: expectedRevision + 1,
    updatedAt: identity.updatedAt ?? null,
    updatedBy: identity.updatedBy ?? null,
    transitionAt: identity.transitionAt ?? null,
    transitionBy: identity.transitionBy ?? null,
    deletedAt: identity.deletedAt ?? null,
    deletedBy: identity.deletedBy ?? null
  }
}

export async function savePageWorking(args: {
  event: H3Event
  db: Db
  existing: any
  title: string | null
  content: Record<string, unknown>
  publicPath?: string | null
  seo?: PublicSeoOverrides | null
  layoutId?: string | null
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'save')
  const layoutId = args.layoutId === undefined ? args.existing.layoutId ?? null : args.layoutId
  const status = args.existing.status === 'published' ? 'draft' : args.existing.status
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'save',
    state: { snapshot: args.content, status, title: args.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        title: args.title,
        status,
        contentJson: JSON.stringify(args.content),
        publicPath: args.publicPath ?? null,
        seoJson: args.seo ? JSON.stringify(args.seo) : null,
        layoutId,
        currentRevision: nextRevision,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncDocumentAssetRefs({
        db: tx,
        documentKind: 'page',
        documentId: args.existing.id,
        projectionScope: 'working',
        content: args.content,
        additionalAssetIds: args.seo?.imageAssetId ? [args.seo.imageAssetId] : [],
        trustedOrigin: getTrustedRequestOrigin(args.event),
        statements
      })
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: pageLayoutAssignmentOwner(args.existing.id, 'working', args.title),
        layoutId,
        now
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status,
    updatedBy: args.actorId,
    updatedAt
  })
}

export async function publishPageWorking(args: {
  event: H3Event
  db: Db
  existing: any
  title: string | null
  content: Record<string, unknown>
  publicPath?: string | null
  seo?: PublicSeoOverrides | null
  layoutId?: string | null
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'publish')
  const layoutId = args.layoutId === undefined ? args.existing.layoutId ?? null : args.layoutId
  const revisionId = newId()
  const publicPath = pageCanonicalPath({
    pageId: args.existing.id,
    requestedPath: args.publicPath,
    title: args.title
  })
  let publishedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'publish',
    state: { snapshot: args.content, status: 'published', title: args.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      publishedAt = now
      await executeDbStatement(tx.insert(publicationRevision).values(publicationRevisionValues({
        id: revisionId,
        documentKind: 'page',
        documentId: args.existing.id,
        title: args.title,
        content: args.content,
        layoutId,
        createdBy: args.actorId,
        createdAt: now
      })), statements)
      await executeDbStatement(tx.update(pageTable).set({
        title: args.title,
        status: 'published',
        contentJson: JSON.stringify(args.content),
        publicPath,
        seoJson: args.seo ? JSON.stringify(args.seo) : null,
        layoutId,
        currentRevision: nextRevision,
        publishedRevisionId: revisionId,
        firstPublishedAt: args.existing.firstPublishedAt ?? now,
        publishedAt: now,
        publishedBy: args.actorId,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: null,
        deletedBy: null,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      for (const projectionScope of ['working', 'published'] as const) {
        await syncDocumentAssetRefs({
          db: tx,
          documentKind: 'page',
          documentId: args.existing.id,
          projectionScope,
          content: args.content,
          additionalAssetIds: args.seo?.imageAssetId ? [args.seo.imageAssetId] : [],
          trustedOrigin: getTrustedRequestOrigin(args.event),
          statements
        })
      }
      for (const slot of ['working', 'published'] as const) {
        await syncLayoutAssignmentReference({
          db: tx,
          statements,
          owner: pageLayoutAssignmentOwner(args.existing.id, slot, args.title),
          layoutId,
          now
        })
      }
      await publishCanonicalRoute({
        db: tx,
        statements,
        documentKind: 'page',
        documentId: args.existing.id,
        path: publicPath,
        legacyPath: legacyPagePath(args.existing.id),
        seo: args.seo ?? null,
        now
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'published',
    publicPath,
    publishedRevisionId: revisionId,
    firstPublishedAt: args.existing.firstPublishedAt ?? publishedAt,
    publishedAt,
    publishedBy: args.actorId,
    transitionAt: publishedAt,
    transitionBy: args.actorId,
    deletedAt: null,
    deletedBy: null,
    updatedAt: publishedAt,
    updatedBy: args.actorId
  })
}

export async function discardPageWorking(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'discard')
  const revision = await getPublicationRevision(args.db, 'page', args.existing.id, args.existing.publishedRevisionId)
  if (!revision) throw conflict('No published revision to restore')
  const content = normalizePageContent(revision.contentJson)
  const route = await getCanonicalPublicRoute(args.db, 'page', args.existing.id)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'discard',
    state: { snapshot: content, status: 'published', title: revision.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        title: revision.title,
        status: 'published',
        contentJson: revision.contentJson,
        publicPath: route?.path ?? args.existing.publicPath ?? null,
        seoJson: route?.seo ? JSON.stringify(route.seo) : null,
        layoutId: revision.layoutId ?? null,
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncDocumentAssetRefs({
        db: tx,
        documentKind: 'page',
        documentId: args.existing.id,
        projectionScope: 'working',
        content,
        additionalAssetIds: route?.seo?.imageAssetId ? [route.seo.imageAssetId] : [],
        trustedOrigin: getTrustedRequestOrigin(args.event),
        statements
      })
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: pageLayoutAssignmentOwner(args.existing.id, 'working', revision.title),
        layoutId: revision.layoutId ?? null,
        now
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'published',
    publicPath: route?.path ?? args.existing.publicPath ?? null,
    transitionAt: updatedAt,
    transitionBy: args.actorId,
    updatedAt,
    updatedBy: args.actorId
  })
}

export async function unpublishPage(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'archive')
  const content = normalizePageContent(args.existing.contentJson)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'archive',
    state: { snapshot: content, status: 'archived', title: args.existing.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        status: 'archived',
        currentRevision: nextRevision,
        publishedRevisionId: null,
        publishedAt: null,
        publishedBy: null,
        transitionAt: now,
        transitionBy: args.actorId,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await executeDbStatement(tx.delete(documentAssetRef).where(and(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentId, args.existing.id),
        eq(documentAssetRef.projectionScope, 'published')
      )), statements)
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: pageLayoutAssignmentOwner(args.existing.id, 'published', args.existing.title),
        layoutId: null,
        now
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'archived',
    publishedRevisionId: null,
    publishedAt: null,
    publishedBy: null,
    transitionAt: updatedAt,
    transitionBy: args.actorId,
    updatedAt,
    updatedBy: args.actorId
  })
}

export async function deletePage(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'delete')
  const content = normalizePageContent(args.existing.contentJson)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'delete',
    state: { snapshot: content, status: 'deleted', title: args.existing.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        status: 'deleted',
        currentRevision: nextRevision,
        publishedRevisionId: null,
        publishedAt: null,
        publishedBy: null,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: now,
        deletedBy: args.actorId,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await executeDbStatement(tx.delete(documentAssetRef).where(and(
        eq(documentAssetRef.documentKind, 'page'),
        eq(documentAssetRef.documentId, args.existing.id),
        eq(documentAssetRef.projectionScope, 'published')
      )), statements)
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: pageLayoutAssignmentOwner(args.existing.id, 'published', args.existing.title),
        layoutId: null,
        now
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'deleted',
    publishedRevisionId: null,
    publishedAt: null,
    publishedBy: null,
    transitionAt: updatedAt,
    transitionBy: args.actorId,
    deletedAt: updatedAt,
    deletedBy: args.actorId,
    updatedAt,
    updatedBy: args.actorId
  })
}

export async function recoverPage(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'recover')
  const content = normalizePageContent(args.existing.contentJson)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'recover',
    state: { snapshot: content, status: 'draft', title: args.existing.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        status: 'draft',
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: null,
        deletedBy: null,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncDocumentAssetRefs({
        db: tx,
        documentKind: 'page',
        documentId: args.existing.id,
        projectionScope: 'working',
        content,
        trustedOrigin: getTrustedRequestOrigin(args.event),
        statements
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'draft',
    transitionAt: updatedAt,
    transitionBy: args.actorId,
    deletedAt: null,
    deletedBy: null,
    updatedAt,
    updatedBy: args.actorId
  })
}

export async function restorePageRevision(args: {
  event: H3Event
  db: Db
  existing: any
  title: string | null
  content: Record<string, unknown>
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'restore')
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'page',
    documentId: args.existing.id,
    action: 'restore',
    state: { snapshot: args.content, status: 'draft', title: args.title },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(pageTable).set({
        title: args.title,
        status: 'draft',
        contentJson: JSON.stringify(args.content),
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: null,
        deletedBy: null,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(pageTable.id, args.existing.id),
        eq(pageTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncDocumentAssetRefs({
        db: tx,
        documentKind: 'page',
        documentId: args.existing.id,
        projectionScope: 'working',
        content: args.content,
        trustedOrigin: getTrustedRequestOrigin(args.event),
        statements
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status: 'draft',
    transitionAt: updatedAt,
    transitionBy: args.actorId,
    deletedAt: null,
    deletedBy: null,
    updatedAt,
    updatedBy: args.actorId
  })
}
