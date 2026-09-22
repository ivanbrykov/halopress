import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, asc, desc, eq, isNotNull, ne, sql } from 'drizzle-orm'

import {
  extractAuthoredOutline,
  extractStructuredAuthoredOutline
} from '../../shared/authored-document'
import {
  LAYOUT_RENDERING_CONTRACT_VERSION,
  LAYOUT_RENDERING_MAX_DIAGNOSTICS,
  LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES,
  layoutMenuProjectionSchema,
  layoutOutlineEntrySchema,
  layoutPageListItemSchema,
  layoutRenderContextSchema,
  layoutRenderProjectionSchema,
  type LayoutDiagnostic,
  type LayoutMenuProjection,
  type LayoutOutlineEntry,
  type LayoutPageListItem,
  type LayoutRenderContext,
  type LayoutRenderProjection,
  type ResolvedLayoutElement
} from '../../shared/layout-rendering'
import type { ResolvedLayoutAssignment } from '../../shared/layout-assignment'
import { publicPathLookupKey } from '../../shared/public-routing'
import { defineLayoutRendererRegistry, resolveLayoutRenderer } from '../../shared/site-layout-renderer'
import type { LayoutElement } from '../../shared/site-layout'
import { parseContentJson } from '../cms/content-json'
import { getPublishedPage } from '../cms/page-delivery'
import { getPublicationRevision } from '../cms/publication'
import { getSchemaVersion } from '../cms/repo'
import { getDb } from '../db/db'
import {
  content as contentTable,
  page as pageTable,
  publicationRevision as publicationRevisionTable,
  publicRoute as publicRouteTable,
  schemaActive as schemaActiveTable
} from '../db/schema'
import {
  resolvePublishedContentLayout,
  resolvePublishedPageLayout,
  resolvePublishedSchemaLayout,
  resolveSchemaVersionLayout,
  resolveWorkingPageLayout
} from './layout-assignments'
import { resolvePublicLayoutMenus } from './site-menus'
import { getSiteMode } from './site-mode-settings'
import { getPublicSiteIdentity } from './site-presentation-settings'
import { getPublicSiteThemeManifest } from './site-theme-settings'

type AssignmentResolver = (context: LayoutRenderContext) => Promise<ResolvedLayoutAssignment>

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function canonicalParentPath(path: string | null) {
  if (!path) return '/'
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  const separator = normalized.lastIndexOf('/')
  return separator <= 0 ? '/' : `${normalized.slice(0, separator)}/`
}

async function resolvePublishedPageList(
  event: H3Event,
  context: LayoutRenderContext,
  props: Extract<LayoutElement, { type: 'page-list' }>['props']
): Promise<LayoutPageListItem[]> {
  const db = await getDb(event)
  const conditions = [
    eq(publicRouteTable.routeKind, 'canonical'),
    eq(publicRouteTable.documentKind, 'page'),
    ne(pageTable.status, 'deleted'),
    isNotNull(pageTable.publishedRevisionId)
  ]
  if (props.scope === 'current-section') {
    if (!context.canonicalPath) return []
    const parent = canonicalParentPath(context.canonicalPath)
    conditions.push(sql`substr(${publicRouteTable.path}, 1, length(${parent})) = ${parent}`)
    conditions.push(sql`instr(substr(${publicRouteTable.path}, length(${parent}) + 1), '/') = 0`)
  }
  const titleOrder = sql`coalesce(nullif(trim(${publicationRevisionTable.title}), ''), 'Untitled page') collate nocase`
  const order = props.sort === 'recently-updated'
    ? [desc(publicationRevisionTable.createdAt), asc(publicRouteTable.path)]
    : [asc(titleOrder), asc(publicRouteTable.path)]
  const rows: Array<{ id: string, title: string | null, path: string, publishedAt: Date }> = await db.select({
    id: pageTable.id,
    title: publicationRevisionTable.title,
    path: publicRouteTable.path,
    publishedAt: publicationRevisionTable.createdAt
  }).from(publicRouteTable).innerJoin(pageTable, and(
    eq(pageTable.id, publicRouteTable.documentId)
  )).innerJoin(publicationRevisionTable, and(
    eq(publicationRevisionTable.id, pageTable.publishedRevisionId),
    eq(publicationRevisionTable.documentKind, 'page'),
    eq(publicationRevisionTable.documentId, pageTable.id)
  )).where(and(...conditions)).orderBy(...order).limit(props.limit)

  return rows.map(row => layoutPageListItemSchema.parse({
    id: row.id,
    title: row.title?.trim() || 'Untitled page',
    path: row.path,
    publishedAt: row.publishedAt.toISOString()
  }))
}

