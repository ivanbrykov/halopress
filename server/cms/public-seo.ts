import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

import { publicPathToHref } from '../../shared/public-routing'
import { SAFE_STRUCTURED_DATA_TYPES, type PublicSeoOverrides } from '../../shared/public-seo'
import type { Db } from '../db/db'
import {
  content as contentTable,
  contentListing as contentListingTable,
  page as pageTable
} from '../db/schema'
import { getTrustedRequestOrigin } from '../utils/request-origin'
import { getPublicSitePresentation } from '../utils/site-presentation-settings'
import { getPublishedSchema, getSchemaVersion } from './repo'
import type { PublicDocumentKind } from './public-routes'
import { getPublicationRevision } from './publication'

function absoluteUrl(value: string | null | undefined, origin: string) {
  if (!value) return undefined
  try {
    const url = new URL(value, origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

function safeStructuredDataType(value: unknown): PublicSeoOverrides['structuredDataType'] {
  return typeof value === 'string' && SAFE_STRUCTURED_DATA_TYPES.includes(value as any)
    ? value as PublicSeoOverrides['structuredDataType']
    : 'WebPage'
}

export type ResolvedPublicSeo = {
  title: string
  description: string
  canonicalUrl: string
  imageUrl?: string
  ogType: 'website' | 'article'
  structuredData: Record<string, unknown>
}

export async function resolvePublicSeo(args: {
  event: H3Event
  db: Db
  documentKind: PublicDocumentKind
  documentId: string
  schemaKey: string | null
  canonicalPath: string
  overrides: PublicSeoOverrides | null
}): Promise<ResolvedPublicSeo> {
  const site = await getPublicSitePresentation(args.event)
  const origin = getTrustedRequestOrigin(args.event) || 'http://localhost'
  const canonicalUrl = new URL(publicPathToHref(args.canonicalPath), origin).href
  let mappedTitle = ''
  let mappedDescription = ''
  let mappedImage: string | undefined
  let structuredDataType: PublicSeoOverrides['structuredDataType'] = 'WebPage'
  let publishedAt: Date | null = null
  let updatedAt: Date | null = null

  if (args.documentKind === 'schema') {
    const schema = await getPublishedSchema(args.db, args.documentId)
    mappedTitle = schema?.title || args.documentId
  } else if (args.documentKind === 'page') {
    const row = await args.db.select({
      publishedRevisionId: pageTable.publishedRevisionId,
      publishedAt: pageTable.publishedAt
    }).from(pageTable).where(eq(pageTable.id, args.documentId)).get()
    const revision = row?.publishedRevisionId
      ? await getPublicationRevision(args.db, 'page', args.documentId, row.publishedRevisionId)
      : null
    mappedTitle = revision?.title || ''
    publishedAt = row?.publishedAt ?? null
    updatedAt = row?.publishedAt ?? null
  } else {
    const row = await args.db.select({
      schemaVersion: contentListingTable.schemaVersion,
      publishedAt: contentTable.publishedAt,
      title: contentListingTable.title,
      description: contentListingTable.description,
      image: contentListingTable.image
    }).from(contentTable)
      .leftJoin(contentListingTable, and(
        eq(contentListingTable.contentId, contentTable.id),
        eq(contentListingTable.projectionScope, 'published')
      ))
      .where(eq(contentTable.id, args.documentId))
      .get()
    mappedTitle = row?.title || ''
    mappedDescription = row?.description || ''
    mappedImage = absoluteUrl(row?.image, origin)
    publishedAt = row?.publishedAt ?? null
    updatedAt = row?.publishedAt ?? null
    if (args.schemaKey && row?.schemaVersion) {
      const schema = await getSchemaVersion(args.db, args.schemaKey, row.schemaVersion)
      structuredDataType = safeStructuredDataType(schema?.registry?.presentation?.structuredDataType)
    }
  }

  const title = cleanText(args.overrides?.title || mappedTitle || site.general.siteName, 120)
  const description = cleanText(args.overrides?.description || mappedDescription || site.general.description, 320)
  const imageUrl = absoluteUrl(
    args.overrides?.imageAssetId ? `/assets/${encodeURIComponent(args.overrides.imageAssetId)}/raw` : mappedImage || site.general.socialImageUrl,
    origin
  )
  structuredDataType = safeStructuredDataType(args.overrides?.structuredDataType ?? structuredDataType)
  const structuredData: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': structuredDataType,
    name: title,
    ...(structuredDataType !== 'WebPage' ? { headline: title } : {}),
    description,
    url: canonicalUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(publishedAt ? { datePublished: publishedAt.toISOString() } : {}),
    ...(updatedAt ? { dateModified: updatedAt.toISOString() } : {})
  }

  return {
    title,
    description,
    canonicalUrl,
    imageUrl,
    ogType: ['Article', 'BlogPosting', 'NewsArticle'].includes(structuredDataType || '') ? 'article' : 'website',
    structuredData
  }
}
