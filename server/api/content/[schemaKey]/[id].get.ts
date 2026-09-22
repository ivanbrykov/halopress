import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../../db/db'
import { parseContentJson } from '../../../cms/content-json'
import { applyLifecyclePublicDeliveryHeaders, applyPrivateDeliveryHeaders, normalizeDeliveryStatus, resolveDeliveryPolicy } from '../../../utils/delivery-policy'
import { notFound } from '../../../utils/http'
import { content as contentTable, contentListing as contentListingTable } from '../../../db/schema'
import { buildContentListingSnapshot } from '../../../cms/content-listing'
import { getSchemaVersion } from '../../../cms/repo'
import { getPublicationRevision, publicationMetadata } from '../../../cms/publication'
import { hasStandalonePageRouteClaim, standalonePageRouteIsUnclaimed } from '../../../cms/page-delivery'
import { PUBLIC_PAGE_ROUTE_PREFIX } from '../../../../shared/public-routing'
import { parsePublicSeoJson } from '../../../../shared/public-seo'
import { getCanonicalPublicRoute } from '../../../cms/public-routes'
import {
  applyPortablePublicEnvelopeHeaders
} from '../../../utils/portable-content-delivery'
import { createStandaloneStructuredRenderingForEvent } from '../../../utils/standalone-document-renderer'