function copyrightText(siteName: string, props: Extract<LayoutElement, { type: 'copyright' }>['props']) {
  const currentYear = new Date().getUTCFullYear()
  const years = props.startYear && props.startYear < currentYear
    ? `${props.startYear}–${currentYear}`
    : String(currentYear)
  return props.format === 'site-year'
    ? `© ${siteName} ${years}`
    : `© ${years} ${siteName}`
}

function fallbackMenu(menuSetId: string, context: LayoutRenderContext): LayoutMenuProjection {
  return layoutMenuProjectionSchema.parse({
    status: 'missing',
    menuSetId,
    document: { version: 1, items: [] },
    digest: digest({ status: 'missing', menuSetId, context })
  })
}

async function resolveReadyElements(args: {
  event: H3Event
  context: LayoutRenderContext
  elements: LayoutElement[]
  site: Awaited<ReturnType<typeof getPublicSiteIdentity>>
  outline: LayoutOutlineEntry[]
  diagnostics: LayoutDiagnostic[]
}) {
  const menuSetIds = [...new Set(args.elements.flatMap(element => (
    element.type === 'menu' ? [element.props.menuSetId] : []
  )))]
  const menuBatch = resolvePublicLayoutMenus(args.event, menuSetIds, { context: args.context })
  const addDiagnostic = (diagnostic: LayoutDiagnostic) => {
    if (args.diagnostics.length < LAYOUT_RENDERING_MAX_DIAGNOSTICS) args.diagnostics.push(diagnostic)
  }
  const menuFor = async (menuSetId: string) => {
    const projection = (await menuBatch).get(menuSetId)
    return projection ?? fallbackMenu(menuSetId, args.context)
  }

  const registry = defineLayoutRendererRegistry<Promise<ResolvedLayoutElement>>({
    'page-content': async element => ({ ...element, props: {} }),
    'site-logo': async element => ({
      ...element,
      props: { ...element.props, siteName: args.site.siteName, logoUrl: args.site.logoUrl }
    }),
    'site-title': async element => ({
      ...element,
      props: { ...element.props, siteName: args.site.siteName }
    }),
    menu: async (element) => {
      let menu: LayoutMenuProjection
      try {
        menu = await menuFor(element.props.menuSetId)
      } catch {
        menu = fallbackMenu(element.props.menuSetId, args.context)
      }
      if (menu.status !== 'ready') {
        addDiagnostic({
          code: menu.status === 'malformed' ? 'menu-malformed' : 'menu-missing',
          elementId: element.id,
          message: menu.status === 'malformed' ? 'The selected Menu is malformed.' : 'The selected Menu is unavailable.'
        })
      }
      return { ...element, props: { ...element.props, menu } }
    },
    'page-list': async (element) => {
      try {
        return {
          ...element,
          props: { ...element.props, items: await resolvePublishedPageList(args.event, args.context, element.props) }
        }
      } catch {
        addDiagnostic({ code: 'page-list-unavailable', elementId: element.id, message: 'The published Page list is unavailable.' })
        return { ...element, props: { ...element.props, items: [] } }
      }
    },
    'table-of-contents': async element => ({
      ...element,
      props: {
        ...element.props,
        items: args.outline.filter(item => item.level <= element.props.maxDepth)
      }
    }),
    copyright: async element => ({
      ...element,
      props: { ...element.props, text: copyrightText(args.site.siteName, element.props) }
    })
  })

  const resolved: ResolvedLayoutElement[] = []
  for (const element of args.elements) {
    try {
      resolved.push(await resolveLayoutRenderer(registry, element)(element as never))
    } catch {
      addDiagnostic({ code: 'element-unavailable', elementId: element.id, message: 'A Layout element is unavailable.' })
      if (element.type === 'page-content') resolved.push({ ...element, props: {} })
    }
  }
  return resolved
}

