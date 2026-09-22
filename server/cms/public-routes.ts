import { and, eq, inArray } from 'drizzle-orm'

import {
  generatedContentPath,
  generatedPagePath,
  isReservedSchemaKey,
  legacyContentPath,
  legacyPagePath,
  publicPathLookupKey
} from '../../shared/public-routing'
import { parsePublicSeoJson, type PublicSeoOverrides } from '../../shared/public-seo'
import type { Db } from '../db/db'
import {
  content as contentTable,
  page as pageTable,
  publicRoute as publicRouteTable,
  schemaActive as schemaActiveTable,
  schemaRole as schemaRoleTable
} from '../db/schema'
import { executeDbStatement, type DbStatement } from '../db/transaction'
import { conflict } from '../utils/http'
import type { SchemaRegistry } from './types'

export type PublicDocumentKind = 'content' | 'page' | 'schema'
export type PublicRouteRow = typeof publicRouteTable.$inferSelect
export const PUBLIC_ROUTE_D1_IN_CHUNK_SIZE = 90

type RouteIdentity = {
  documentKind: PublicDocumentKind
  documentId: string
  schemaKey: string | null
}

function sameDocument(row: RouteIdentity, identity: Pick<RouteIdentity, 'documentKind' | 'documentId'>) {
  return row.documentKind === identity.documentKind && row.documentId === identity.documentId
}

export async function assertPublicRouteAvailable(args: {
  db: Db
  documentKind: PublicDocumentKind
  documentId: string
  path: string
}) {
  const path = publicPathLookupKey(args.path)
  const claim = await args.db.select().from(publicRouteTable).where(eq(publicRouteTable.path, path)).get()
  if (claim && !sameDocument(claim as RouteIdentity, args)) {
    throw conflict('Public path is already claimed')
  }
  if (claim?.routeKind === 'alias') {
    throw conflict('Public path is retained as redirect history')
  }
  return path
}

export function contentCanonicalPath(args: {
  schemaKey: string
  contentId: string
  content: Record<string, unknown>
  registry: SchemaRegistry
}) {
  if (isReservedSchemaKey(args.schemaKey)) {
    throw conflict('Reserved system paths cannot be published')
  }
  const presentation = args.registry.presentation
  const slugFieldKey = presentation?.slugField?.fieldKey
    ?? presentation?.slots?.title?.fieldKey
    ?? args.registry.listing?.titleFieldKey
  return generatedContentPath(
    args.schemaKey,
    slugFieldKey ? args.content[slugFieldKey] : undefined,
    args.contentId
  )
}

export function pageCanonicalPath(args: {
  pageId: string
  requestedPath?: string | null
  title?: string | null
}) {
  return generatedPagePath(args.requestedPath, args.title, args.pageId)
}

