import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { getRouterParam, readBody } from 'h3'

import { siteMenuDocumentSchema, siteMenuIdSchema, type SiteMenuPreviewResponse } from '../../../../../shared/site-menu'
import { getDb } from '../../../../db/db'
import {
  page as pageTable,
  publicationRevision as publicationRevisionTable,
  publicRoute as publicRouteTable,
  siteMenuSet as siteMenuSetTable
} from '../../../../db/schema'
import { requireAdmin } from '../../../../utils/auth'
import { applyPreviewDeliveryHeaders } from '../../../../utils/delivery-policy'
import { badRequest, notFound } from '../../../../utils/http'
import { resolvePublicMenuDocument } from '../../../../utils/site-menus'

export default defineEventHandler(async (event): Promise<SiteMenuPreviewResponse> => {
  applyPreviewDeliveryHeaders(event)
  await requireAdmin(event)
  const menuId = siteMenuIdSchema.safeParse(getRouterParam(event, 'menuId'))
  if (!menuId.success) throw badRequest('Invalid menu set ID')
  const body = await readBody<{ document?: unknown, examplePageId?: unknown }>(event)
  const document = siteMenuDocumentSchema.safeParse(body?.document)
  if (!document.success) {
    throw badRequest('Invalid menu document', {
      issues: document.error.issues.map(issue => ({
        path: ['document', ...issue.path].map(String).join('.'),
        message: issue.message
      }))
    })
  }

  const db = await getDb(event)
  const menu = await db.select({ id: siteMenuSetTable.id, name: siteMenuSetTable.name })
    .from(siteMenuSetTable).where(eq(siteMenuSetTable.id, menuId.data)).get()
  if (!menu) throw notFound('Menu set not found')

  const examplePageId = typeof body?.examplePageId === 'string' && body.examplePageId.trim()
    ? body.examplePageId.trim()
    : null
  const page = examplePageId
    ? await db.select({ id: pageTable.id, path: publicRouteTable.path })
      .from(publicRouteTable)
      .innerJoin(pageTable, eq(pageTable.id, publicRouteTable.documentId))
      .innerJoin(publicationRevisionTable, and(
        eq(publicationRevisionTable.id, pageTable.publishedRevisionId),
        eq(publicationRevisionTable.documentKind, 'page'),
        eq(publicationRevisionTable.documentId, pageTable.id)
      )).where(and(
        eq(pageTable.id, examplePageId),
        eq(publicRouteTable.routeKind, 'canonical'),
        eq(publicRouteTable.documentKind, 'page'),
        ne(pageTable.status, 'deleted'),
        isNotNull(pageTable.publishedRevisionId)
      )).get()
    : null
  if (examplePageId && !page) throw badRequest('The example Page is no longer publicly available')

  const context = page
    ? {
        visibility: 'preview' as const,
        documentKind: 'page' as const,
        documentId: page.id,
        schemaKey: null,
        schemaVersion: null,
        canonicalPath: page.path
      }
    : {
        visibility: 'preview' as const,
        documentKind: 'schema' as const,
        documentId: 'menu-preview',
        schemaKey: null,
        schemaVersion: null,
        canonicalPath: null
      }
  const resolved = await resolvePublicMenuDocument(event, document.data, context)
  return {
    menu: { id: menu.id, name: menu.name, document: resolved.document },
    digest: resolved.digest,
    context: page ? { pageId: page.id, canonicalPath: page.path } : null,
    diagnostics: resolved.diagnostics
  }
})
