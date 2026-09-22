import { readBody } from 'h3'

import { normalizePageContent } from '../../cms/page-content'
import { syncDocumentAssetRefs } from '../../cms/asset-refs'
import { getDb } from '../../db/db'
import { page as pageTable } from '../../db/schema'
import { executeDbStatement, withDbTransaction } from '../../db/transaction'
import { createInitialDocumentRevision } from '../../cms/document-revisions'
import { assertDraftWriteStatus } from '../../cms/publication-transitions'
import { requireAdmin } from '../../utils/auth'
import { newId } from '../../utils/ids'
import { getTrustedRequestOrigin } from '../../utils/request-origin'
import { badRequest } from '../../utils/http'
import {
  layoutAssignmentHttpError,
  pageLayoutAssignmentOwner,
  prepareLayoutAssignmentChange,
  syncLayoutAssignmentReference
} from '../../utils/layout-assignments'
import { normalizePublicPath } from '../../../shared/public-routing'
import { normalizePublicSeoOverrides } from '../../../shared/public-seo'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const body = await readBody<{ title?: string, status?: string, content?: unknown, publicPath?: string | null, seo?: unknown, layoutId?: string | null }>(event)
  assertDraftWriteStatus(body?.status)
  const id = newId()
  const title = body?.title?.trim() || null
  const content = normalizePageContent(body?.content)
  let publicPath: string | null = null
  let seo = null
  try {
    publicPath = body?.publicPath?.trim() ? normalizePublicPath(body.publicPath) : null
    seo = body?.seo === undefined ? null : normalizePublicSeoOverrides(body.seo)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid public metadata')
  }
  const now = new Date()
  const status = 'draft'
  const actorId = (session.user as any)?.id ?? null
  const db = await getDb(event)

  try {
    const layoutId = await prepareLayoutAssignmentChange({ event, db, body, currentLayoutId: null })
    await withDbTransaction(event, db, async (tx: any, statements) => {
      await executeDbStatement(tx.insert(pageTable).values({
        id,
        title,
        status,
        contentJson: JSON.stringify(content),
        publicPath,
        seoJson: seo ? JSON.stringify(seo) : null,
        layoutId,
        currentRevision: 1,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now
      }), statements)
      await createInitialDocumentRevision({
        tx,
        statements,
        documentKind: 'page',
        documentId: id,
        state: { snapshot: content, status, title },
        actorId,
        createdAt: now
      })
      await syncDocumentAssetRefs({
        db: tx,
        documentKind: 'page',
        documentId: id,
        projectionScope: 'working',
        content,
        additionalAssetIds: seo?.imageAssetId ? [seo.imageAssetId] : [],
        trustedOrigin: getTrustedRequestOrigin(event),
        statements
      })
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: pageLayoutAssignmentOwner(id, 'working', title),
        layoutId,
        now
      })
    })
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }

  return {
    ok: true,
    id,
    revision: 1,
    publicationState: 'never-published',
    hasPublishedRevision: false,
    hasDraftChanges: false,
    publishedAt: null
  }
})