/**
 * Single runtime composition boundary. Callers must finish public canonical
 * authorization or preview authentication before invoking this resolver.
 * Persisted data can select only validated semantic LayoutElement.type values.
 */
export async function resolveLayoutRendering(args: {
  event: H3Event
  context: LayoutRenderContext
  resolveContext?: () => Promise<LayoutRenderContext>
  resolveAssignment: AssignmentResolver
  outline?: LayoutOutlineEntry[]
  resolveOutline?: (context: LayoutRenderContext) => Promise<LayoutOutlineEntry[]>
}): Promise<LayoutRenderProjection> {
  let context = layoutRenderContextSchema.parse(args.context)
  const mode = await getSiteMode(args.event)
  if (!mode.enabled) {
    return layoutRenderProjectionSchema.parse({
      contractVersion: LAYOUT_RENDERING_CONTRACT_VERSION,
      status: 'disabled',
      reason: 'site-disabled',
      context,
      revision: digest({ contractVersion: LAYOUT_RENDERING_CONTRACT_VERSION, status: 'disabled', context })
    })
  }

  if (args.resolveContext) context = layoutRenderContextSchema.parse(await args.resolveContext())
  const assignment = await args.resolveAssignment(context)
  const [theme, site] = await Promise.all([
    getPublicSiteThemeManifest(args.event),
    getPublicSiteIdentity(args.event)
  ])
  if (assignment.status === 'fallback') {
    const diagnostics: LayoutDiagnostic[] = assignment.diagnostic
      ? [{ code: 'layout-unavailable', message: assignment.diagnostic.reason }]
      : [{ code: 'layout-unassigned', message: 'No effective Layout is assigned.' }]
    const reason = assignment.reason === 'explicit-assignment-unavailable'
      ? 'explicit-assignment-unavailable' as const
      : 'unassigned' as const
    return layoutRenderProjectionSchema.parse({
      contractVersion: LAYOUT_RENDERING_CONTRACT_VERSION,
      status: 'built-in-fallback',
      reason,
      diagnostics,
      context,
      revision: digest({
        status: 'built-in-fallback',
        reason,
        diagnostics,
        effectiveAssignment: assignment.diagnostic
          ? {
              source: assignment.diagnostic.source,
              layoutId: assignment.diagnostic.layoutId,
              status: assignment.diagnostic.status
            }
          : null,
        context,
        theme,
        site
      })
    })
  }

  const needsOutline = assignment.document.elements.some(element => element.type === 'table-of-contents')
  const sourceOutline = needsOutline
    ? args.outline ?? await args.resolveOutline?.(context) ?? []
    : []
  const outlineResult = zOutline(sourceOutline)
  const diagnostics: LayoutDiagnostic[] = []
  if (sourceOutline.length > LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES) {
    diagnostics.push({ code: 'outline-truncated', message: 'The content outline was truncated.' })
  }
  if (!site.logoUrl && assignment.document.elements.some(element => element.type === 'site-logo')) {
    diagnostics.push({ code: 'logo-missing', message: 'The Site logo asset is unavailable.' })
  }
  const elements = await resolveReadyElements({
    event: args.event,
    context,
    elements: assignment.document.elements,
    site,
    outline: outlineResult,
    diagnostics
  })
  const projection = {
    contractVersion: LAYOUT_RENDERING_CONTRACT_VERSION,
    status: 'ready' as const,
    source: assignment.source,
    layoutId: assignment.layoutId,
    name: assignment.name,
    layoutRevision: assignment.revision,
    document: assignment.document,
    theme,
    site,
    elements,
    diagnostics,
    context
  }
  return layoutRenderProjectionSchema.parse({
    ...projection,
    revision: digest(projection)
  })
}

