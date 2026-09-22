import { desc, eq, ne } from 'drizzle-orm'
import { getQuery } from 'h3'

import { getDb } from '../../db/db'
import { page as pageTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { publicationMetadata } from '../../cms/publication'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const limit = Math.min(Number(q.limit ?? 50) || 50, 200)
  const status = typeof q.status === 'string' && q.status.length ? q.status : null

  const db = await getDb(event)
  let query = db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      status: pageTable.status,
      currentRevision: pageTable.currentRevision,
      publicPath: pageTable.publicPath,
      publishedRevisionId: pageTable.publishedRevisionId,
      firstPublishedAt: pageTable.firstPublishedAt,
      publishedAt: pageTable.publishedAt,
      createdAt: pageTable.createdAt,
      updatedAt: pageTable.updatedAt
    })
    .from(pageTable)
    .orderBy(desc(pageTable.updatedAt))
    .limit(limit)

  if (status) {
    query = query.where(eq(pageTable.status, status))
  } else {
    query = query.where(ne(pageTable.status, 'deleted'))
  }

  const rows = await query
  const items = rows.map((row: any) => {
    const {
      publishedRevisionId: _publishedRevisionId,
      firstPublishedAt: _firstPublishedAt,
      currentRevision,
      ...safeRow
    } = row
    return { ...safeRow, revision: currentRevision, ...publicationMetadata(row) }
  })
  return { items }
})
