import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { PublicSeoOverrides } from '../../shared/public-seo'
import { legacyContentPath } from '../../shared/public-routing'

import type { Db } from '../db/db'
import { content as contentTable, contentListing as contentListingTable, publicationRevision } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import { replaceBase64ImagesInContent } from '../utils/asset-data-url'
import { conflict, notFound } from '../utils/http'
import { newId } from '../utils/ids'
import { getTrustedRequestOrigin } from '../utils/request-origin'
import { queueFullTextReconcile } from '../utils/full-text-queue'
import { parseContentJson } from './content-json'
import { deleteContentProjections, syncContentProjections } from './content-projections'
import { mutateWithDocumentRevision } from './document-revisions'
import { getPublicationRevision, publicationMetadata, publicationRevisionValues } from './publication'
import { assertEditorialTransition } from './publication-transitions'
import {
  bumpFullTextQueryEpoch,
  enqueueContentFullTextRemoval,
  enqueuePublishedContentFullText
} from './full-text-jobs'
import { contentCanonicalPath, getCanonicalPublicRoute, publishCanonicalRoute } from './public-routes'
import { getSchemaVersion } from './repo'
import type { SchemaRegistry } from './types'

type ActiveContentSchema = {
  version: number
  registry: SchemaRegistry
}

function asDate(value: Date | number | string) {
  return value instanceof Date ? value : new Date(value)
}

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

export async function saveContentWorking(args: {
  event: H3Event
  db: Db
  existing: any
  schemaKey: string
  active: ActiveContentSchema
  content: Record<string, unknown>
  seo?: PublicSeoOverrides | null
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'save')
  const status = args.existing.status === 'published' ? 'draft' : args.existing.status
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.schemaKey,
    action: 'save',
    state: {
      snapshot: args.content,
      status,
      schemaVersion: args.active.version
    },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await replaceBase64ImagesInContent({
        event: args.event,
        db: tx,
        createdBy: args.actorId,
        content: args.content,
        statements
      })
      await executeDbStatement(tx.update(contentTable).set({
        status,
        contentJson: JSON.stringify(args.content),
        seoJson: args.seo ? JSON.stringify(args.seo) : null,
        schemaVersion: args.active.version,
        currentRevision: nextRevision,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncContentProjections({
        db: tx,
        registry: args.active.registry,
        content: args.content,
        contentId: args.existing.id,
        schemaKey: args.schemaKey,
        schemaVersion: args.active.version,
        status,
        createdAt: asDate(args.existing.createdAt),
        updatedAt: now,
        projectionScope: 'working',
        trustedOrigin: getTrustedRequestOrigin(args.event),
        additionalAssetIds: args.seo?.imageAssetId ? [args.seo.imageAssetId] : [],
        statements
      })
    }
  })
  return mutationMetadata(args.existing, args.expectedRevision, {
    status,
    updatedBy: args.actorId,
    updatedAt
  })
}