export async function publishCanonicalRoute(args: {
  db: Db
  statements?: DbStatement[]
  documentKind: PublicDocumentKind
  documentId: string
  schemaKey?: string | null
  path: string
  legacyPath: string
  seo: PublicSeoOverrides | null
  now: Date
}) {
  const identity: RouteIdentity = {
    documentKind: args.documentKind,
    documentId: args.documentId,
    schemaKey: args.schemaKey ?? null
  }
  const path = publicPathLookupKey(args.path, { allowReserved: args.path === args.legacyPath })
  const legacyPath = publicPathLookupKey(args.legacyPath, { allowReserved: true })
  const current = await args.db.select().from(publicRouteTable).where(and(
    eq(publicRouteTable.documentKind, identity.documentKind),
    eq(publicRouteTable.documentId, identity.documentId),
    eq(publicRouteTable.routeKind, 'canonical')
  )).get()
  const claim = await args.db.select().from(publicRouteTable).where(eq(publicRouteTable.path, path)).get()

  if (claim && !sameDocument(claim as RouteIdentity, identity)) {
    throw conflict('Public path is already claimed')
  }

  if (current?.path === path) {
    await executeDbStatement(args.db.update(publicRouteTable).set({
      schemaKey: identity.schemaKey,
      seoJson: args.seo ? JSON.stringify(args.seo) : null,
      updatedAt: args.now
    }).where(eq(publicRouteTable.path, path)), args.statements)
    return path
  }

  if (claim?.routeKind === 'alias') {
    throw conflict('Public path is retained as redirect history')
  }

  if (current) {
    await executeDbStatement(args.db.update(publicRouteTable).set({
      routeKind: 'alias',
      seoJson: null,
      updatedAt: args.now
    }).where(eq(publicRouteTable.path, current.path)), args.statements)
  }

  await executeDbStatement(args.db.insert(publicRouteTable).values({
    path,
    routeKind: 'canonical',
    documentKind: identity.documentKind,
    documentId: identity.documentId,
    schemaKey: identity.schemaKey,
    seoJson: args.seo ? JSON.stringify(args.seo) : null,
    createdAt: current?.createdAt ?? args.now,
    updatedAt: args.now
  }), args.statements)

  if (!current && legacyPath !== path) {
    const legacyClaim = await args.db.select().from(publicRouteTable)
      .where(eq(publicRouteTable.path, legacyPath))
      .get()
    if (legacyClaim && !sameDocument(legacyClaim as RouteIdentity, identity)) {
      throw conflict('Legacy public path is already claimed')
    }
    if (!legacyClaim) {
      await executeDbStatement(args.db.insert(publicRouteTable).values({
        path: legacyPath,
        routeKind: 'alias',
        documentKind: identity.documentKind,
        documentId: identity.documentId,
        schemaKey: identity.schemaKey,
        seoJson: null,
        createdAt: args.now,
        updatedAt: args.now
      }), args.statements)
    }
  }

  return path
}

export function legacyRouteForDocument(identity: RouteIdentity) {
  if (identity.documentKind === 'schema') return `/${identity.documentId}`
  return identity.documentKind === 'page'
    ? legacyPagePath(identity.documentId)
    : legacyContentPath(identity.schemaKey!, identity.documentId)
}

export async function getCanonicalPublicPath(db: Db, documentKind: PublicDocumentKind, documentId: string) {
  const row = await getCanonicalPublicRoute(db, documentKind, documentId)
  return row?.path ?? null
}

export async function getCanonicalPublicRoute(db: Db, documentKind: PublicDocumentKind, documentId: string) {
  const row = await db.select({
    path: publicRouteTable.path,
    seoJson: publicRouteTable.seoJson
  })
    .from(publicRouteTable)
    .where(and(
      eq(publicRouteTable.documentKind, documentKind),
      eq(publicRouteTable.documentId, documentId),
      eq(publicRouteTable.routeKind, 'canonical')
    ))
    .get()
  return row
    ? { path: row.path, seo: parsePublicSeoJson(row.seoJson) }
    : null
}

export async function canonicalPathMap(db: Db, identities: Array<{ documentKind: PublicDocumentKind, documentId: string }>) {
  const unique = new Map(identities.map(item => [`${item.documentKind}:${item.documentId}`, item]))
  const result = new Map<string, string>()
  for (const documentKind of ['content', 'page', 'schema'] as const) {
    const ids = [...unique.values()]
      .filter(item => item.documentKind === documentKind)
      .map(item => item.documentId)
    for (let offset = 0; offset < ids.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
      if (!chunk.length) continue
      const rows = await db.select({
        path: publicRouteTable.path,
        documentId: publicRouteTable.documentId
      }).from(publicRouteTable).where(and(
        eq(publicRouteTable.documentKind, documentKind),
        eq(publicRouteTable.routeKind, 'canonical'),
        inArray(publicRouteTable.documentId, chunk)
      ))
      for (const row of rows) result.set(`${documentKind}:${row.documentId}`, row.path)
    }
  }
  return result
}

export async function attachCanonicalPublicPaths<T extends { id: string }>(db: Db, items: T[]) {
  const paths = await canonicalPathMap(db, items.map(item => ({ documentKind: 'content', documentId: item.id })))
  return items.map(item => ({ ...item, publicPath: paths.get(`content:${item.id}`) ?? null }))
}

