import { eq, sql, type SQLWrapper } from 'drizzle-orm'

import type { Db } from '../db/db'
import { page } from '../db/schema'
import { notFound } from '../utils/http'
import { parseStoredPageContent } from './page-content'
import { getPublicationRevision } from './publication'

export async function hasStandalonePageRouteClaim(db: Db, id: string) {
  const row = await db.select({ id: page.id }).from(page).where(eq(page.id, id)).get()
  return Boolean(row)
}

export function standalonePageRouteIsUnclaimed(idColumn: SQLWrapper) {
  return sql`not exists (select 1 from ${page} where ${page.id} = ${idColumn})`
}

export async function getPublishedPage(db: Db, id: string) {
  const row = await db.select().from(page).where(eq(page.id, id)).get()
  if (!row || row.status === 'deleted' || !row.publishedRevisionId) throw notFound('Page not found')
  const revision = await getPublicationRevision(db, 'page', row.id, row.publishedRevisionId)
  if (!revision) throw notFound('Page not found')
  return {
    id: row.id,
    title: revision.title,
    status: 'published' as const,
    content: parseStoredPageContent(revision.contentJson),
    publishedAt: row.publishedAt
  }
}