export async function publishContentWorking(args: {
  event: H3Event
  db: Db
  existing: any
  schemaKey: string
  active: ActiveContentSchema
  content: Record<string, unknown>
  seo?: PublicSeoOverrides | null
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'publish')
  const revisionId = newId()
  const publicPath = contentCanonicalPath({
    schemaKey: args.schemaKey,
    contentId: args.existing.id,
    content: args.content,
    registry: args.active.registry
  })
  let publishedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.schemaKey,
    action: 'publish',
    state: {
      snapshot: args.content,
      status: 'published',
      schemaVersion: args.active.version
    },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      publishedAt = now
      await replaceBase64ImagesInContent({
        event: args.event,
        db: tx,
        createdBy: args.actorId,
        content: args.content,
        statements
      })
      await executeDbStatement(tx.insert(publicationRevision).values(publicationRevisionValues({
        id: revisionId,
        documentKind: 'content',
        documentId: args.existing.id,
        schemaKey: args.schemaKey,
        schemaVersion: args.active.version,
        content: args.content,
        createdBy: args.actorId,
        createdAt: now
      })), statements)
      await executeDbStatement(tx.update(contentTable).set({
        status: 'published',
        contentJson: JSON.stringify(args.content),
        publicPath,
        seoJson: args.seo ? JSON.stringify(args.seo) : null,
        schemaVersion: args.active.version,
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
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)

      for (const projectionScope of ['working', 'published'] as const) {
        await syncContentProjections({
          db: tx,
          registry: args.active.registry,
          content: args.content,
          contentId: args.existing.id,
          schemaKey: args.schemaKey,
          schemaVersion: args.active.version,
          status: 'published',
          createdAt: asDate(args.existing.createdAt),
          updatedAt: now,
          projectionScope,
          trustedOrigin: getTrustedRequestOrigin(args.event),
          additionalAssetIds: args.seo?.imageAssetId ? [args.seo.imageAssetId] : [],
          statements
        })
      }
      await publishCanonicalRoute({
        db: tx,
        statements,
        documentKind: 'content',
        documentId: args.existing.id,
        schemaKey: args.schemaKey,
        path: publicPath,
        legacyPath: legacyContentPath(args.schemaKey, args.existing.id),
        seo: args.seo ?? null,
        now
      })
      await enqueuePublishedContentFullText({
        db: tx,
        statements,
        documentId: args.existing.id,
        schemaKey: args.schemaKey,
        schemaVersion: args.active.version,
        revisionId,
        registry: args.active.registry,
        now
      })
      await bumpFullTextQueryEpoch({ db: tx, statements, now })
    }
  })
  queueFullTextReconcile(args.event)
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

