import { eq } from 'drizzle-orm'

import { getDb } from '../../db/db'
import { page as pageTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { notFound } from '../../utils/http'
import { getPublicationRevision, publicationMetadata } from '../../cms/publication'
import { getCanonicalPublicPath } from '../../cms/public-routes'
import { parsePublicSeoJson } from '../../../shared/public-seo'
import { parseStoredPageContent } from '../../cms/page-content'

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = event.context.params?.id as string
  if (!id) throw notFound('Page not found')

  const db = await getDb(event)
  const row = await db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      status: pageTable.status,
      contentJson: pageTable.contentJson,
      publicPath: pageTable.publicPath,
      seoJson: pageTable.seoJson,
      layoutId: pageTable.layoutId,
      currentRevision: pageTable.currentRevision,
      publishedRevisionId: pageTable.publishedRevisionId,
      firstPublishedAt: pageTable.firstPublishedAt,
      publishedAt: pageTable.publishedAt,
      publishedBy: pageTable.publishedBy,
      transitionAt: pageTable.transitionAt,
      transitionBy: pageTable.transitionBy,
      deletedAt: pageTable.deletedAt,
      deletedBy: pageTable.deletedBy,
      updatedBy: pageTable.updatedBy,
      createdAt: pageTable.createdAt,
      updatedAt: pageTable.updatedAt
    })
    .from(pageTable)
    .where(eq(pageTable.id, id))
    .get()

  if (!row) throw notFound('Page not found')

  const content = parseStoredPageContent(row.contentJson) ?? emptyDoc

  const { publishedRevisionId: _publishedRevisionId, firstPublishedAt: _firstPublishedAt, ...safeRow } = row
  const { currentRevision, ...rest } = safeRow
  const publishedPublicPath = row.publishedRevisionId
    ? await getCanonicalPublicPath(db, 'page', row.id)
    : null
  const publishedRevision = await getPublicationRevision(db, 'page', row.id, row.publishedRevisionId)
  return {
    ...rest,
    revision: currentRevision,
    content,
    seo: parsePublicSeoJson(row.seoJson),
    publishedPublicPath,
    publishedLayoutId: publishedRevision?.layoutId ?? null,
    ...publicationMetadata(row)
  }
})