async function isPubliclyReadable(db: Db, route: typeof publicRouteTable.$inferSelect) {
  if (route.documentKind === 'schema') {
    const [lifecycle, permission] = await Promise.all([
      db.select({ status: schemaActiveTable.status }).from(schemaActiveTable)
        .where(eq(schemaActiveTable.schemaKey, route.documentId)).get(),
      db.select({ canRead: schemaRoleTable.canRead }).from(schemaRoleTable)
        .where(and(
          eq(schemaRoleTable.schemaKey, route.documentId),
          eq(schemaRoleTable.roleKey, 'anonymous')
        )).get()
    ])
    return Boolean(lifecycle?.status === 'active' && permission?.canRead)
  }
  if (route.documentKind === 'page') {
    const row = await db.select({
      publishedRevisionId: pageTable.publishedRevisionId,
      status: pageTable.status
    }).from(pageTable).where(eq(pageTable.id, route.documentId)).get()
    return Boolean(row?.publishedRevisionId && row.status !== 'deleted')
  }

  const row = await db.select({
    publishedRevisionId: contentTable.publishedRevisionId,
    status: contentTable.status,
    schemaKey: contentTable.schemaKey
  }).from(contentTable).where(eq(contentTable.id, route.documentId)).get()
  if (!row?.publishedRevisionId || row.status === 'deleted') return false
  const [lifecycle, permission] = await Promise.all([
    db.select({ status: schemaActiveTable.status }).from(schemaActiveTable)
      .where(eq(schemaActiveTable.schemaKey, row.schemaKey)).get(),
    db.select({ canRead: schemaRoleTable.canRead }).from(schemaRoleTable)
      .where(and(
        eq(schemaRoleTable.schemaKey, row.schemaKey),
        eq(schemaRoleTable.roleKey, 'anonymous')
      )).get()
  ])
  return Boolean(lifecycle?.status === 'active' && permission?.canRead)
}

export async function publishSchemaCollectionRoute(args: {
  db: Db
  statements?: DbStatement[]
  schemaKey: string
  now: Date
}) {
  if (isReservedSchemaKey(args.schemaKey)) throw conflict('Reserved system paths cannot be published')
  return await publishCanonicalRoute({
    db: args.db,
    statements: args.statements,
    documentKind: 'schema',
    documentId: args.schemaKey,
    schemaKey: args.schemaKey,
    path: `/${args.schemaKey}`,
    legacyPath: `/${args.schemaKey}`,
    seo: null,
    now: args.now
  })
}

export async function resolvePublicRoute(db: Db, requestedPath: string) {
  const path = publicPathLookupKey(requestedPath, { allowReserved: true })
  const claim = await db.select().from(publicRouteTable).where(eq(publicRouteTable.path, path)).get()
  if (!claim || !await isPubliclyReadable(db, claim)) return null
  const canonical = claim.routeKind === 'canonical'
    ? claim
    : await db.select().from(publicRouteTable).where(and(
        eq(publicRouteTable.documentKind, claim.documentKind),
        eq(publicRouteTable.documentId, claim.documentId),
        eq(publicRouteTable.routeKind, 'canonical')
      )).get()
  if (!canonical || !await isPubliclyReadable(db, canonical)) return null
  return {
    path,
    canonicalPath: canonical.path,
    routeKind: claim.routeKind as 'canonical' | 'alias',
    documentKind: canonical.documentKind as PublicDocumentKind,
    documentId: canonical.documentId,
    schemaKey: canonical.schemaKey,
    seo: parsePublicSeoJson(canonical.seoJson)
  }
}