export async function discardContentWorking(args: {
  event: H3Event
  db: Db
  existing: any
  schemaKey: string
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'discard')
  const revision = await getPublicationRevision(
    args.db,
    'content',
    args.existing.id,
    args.existing.publishedRevisionId
  )
  if (!revision) throw conflict('No published revision to restore')
  const version = await getSchemaVersion(args.db, args.schemaKey, revision.schemaVersion)
  if (!version?.registry) throw notFound('Published schema not found')
  const content = parseContentJson(revision.contentJson)
  const route = await getCanonicalPublicRoute(args.db, 'content', args.existing.id)
  let updatedAt = new Date()

  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.schemaKey,
    action: 'discard',
    state: {
      snapshot: content,
      status: 'published',
      schemaVersion: revision.schemaVersion
    },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(contentTable).set({
        status: 'published',
        contentJson: revision.contentJson,
        publicPath: route?.path ?? args.existing.publicPath ?? null,
        seoJson: route?.seo ? JSON.stringify(route.seo) : null,
        schemaVersion: revision.schemaVersion,
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        updatedBy: args.actorId,
        updatedAt: now
      }).where(and(
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncContentProjections({
        db: tx,
        registry: version.registry!,
        content,
        contentId: args.existing.id,
        schemaKey: args.schemaKey,
        schemaVersion: revision.schemaVersion,
        status: 'published',
        createdAt: asDate(args.existing.createdAt),
        updatedAt: now,
        projectionScope: 'working',
        trustedOrigin: getTrustedRequestOrigin(args.event),
        additionalAssetIds: route?.seo?.imageAssetId ? [route.seo.imageAssetId] : [],
        statements
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

export async function unpublishContent(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'archive')
  let updatedAt = new Date()
  const content = parseContentJson(args.existing.contentJson)
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.existing.schemaKey,
    action: 'archive',
    state: {
      snapshot: content,
      status: 'archived',
      schemaVersion: args.existing.schemaVersion
    },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(contentTable).set({
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
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await executeDbStatement(tx.update(contentListingTable).set({
        status: 'archived',
        updatedAt: now
      }).where(and(
        eq(contentListingTable.contentId, args.existing.id),
        eq(contentListingTable.projectionScope, 'working')
      )), statements)
      await deleteContentProjections({
        db: tx,
        contentId: args.existing.id,
        projectionScope: 'published',
        statements
      })
      await enqueueContentFullTextRemoval({
        db: tx,
        statements,
        documentId: args.existing.id,
        schemaKey: args.existing.schemaKey,
        sourceRevision: nextRevision,
        targetRevisionId: args.existing.publishedRevisionId,
        now
      })
      await bumpFullTextQueryEpoch({ db: tx, statements, now })
    }
  })
  queueFullTextReconcile(args.event)
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

export async function deleteContent(args: {
  event: H3Event
  db: Db
  existing: any
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'delete')
  const content = parseContentJson(args.existing.contentJson)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.existing.schemaKey,
    action: 'delete',
    state: { snapshot: content, status: 'deleted', schemaVersion: args.existing.schemaVersion },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(contentTable).set({
        status: 'deleted',
        currentRevision: nextRevision,
        publishedRevisionId: null,
        publishedAt: null,
        publishedBy: null,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: now,
        deletedBy: args.actorId,
        updatedAt: now,
        updatedBy: args.actorId
      }).where(and(
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await executeDbStatement(tx.update(contentListingTable).set({ status: 'deleted', updatedAt: now }).where(and(
        eq(contentListingTable.contentId, args.existing.id),
        eq(contentListingTable.projectionScope, 'working')
      )), statements)
      await deleteContentProjections({ db: tx, contentId: args.existing.id, projectionScope: 'published', statements })
      await enqueueContentFullTextRemoval({
        db: tx,
        statements,
        documentId: args.existing.id,
        schemaKey: args.existing.schemaKey,
        sourceRevision: nextRevision,
        targetRevisionId: args.existing.publishedRevisionId,
        now
      })
      await bumpFullTextQueryEpoch({ db: tx, statements, now })
    }
  })
  queueFullTextReconcile(args.event)
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

export async function recoverContent(args: {
  event: H3Event
  db: Db
  existing: any
  registry: SchemaRegistry
  actorId: string | null
  expectedRevision: number
}) {
  assertEditorialTransition(args.existing.status, 'recover')
  const content = parseContentJson(args.existing.contentJson)
  let updatedAt = new Date()
  await mutateWithDocumentRevision({
    event: args.event,
    db: args.db,
    identity: args.existing,
    expectedRevision: args.expectedRevision,
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.existing.schemaKey,
    action: 'recover',
    state: { snapshot: content, status: 'draft', schemaVersion: args.existing.schemaVersion },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(contentTable).set({
        status: 'draft',
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
        updatedBy: args.actorId
      }).where(and(
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncContentProjections({
        db: tx,
        registry: args.registry,
        content,
        contentId: args.existing.id,
        schemaKey: args.existing.schemaKey,
        schemaVersion: args.existing.schemaVersion,
        status: 'draft',
        createdAt: asDate(args.existing.createdAt),
        updatedAt: now,
        projectionScope: 'working',
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

export async function restoreContentRevision(args: {
  event: H3Event
  db: Db
  existing: any
  schemaKey: string
  schemaVersion: number
  registry: SchemaRegistry
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
    documentKind: 'content',
    documentId: args.existing.id,
    schemaKey: args.schemaKey,
    action: 'restore',
    state: { snapshot: args.content, status: 'draft', schemaVersion: args.schemaVersion },
    actorId: args.actorId,
    work: async (tx, statements, nextRevision, now) => {
      updatedAt = now
      await executeDbStatement(tx.update(contentTable).set({
        status: 'draft',
        contentJson: JSON.stringify(args.content),
        schemaVersion: args.schemaVersion,
        currentRevision: nextRevision,
        transitionAt: now,
        transitionBy: args.actorId,
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
        updatedBy: args.actorId
      }).where(and(
        eq(contentTable.id, args.existing.id),
        eq(contentTable.currentRevision, args.expectedRevision)
      )), statements)
      await syncContentProjections({
        db: tx,
        registry: args.registry,
        content: args.content,
        contentId: args.existing.id,
        schemaKey: args.schemaKey,
        schemaVersion: args.schemaVersion,
        status: 'draft',
        createdAt: asDate(args.existing.createdAt),
        updatedAt: now,
        projectionScope: 'working',
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
