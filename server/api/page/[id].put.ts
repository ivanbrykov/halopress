import { eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { normalizePageContent } from '../../cms/page-content'
import { savePageWorking } from '../../cms/page-publication'
import { getDb } from '../../db/db'
import { page as pageTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { badRequest, notFound } from '../../utils/http'
import { requireExpectedRevision } from '../../cms/document-revisions'
import { assertDraftWriteStatus } from '../../cms/publication-transitions'
import { normalizePublicPath } from '../../../shared/public-routing'
import { normalizePublicSeoOverrides, parsePublicSeoJson } from '../../../shared/public-seo'
import { layoutAssignmentHttpError, prepareLayoutAssignmentChange } from '../../utils/layout-assignments'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = event.context.params?.id as string
  if (!id) throw notFound('Page not found')
  const body = await readBody<{ revision?: number, title?: string, status?: string, content?: unknown, publicPath?: string | null, seo?: unknown, layoutId?: string | null }>(event)
  assertDraftWriteStatus(body?.status)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await db.select().from(pageTable).where(eq(pageTable.id, id)).get()
  if (!existing) throw notFound('Page not found')

  const title = body?.title !== undefined ? body.title.trim() || null : existing.title
  const content = body?.content !== undefined ? normalizePageContent(body.content) : normalizePageContent(existing.contentJson)
  let publicPath = existing.publicPath
  let seo = parsePublicSeoJson(existing.seoJson)
  try {
    if (body?.publicPath !== undefined) publicPath = body.publicPath?.trim() ? normalizePublicPath(body.publicPath) : null
    if (body?.seo !== undefined) seo = normalizePublicSeoOverrides(body.seo)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid public metadata')
  }
  try {
    const layoutId = await prepareLayoutAssignmentChange({ event, db, body, currentLayoutId: existing.layoutId })
    const publication = await savePageWorking({
      event,
      db,
      existing,
      title,
      content,
      publicPath,
      seo,
      layoutId,
      actorId: (session.user as any)?.id ?? null,
      expectedRevision
    })
    return { ok: true, ...publication }
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }
})