function zOutline(value: LayoutOutlineEntry[] | undefined) {
  return layoutOutlineEntrySchema.array().max(LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES)
    .parse((value ?? []).slice(0, LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES))
}

export function resolvePublicLayoutRendering(
  event: H3Event,
  context: LayoutRenderContext,
  outline?: LayoutOutlineEntry[]
) {
  return resolveLayoutRendering({
    event,
    context,
    resolveContext: () => resolvePublishedLayoutContext(event, context),
    resolveAssignment: (publishedContext) => publishedContext.documentKind === 'page'
      ? resolvePublishedPageLayout(event, publishedContext.documentId)
      : publishedContext.documentKind === 'schema'
        ? resolvePublishedSchemaLayout(event, publishedContext.documentId)
        : resolvePublishedContentLayout(event, publishedContext.documentId),
    outline,
    resolveOutline: outline === undefined
      ? publishedContext => resolvePublicOutline(event, publishedContext)
      : undefined
  })
}

async function resolvePublishedLayoutContext(event: H3Event, context: LayoutRenderContext) {
  if (context.documentKind === 'page') return context
  const db = await getDb(event)
  if (context.documentKind === 'schema') {
    const active = await db.select({ schemaVersion: schemaActiveTable.activeVersion })
      .from(schemaActiveTable).where(eq(schemaActiveTable.schemaKey, context.documentId)).get()
    return layoutRenderContextSchema.parse({ ...context, schemaVersion: active?.schemaVersion ?? null })
  }
  const revision = await db.select({ schemaVersion: publicationRevisionTable.schemaVersion })
    .from(contentTable).innerJoin(publicationRevisionTable, and(
      eq(publicationRevisionTable.id, contentTable.publishedRevisionId),
      eq(publicationRevisionTable.documentKind, 'content'),
      eq(publicationRevisionTable.documentId, contentTable.id)
    )).where(eq(contentTable.id, context.documentId)).get()
  return layoutRenderContextSchema.parse({ ...context, schemaVersion: revision?.schemaVersion ?? null })
}

async function resolvePublicOutline(event: H3Event, context: LayoutRenderContext) {
  const db = await getDb(event)
  if (context.documentKind === 'page') {
    const page = await getPublishedPage(db, context.documentId)
    return extractAuthoredOutline(page.content, { allowPageBlocks: true, allowPageHero: true })
  }
  if (context.documentKind !== 'content') return []
  const owner = await db.select({ publishedRevisionId: contentTable.publishedRevisionId })
    .from(contentTable).where(eq(contentTable.id, context.documentId)).get()
  const revision = await getPublicationRevision(db, 'content', context.documentId, owner?.publishedRevisionId)
  if (!revision?.schemaKey || !revision.schemaVersion) return []
  const sourceSchema = await getSchemaVersion(db, revision.schemaKey, revision.schemaVersion)
  if (!sourceSchema) return []
  return extractStructuredAuthoredOutline(
    parseContentJson(revision.contentJson),
    sourceSchema.registry?.fields ?? []
  )
}

export function resolvePreviewPageLayoutRendering(
  event: H3Event,
  context: LayoutRenderContext,
  resolveOutline?: () => LayoutOutlineEntry[]
) {
  return resolveLayoutRendering({
    event,
    context,
    resolveAssignment: () => resolveWorkingPageLayout(event, context.documentId),
    resolveOutline: resolveOutline ? async () => resolveOutline() : undefined
  })
}

export function resolvePreviewLayoutCanonicalPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return publicPathLookupKey(value, { allowReserved: true })
  } catch {
    return null
  }
}

export function resolvePreviewContentLayoutRendering(
  event: H3Event,
  context: LayoutRenderContext,
  resolveOutline?: () => LayoutOutlineEntry[]
) {
  if (!context.schemaKey || !context.schemaVersion) throw new TypeError('Preview content requires an exact Schema version')
  return resolveLayoutRendering({
    event,
    context,
    resolveAssignment: () => resolveSchemaVersionLayout(event, context.schemaKey!, context.schemaVersion!),
    resolveOutline: resolveOutline ? async () => resolveOutline() : undefined
  })
}