export default defineEventHandler(async (event) => {
  const schemaKey = event.context.params?.schemaKey as string
  const id = event.context.params?.id as string
  const q = getQuery(event)
  const includeSurroundings = ['1', 'true'].includes(String(q.surroundings ?? q.includeSurroundings ?? ''))
  const includeSchema = ['1', 'true'].includes(String(q.includeSchema ?? ''))
  const includeRendering = q.rendering !== '0'
  const order = q.order === 'asc' ? 'asc' : 'desc'

  const policy = await resolveDeliveryPolicy(event, schemaKey, { requestedStatus: q.status })
  const db = await getDb(event)
  const respectStandalonePageClaims = schemaKey === PUBLIC_PAGE_ROUTE_PREFIX && q.routeScope === 'public-page'
  if (respectStandalonePageClaims && await hasStandalonePageRouteClaim(db, id)) {
    throw notFound('Content not found')
  }
  const row = await db
    .select()
    .from(contentTable)
    .where(and(eq(contentTable.schemaKey, schemaKey), eq(contentTable.id, id)))
    .get()

  if (!row) throw notFound('Content not found')

  const usePublished = policy.isPublic || q.status === 'published'
  const revision = usePublished
    ? await getPublicationRevision(db, 'content', row.id, row.publishedRevisionId)
    : null
  if (usePublished && !revision) throw notFound('Content not found')
  if (policy.isPublic) applyLifecyclePublicDeliveryHeaders(event)
  else applyPrivateDeliveryHeaders(event)

  const sourceContentJson = revision?.contentJson ?? row.contentJson
  const sourceSchemaVersion = revision?.schemaVersion ?? row.schemaVersion
  const sourceStatus = revision ? 'published' : row.status
  const sourceUpdatedAt = revision?.createdAt ?? row.updatedAt
  const projectionScope = revision ? 'published' : 'working'
  const content = parseContentJson(sourceContentJson)
  let sourceSchema: Awaited<ReturnType<typeof getSchemaVersion>> | null = null
  let item = await db
    .select({
      id: contentListingTable.contentId,
      schemaKey: contentListingTable.schemaKey,
      schemaVersion: contentListingTable.schemaVersion,
      title: contentListingTable.title,
      description: contentListingTable.description,
      image: contentListingTable.image,
      status: contentListingTable.status,
      createdAt: contentListingTable.createdAt,
      updatedAt: contentListingTable.updatedAt
    })
    .from(contentListingTable)
    .where(and(
      eq(contentListingTable.contentId, id),
      eq(contentListingTable.projectionScope, projectionScope)
    ))
    .get()

  if (!item) {
    sourceSchema = await getSchemaVersion(db, schemaKey, sourceSchemaVersion)
    if (!sourceSchema) throw notFound('Content not found')
    item = buildContentListingSnapshot({
      registry: sourceSchema.registry,
      content,
      contentId: row.id,
      schemaKey: row.schemaKey,
      schemaVersion: sourceSchemaVersion,
      status: sourceStatus,
      createdAt: row.createdAt,
      updatedAt: sourceUpdatedAt,
      projectionScope
    })
  }

  if (includeSchema && !sourceSchema) {
    sourceSchema = await getSchemaVersion(db, schemaKey, sourceSchemaVersion)
    if (!sourceSchema) throw notFound('Content not found')
  }

  if (!sourceSchema) {
    sourceSchema = await getSchemaVersion(db, schemaKey, sourceSchemaVersion)
    if (!sourceSchema) throw notFound('Content not found')
  }

  const publishedRoute = usePublished
    ? await getCanonicalPublicRoute(db, 'content', row.id)
    : null

  let surroundings: { prev: any; next: any } | undefined
  if (includeSurroundings) {
    const status = revision
      ? 'published'
      : normalizeDeliveryStatus({
          roleKey: policy.permission.roleKey,
          requestedStatus: q.status,
          defaultStatus: row.status
        })
    const baseUpdatedAt = item.updatedAt
    const baseId = item.contentId ?? item.id ?? row.id
    const whereParts = [
      eq(contentListingTable.schemaKey, schemaKey),
      eq(contentListingTable.projectionScope, projectionScope)
    ] as any[]
    if (respectStandalonePageClaims) {
      whereParts.push(standalonePageRouteIsUnclaimed(contentListingTable.contentId))
    }
    if (status) {
      whereParts.push(eq(contentListingTable.status, status))
    }

    const prevCondition = order === 'asc'
      ? or(
          lt(contentListingTable.updatedAt, baseUpdatedAt),
          and(eq(contentListingTable.updatedAt, baseUpdatedAt), lt(contentListingTable.contentId, baseId))
        )
      : or(
          gt(contentListingTable.updatedAt, baseUpdatedAt),
          and(eq(contentListingTable.updatedAt, baseUpdatedAt), gt(contentListingTable.contentId, baseId))
        )

    const nextCondition = order === 'asc'
      ? or(
          gt(contentListingTable.updatedAt, baseUpdatedAt),
          and(eq(contentListingTable.updatedAt, baseUpdatedAt), gt(contentListingTable.contentId, baseId))
        )
      : or(
          lt(contentListingTable.updatedAt, baseUpdatedAt),
          and(eq(contentListingTable.updatedAt, baseUpdatedAt), lt(contentListingTable.contentId, baseId))
        )

    const prev = await db
      .select({
        id: contentListingTable.contentId,
        schemaKey: contentListingTable.schemaKey,
        schemaVersion: contentListingTable.schemaVersion,
        title: contentListingTable.title,
        description: contentListingTable.description,
        image: contentListingTable.image,
        status: contentListingTable.status,
        createdAt: contentListingTable.createdAt,
        updatedAt: contentListingTable.updatedAt
      })
      .from(contentListingTable)
      .where(and(...whereParts, prevCondition))
      .orderBy(
        order === 'asc' ? desc(contentListingTable.updatedAt) : asc(contentListingTable.updatedAt),
        order === 'asc' ? desc(contentListingTable.contentId) : asc(contentListingTable.contentId)
      )
      .limit(1)

    const next = await db
      .select({
        id: contentListingTable.contentId,
        schemaKey: contentListingTable.schemaKey,
        schemaVersion: contentListingTable.schemaVersion,
        title: contentListingTable.title,
        description: contentListingTable.description,
        image: contentListingTable.image,
        status: contentListingTable.status,
        createdAt: contentListingTable.createdAt,
        updatedAt: contentListingTable.updatedAt
      })
      .from(contentListingTable)
      .where(and(...whereParts, nextCondition))
      .orderBy(
        order === 'asc' ? asc(contentListingTable.updatedAt) : desc(contentListingTable.updatedAt),
        order === 'asc' ? asc(contentListingTable.contentId) : desc(contentListingTable.contentId)
      )
      .limit(1)

    surroundings = { prev: prev[0] ?? null, next: next[0] ?? null }
  }

  const response = {
    id: row.id,
    schemaKey: row.schemaKey,
    schemaVersion: sourceSchemaVersion,
    title: item.title ?? null,
    status: sourceStatus,
    description: item.description ?? null,
    image: item.image ?? null,
    content,
    publicPath: row.publicPath ?? null,
    publishedPublicPath: publishedRoute?.path ?? null,
    seo: usePublished ? publishedRoute?.seo ?? null : parsePublicSeoJson(row.seoJson),
    ...(includeSchema ? { schema: sourceSchema } : {}),
    createdAt: row.createdAt,
    updatedAt: sourceUpdatedAt,
    ...(includeRendering
      ? {
          rendering: createStandaloneStructuredRenderingForEvent(
            event,
            content,
            sourceSchema.registry?.fields ?? []
          )
        }
      : {}),
    ...(policy.isPublic
      ? {
          publicationState: 'published',
          hasPublishedRevision: true,
          hasDraftChanges: false,
          publishedAt: row.publishedAt
        }
      : {
          ...publicationMetadata(row),
          revision: row.currentRevision,
          updatedBy: row.updatedBy ?? null,
          transitionAt: row.transitionAt ?? null,
          transitionBy: row.transitionBy ?? null,
          deletedAt: row.deletedAt ?? null,
          deletedBy: row.deletedBy ?? null,
          publishedBy: row.publishedBy ?? null
        })
  }
  const result = includeSurroundings ? { ...response, surroundings } : response
  if (policy.isPublic && applyPortablePublicEnvelopeHeaders(event, result)) return
  return result
})