async function keepAnonymousReadableCanonicalRoutes(db: Db, rows: PublicRouteRow[]) {
  const pageIds = rows.filter(row => row.documentKind === 'page').map(row => row.documentId)
  const schemaIds = rows.filter(row => row.documentKind === 'schema').map(row => row.documentId)
  const contentIds = rows.filter(row => row.documentKind === 'content').map(row => row.documentId)
  const readablePages = new Set<string>()
  const contentRows: Array<{ id: string, schemaKey: string, publishedRevisionId: string | null, status: string }> = []
  const activeSchemas = new Set<string>()
  const anonymousSchemas = new Set<string>()

  for (let offset = 0; offset < pageIds.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
    const chunk = pageIds.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
    if (!chunk.length) continue
    const published = await db.select({
      id: pageTable.id,
      publishedRevisionId: pageTable.publishedRevisionId,
      status: pageTable.status
    }).from(pageTable).where(inArray(pageTable.id, chunk))
    for (const row of published) if (row.publishedRevisionId && row.status !== 'deleted') readablePages.add(row.id)
  }

  for (let offset = 0; offset < contentIds.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
    const chunk = contentIds.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
    if (!chunk.length) continue
    contentRows.push(...await db.select({
      id: contentTable.id,
      schemaKey: contentTable.schemaKey,
      publishedRevisionId: contentTable.publishedRevisionId,
      status: contentTable.status
    }).from(contentTable).where(inArray(contentTable.id, chunk)))
  }

  const relevantSchemaIds = [...new Set([...schemaIds, ...contentRows.map(row => row.schemaKey)])]
  for (let offset = 0; offset < relevantSchemaIds.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
    const chunk = relevantSchemaIds.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
    if (!chunk.length) continue
    const [lifecycleRows, permissionRows] = await Promise.all([
      db.select({ schemaKey: schemaActiveTable.schemaKey, status: schemaActiveTable.status })
        .from(schemaActiveTable).where(inArray(schemaActiveTable.schemaKey, chunk)),
      db.select({ schemaKey: schemaRoleTable.schemaKey, canRead: schemaRoleTable.canRead })
        .from(schemaRoleTable).where(and(
          eq(schemaRoleTable.roleKey, 'anonymous'),
          inArray(schemaRoleTable.schemaKey, chunk)
        ))
    ])
    for (const row of lifecycleRows) if (row.status === 'active') activeSchemas.add(row.schemaKey)
    for (const row of permissionRows) if (row.canRead) anonymousSchemas.add(row.schemaKey)
  }

  const readableContent = new Set(contentRows
    .filter(row => row.publishedRevisionId && row.status !== 'deleted'
      && activeSchemas.has(row.schemaKey) && anonymousSchemas.has(row.schemaKey))
    .map(row => row.id))

  return rows.filter((row: PublicRouteRow) => {
    if (row.documentKind === 'page') return readablePages.has(row.documentId)
    if (row.documentKind === 'schema') return activeSchemas.has(row.documentId) && anonymousSchemas.has(row.documentId)
    return readableContent.has(row.documentId)
  })
}

export async function listCanonicalPublicRoutesByIdentity(
  db: Db,
  identities: Array<Pick<RouteIdentity, 'documentKind' | 'documentId'>>
) {
  const unique = new Map(identities.map(identity => [
    `${identity.documentKind}:${identity.documentId}`,
    identity
  ]))
  const rows: PublicRouteRow[] = []
  for (const documentKind of ['content', 'page', 'schema'] as const) {
    const ids = [...unique.values()]
      .filter(identity => identity.documentKind === documentKind)
      .map(identity => identity.documentId)
    for (let offset = 0; offset < ids.length; offset += PUBLIC_ROUTE_D1_IN_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + PUBLIC_ROUTE_D1_IN_CHUNK_SIZE)
      if (!chunk.length) continue
      rows.push(...await db.select().from(publicRouteTable).where(and(
        eq(publicRouteTable.documentKind, documentKind),
        eq(publicRouteTable.routeKind, 'canonical'),
        inArray(publicRouteTable.documentId, chunk)
      )) as PublicRouteRow[])
    }
  }
  rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return await keepAnonymousReadableCanonicalRoutes(db, rows)
}

export async function listCanonicalPublicRoutes(db: Db) {
  const rows = await db.select().from(publicRouteTable)
    .where(eq(publicRouteTable.routeKind, 'canonical'))
    .orderBy(publicRouteTable.path) as PublicRouteRow[]
  return await keepAnonymousReadableCanonicalRoutes(db, rows)
}
