import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'

import {
  GLOBAL_SITE_MENU_ID,
  GLOBAL_SITE_MENU_NAME,
  SITE_MENU_MAX_CHILDREN,
  SITE_MENU_MAX_ITEMS,
  defaultSiteMenuDocument,
  isSiteMenuDynamicItem,
  publicSiteMenuDocumentSchema,
  resolvedSiteMenuLeafSchema,
  siteMenuCreateSchema,
  siteMenuDocumentSchema,
  siteMenuDynamicItemSchema,
  siteMenuIdSchema,
  siteMenuNameKey,
  siteMenuUpdateSchema,
  type PublicSiteMenu,
  type ResolvedSiteMenuLeaf,
  type SiteMenuAdminResource,
  type SiteMenuDocument,
  type SiteMenuDynamicItem,
  type SiteMenuLeaf,
  type SiteMenuListResponse,
  type SiteMenuSourceDiagnostic,
  type SiteMenuUsage,
  type SiteMenuValidationIssue
} from '../../shared/site-menu'
import {
  layoutMenuProjectionSchema,
  type LayoutRenderContext,
  type LayoutMenuProjection
} from '../../shared/layout-rendering'
import {
  resolvePublicNavigationTarget,
  type PublicNavigationDestination,
  type PublicNavigationItem
} from '../../shared/site-presentation'
import {
  listCanonicalPublicRoutesByIdentity,
  type PublicDocumentKind,
  type PublicRouteRow
} from '../cms/public-routes'
import type { Db } from '../db/db'
import { getDb } from '../db/db'
import {
  settings as settingsTable,
  siteMenuReference as siteMenuReferenceTable,
  siteMenuSet as siteMenuSetTable
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { newId } from './ids'
import {
  SITE_MENU_RENDER_BUDGET_MS,
  createSiteMenuD1Gate,
  mapWithSiteMenuConcurrency,
  prepareSiteMenuDynamicSourceMetadata,
  resolveSiteMenuDynamicSources,
  validateSiteMenuDynamicSources,
  type SiteMenuSourceCandidate
} from './site-menu-sources'

type SiteMenuRow = typeof siteMenuSetTable.$inferSelect

const PUBLIC_SITE_REFERENCE = {
  ownerType: 'public-site-shell',
  ownerId: 'default-public-site',
  slot: 'global-navigation',
  label: 'Built-in public Site navigation'
} as const

export class SiteMenuValidationError extends Error {
  readonly issues: SiteMenuValidationIssue[]

  constructor(issues: SiteMenuValidationIssue[] | string) {
    const normalized = typeof issues === 'string' ? [{ path: '', message: issues }] : issues
    super(normalized[0]?.message || 'Invalid menu set')
    this.name = 'SiteMenuValidationError'
    this.issues = normalized
  }
}

function zodValidationIssues(error: { issues: Array<{ path: PropertyKey[], message: string }> }) {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.'),
    message: issue.message
  }))
}

export class SiteMenuNotFoundError extends Error {
  constructor() {
    super('Menu set not found')
    this.name = 'SiteMenuNotFoundError'
  }
}

export class SiteMenuNameConflictError extends Error {
  constructor() {
    super('A menu set with this name already exists')
    this.name = 'SiteMenuNameConflictError'
  }
}

export class SiteMenuStorageUnavailableError extends Error {
  constructor() {
    super('Menu storage is not ready. Apply the add_site_menu_sets database migration.')
    this.name = 'SiteMenuStorageUnavailableError'
  }
}

export class SiteMenuInUseError extends Error {
  readonly usage: SiteMenuUsage[]

  constructor(usage: SiteMenuUsage[]) {
    super('Menu set is in use and cannot be deleted')
    this.name = 'SiteMenuInUseError'
    this.usage = usage
  }
}

function errorMessages(error: unknown) {
  const seen = new Set<unknown>()
  let current: unknown = error
  const messages: string[] = []
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = current instanceof Error
      ? current.message
      : typeof current === 'object' && 'message' in current
        ? String((current as { message?: unknown }).message || '')
        : String(current)
    messages.push(message)
    current = typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return messages
}

function isMissingSiteMenuTableError(error: unknown) {
  return errorMessages(error).some(message => message.includes('no such table: site_menu_'))
}

function isUniqueNameError(error: unknown) {
  return errorMessages(error).some(message => message.includes('UNIQUE constraint failed')
    || message.includes('idx_site_menu_set_name_unique'))
}

function isForeignKeyConstraintError(error: unknown) {
  return errorMessages(error).some(message => message.includes('FOREIGN KEY constraint failed')
    || message.includes('SQLITE_CONSTRAINT_FOREIGNKEY'))
}

function legacyDocument(items: PublicNavigationItem[]): SiteMenuDocument {
  const parsed = siteMenuDocumentSchema.safeParse({ version: 1, items })
  return parsed.success ? parsed.data : defaultSiteMenuDocument()
}

export function parseStoredSiteMenu(row: SiteMenuRow) {
  try {
    const stored = JSON.parse(row.documentJson)
    const parsed = siteMenuDocumentSchema.safeParse(stored)
    if (parsed.success) {
      return { document: parsed.data, malformedStoredValue: false, omittedInvalidSources: false }
    }
    const recovered = recoverStaticMenuSiblings(stored)
    if (recovered) {
      return { document: recovered, malformedStoredValue: true, omittedInvalidSources: true }
    }
  } catch {
    // Fall through to a safe empty document that an administrator can repair.
  }
  return { document: defaultSiteMenuDocument(), malformedStoredValue: true, omittedInvalidSources: false }
}

function recoverStaticMenuSiblings(value: unknown): SiteMenuDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as { version?: unknown, items?: unknown }
  if (input.version !== 1 || !Array.isArray(input.items)) return null
  let omittedInvalidSource = false

  const recoverNode = (node: unknown, allowChildren: boolean): unknown | null => {
    const sourceShaped = typeof node !== 'object' || node === null || Array.isArray(node)
      || 'source' in node || ('kind' in node && node.kind === 'dynamic')
    if (sourceShaped) {
      const dynamic = siteMenuDynamicItemSchema.safeParse(node)
      if (dynamic.success) return dynamic.data
      omittedInvalidSource = true
      return null
    }
    if (!allowChildren || !('children' in node) || !Array.isArray(node.children)) return node
    const children = node.children.flatMap((child) => {
      const recovered = recoverNode(child, false)
      return recovered == null ? [] : [recovered]
    })
    return { ...node, children }
  }

  const items = input.items.flatMap((item) => {
    const recovered = recoverNode(item, true)
    return recovered == null ? [] : [recovered]
  })
  if (!omittedInvalidSource) return null
  const recovered = siteMenuDocumentSchema.safeParse({ version: 1, items })
  return recovered.success ? recovered.data : null
}

/**
 * Central deletion-guard seam for Site resources. Persisted Layout references
 * use the `site-layout` storage namespace without coupling Menu documents to
 * Nuxt application layouts.
 */
export async function listSiteMenuUsage(db: Db, menuId: string): Promise<SiteMenuUsage[]> {
  const rows = await db.select({
    ownerType: siteMenuReferenceTable.ownerType,
    ownerId: siteMenuReferenceTable.ownerId,
    label: siteMenuReferenceTable.label
  }).from(siteMenuReferenceTable).where(eq(siteMenuReferenceTable.menuSetId, menuId))
  return rows.map((row: { ownerType: string, ownerId: string, label: string }) => ({
    resourceType: row.ownerType === 'site-layout' ? 'site-layout' : 'public-site-shell',
    resourceId: row.ownerId,
    label: row.label
  }))
}

async function rowToAdminResource(db: Db, row: SiteMenuRow): Promise<SiteMenuAdminResource> {
  const parsed = parseStoredSiteMenu(row)
  const usage = await listSiteMenuUsage(db, row.id)
  return {
    id: row.id,
    name: row.name,
    document: parsed.document,
    malformedStoredValue: parsed.malformedStoredValue,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    usage,
    canDelete: usage.length === 0
  }
}

type SiteMenuBootstrapOptions = {
  afterLegacyRead?: () => Promise<void>
  repairReference?: boolean
}

async function legacyBootstrapSeed(db: Db, options: SiteMenuBootstrapOptions = {}) {
  const row = await db.select({
    value: settingsTable.value,
    valueType: settingsTable.valueType,
    isEncrypted: settingsTable.isEncrypted,
    updatedBy: settingsTable.updatedBy,
    updatedAt: settingsTable.updatedAt
  }).from(settingsTable).where(and(
    eq(settingsTable.scope, 'global'),
    eq(settingsTable.key, 'site.presentation')
  )).get()

  let document = defaultSiteMenuDocument()
  if (row && !row.isEncrypted && row.valueType === 'json') {
    try {
      const value = JSON.parse(row.value) as { navigation?: { items?: unknown } }
      const parsed = siteMenuDocumentSchema.safeParse({ version: 1, items: value.navigation?.items })
      if (parsed.success) document = parsed.data
    } catch {
      // Invalid legacy settings intentionally bootstrap the safe empty document.
    }
  }
  const seed = {
    document,
    actorId: row?.updatedBy ?? null,
    sourceUpdatedAt: row?.updatedAt ?? null
  }
  await options.afterLegacyRead?.()
  return seed
}

function sourceTime(value: Date | null) {
  return value?.getTime() ?? 0
}

function bootstrapSourceMatches(row: SiteMenuRow, seed: Awaited<ReturnType<typeof legacyBootstrapSeed>>) {
  return sourceTime(seed.sourceUpdatedAt) <= sourceTime(row.bootstrapSourceUpdatedAt)
    && row.documentJson === JSON.stringify(seed.document)
}

type SiteMenuNameRow = Pick<SiteMenuRow, 'id' | 'name' | 'nameKey'>

const NAME_CONFLICT_KEY_PREFIX = 'halopress:reserved:site-menu-name-conflict:'
const NAME_REPAIR_KEY_PREFIX = 'halopress:reserved:site-menu-name-repair:'

function allocateReservedNameKey(prefix: string, id: string, unavailable: Set<string>) {
  let candidate = `${prefix}${id}`
  while (unavailable.has(candidate)) candidate += ':'
  unavailable.add(candidate)
  return candidate
}

function siteMenuNameKeyTargets(rows: SiteMenuNameRow[]) {
  const groups = new Map<string, SiteMenuNameRow[]>()
  for (const row of rows) {
    const key = siteMenuNameKey(row.name)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  // Keep every normalized display-name key unavailable to the reserved
  // namespace, including duplicate groups whose canonical key remains vacant.
  const unavailable = new Set(groups.keys())
  const targets = new Map<string, string>()
  for (const [key, group] of groups) {
    if (group.length === 1) {
      targets.set(group[0]!.id, key)
      continue
    }
    for (const row of group) {
      targets.set(row.id, allocateReservedNameKey(NAME_CONFLICT_KEY_PREFIX, row.id, unavailable))
    }
  }
  return targets
}

async function readSiteMenuNameRows(db: Db): Promise<SiteMenuNameRow[]> {
  return await db.select({
    id: siteMenuSetTable.id,
    name: siteMenuSetTable.name,
    nameKey: siteMenuSetTable.nameKey
  }).from(siteMenuSetTable).orderBy(asc(siteMenuSetTable.id))
}

async function repairSiteMenuNameKeys(event: H3Event, db: Db) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await readSiteMenuNameRows(db)
    const targets = siteMenuNameKeyTargets(rows)
    const changes = rows.filter(row => row.nameKey !== targets.get(row.id))
    if (!changes.length) return

    const unavailable = new Set([
      ...rows.map(row => row.nameKey),
      ...targets.values()
    ])
    const temporaryKeys = new Map(changes.map(row => [
      row.id,
      allocateReservedNameKey(NAME_REPAIR_KEY_PREFIX, row.id, unavailable)
    ]))

    await withDbTransaction(event, db, async (tx, statements) => {
      for (const row of changes) {
        await executeDbStatement(tx.update(siteMenuSetTable).set({
          nameKey: temporaryKeys.get(row.id)!
        }).where(and(
          eq(siteMenuSetTable.id, row.id),
          eq(siteMenuSetTable.nameKey, row.nameKey)
        )), statements)
      }
      for (const row of changes) {
        await executeDbStatement(tx.update(siteMenuSetTable).set({
          nameKey: targets.get(row.id)!
        }).where(and(
          eq(siteMenuSetTable.id, row.id),
          eq(siteMenuSetTable.nameKey, temporaryKeys.get(row.id)!)
        )), statements)
      }
    })

    const verified = await readSiteMenuNameRows(db)
    const verifiedTargets = siteMenuNameKeyTargets(verified)
    if (verified.every(row => row.nameKey === verifiedTargets.get(row.id))) return
  }
  throw new Error('Menu name storage changed repeatedly while repairing normalized keys')
}

async function assertSiteMenuNameAvailable(db: Db, name: string, excludedId?: string) {
  const candidate = siteMenuNameKey(name)
  const rows = await db.select({ id: siteMenuSetTable.id, name: siteMenuSetTable.name })
    .from(siteMenuSetTable)
  if (rows.some((row: { id: string, name: string }) => (
    row.id !== excludedId && siteMenuNameKey(row.name) === candidate
  ))) {
    throw new SiteMenuNameConflictError()
  }
}

async function ensurePublicSiteMenuReference(db: Db, now: Date) {
  await db.insert(siteMenuReferenceTable).values({
    ...PUBLIC_SITE_REFERENCE,
    menuSetId: GLOBAL_SITE_MENU_ID,
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing()
}

/**
 * Reconciles old-Worker navigation writes until the first named-menu save.
 * bootstrapOwned is cleared in that same checked menu UPDATE, making the editor
 * the permanent source of truth without a read/check/write ownership race.
 */
export async function ensureGlobalSiteMenu(
  event: H3Event,
  db: Db,
  options: SiteMenuBootstrapOptions = {}
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await db.select().from(siteMenuSetTable)
      .where(eq(siteMenuSetTable.id, GLOBAL_SITE_MENU_ID)).get() as SiteMenuRow | undefined
    const now = new Date()

    if (existing && !existing.bootstrapOwned) {
      if (options.repairReference) await ensurePublicSiteMenuReference(db, now)
      return existing
    }

    const seed = await legacyBootstrapSeed(db, options)

    if (!existing) {
      const sourceUpdatedAt = seed.sourceUpdatedAt
      await withDbTransaction(event, db, async (tx, statements) => {
        await executeDbStatement(tx.insert(siteMenuSetTable).values({
          id: GLOBAL_SITE_MENU_ID,
          name: GLOBAL_SITE_MENU_NAME,
          nameKey: siteMenuNameKey(GLOBAL_SITE_MENU_NAME),
          documentJson: JSON.stringify(seed.document),
          bootstrapOwned: true,
          bootstrapSourceUpdatedAt: sourceUpdatedAt,
          createdBy: seed.actorId,
          updatedBy: seed.actorId,
          createdAt: sourceUpdatedAt ?? now,
          updatedAt: sourceUpdatedAt ?? now
        }).onConflictDoNothing(), statements)
        await executeDbStatement(tx.insert(siteMenuReferenceTable).values({
          ...PUBLIC_SITE_REFERENCE,
          menuSetId: GLOBAL_SITE_MENU_ID,
          createdAt: now,
          updatedAt: now
        }).onConflictDoNothing(), statements)
      })
      continue
    }

    if (options.repairReference) await ensurePublicSiteMenuReference(db, now)

    if (bootstrapSourceMatches(existing, seed)) {
      // A second source read closes the old-writer interleaving between the
      // first SELECT and the observed Global row.
      const verification = await legacyBootstrapSeed(db, options)
      if (bootstrapSourceMatches(existing, verification)) return existing
      continue
    }

    if (sourceTime(seed.sourceUpdatedAt) < sourceTime(existing.bootstrapSourceUpdatedAt)) return existing

    const observedSource = existing.bootstrapSourceUpdatedAt
    const sourceGuard = observedSource
      ? eq(siteMenuSetTable.bootstrapSourceUpdatedAt, observedSource)
      : isNull(siteMenuSetTable.bootstrapSourceUpdatedAt)
    if (existing.documentJson === JSON.stringify(seed.document)) {
      // site.presentation has one timestamp for every section. A newer change
      // to Appearance or Footer advances the observed source without falsely
      // attributing unchanged navigation to that settings editor.
      await db.update(siteMenuSetTable).set({
        bootstrapSourceUpdatedAt: seed.sourceUpdatedAt
      }).where(and(
        eq(siteMenuSetTable.id, GLOBAL_SITE_MENU_ID),
        eq(siteMenuSetTable.bootstrapOwned, true),
        sourceGuard,
        eq(siteMenuSetTable.documentJson, existing.documentJson)
      )).returning({ id: siteMenuSetTable.id })
      continue
    }
    await db.update(siteMenuSetTable).set({
      name: GLOBAL_SITE_MENU_NAME,
      nameKey: siteMenuNameKey(GLOBAL_SITE_MENU_NAME),
      documentJson: JSON.stringify(seed.document),
      bootstrapSourceUpdatedAt: seed.sourceUpdatedAt,
      updatedBy: seed.actorId,
      updatedAt: seed.sourceUpdatedAt ?? now
    }).where(and(
      eq(siteMenuSetTable.id, GLOBAL_SITE_MENU_ID),
      eq(siteMenuSetTable.bootstrapOwned, true),
      sourceGuard,
      eq(siteMenuSetTable.documentJson, existing.documentJson)
    )).returning({ id: siteMenuSetTable.id })
  }

  const global = await db.select().from(siteMenuSetTable)
    .where(eq(siteMenuSetTable.id, GLOBAL_SITE_MENU_ID)).get()
  if (!global) throw new SiteMenuStorageUnavailableError()
  return global as SiteMenuRow
}

export async function listSiteMenus(event: H3Event): Promise<SiteMenuListResponse> {
  const db = await getDb(event)
  try {
    await ensureGlobalSiteMenu(event, db, { repairReference: true })
    await repairSiteMenuNameKeys(event, db)
    const rows = await db.select().from(siteMenuSetTable)
      .orderBy(asc(siteMenuSetTable.nameKey))
    return {
      defaultMenuId: GLOBAL_SITE_MENU_ID,
      items: await Promise.all(rows.map((row: SiteMenuRow) => rowToAdminResource(db, row)))
    }
  } catch (error) {
    if (isMissingSiteMenuTableError(error)) throw new SiteMenuStorageUnavailableError()
    throw error
  }
}

export async function createSiteMenu(
  event: H3Event,
  body: unknown,
  actorId: string | null
): Promise<SiteMenuAdminResource> {
  const parsed = siteMenuCreateSchema.safeParse(body)
  if (!parsed.success) {
    throw new SiteMenuValidationError(zodValidationIssues(parsed.error))
  }

  const db = await getDb(event)
  try {
    await ensureGlobalSiteMenu(event, db, { repairReference: true })
    await repairSiteMenuNameKeys(event, db)
    await assertSiteMenuNameAvailable(db, parsed.data.name)
  } catch (error) {
    if (isMissingSiteMenuTableError(error)) throw new SiteMenuStorageUnavailableError()
    throw error
  }
  const now = new Date()
  const row = {
    id: newId(),
    name: parsed.data.name,
    nameKey: siteMenuNameKey(parsed.data.name),
    documentJson: JSON.stringify(defaultSiteMenuDocument()),
    bootstrapOwned: false,
    bootstrapSourceUpdatedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  }

  try {
    await db.insert(siteMenuSetTable).values(row)
  } catch (error) {
    if (isMissingSiteMenuTableError(error)) throw new SiteMenuStorageUnavailableError()
    if (isUniqueNameError(error)) throw new SiteMenuNameConflictError()
    throw error
  }
  return await rowToAdminResource(db, row)
}

export async function updateSiteMenu(
  event: H3Event,
  menuIdInput: unknown,
  body: unknown,
  actorId: string | null
): Promise<SiteMenuAdminResource> {
  const menuId = siteMenuIdSchema.safeParse(menuIdInput)
  if (!menuId.success) throw new SiteMenuValidationError('Invalid menu set ID')

  const parsed = siteMenuUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new SiteMenuValidationError(zodValidationIssues(parsed.error))
  }

  const db = await getDb(event)
  let existing: SiteMenuRow | undefined
  try {
    await ensureGlobalSiteMenu(event, db, { repairReference: true })
    await repairSiteMenuNameKeys(event, db)
    existing = await db.select().from(siteMenuSetTable)
      .where(eq(siteMenuSetTable.id, menuId.data)).get()
  } catch (error) {
    if (isMissingSiteMenuTableError(error)) throw new SiteMenuStorageUnavailableError()
    throw error
  }
  if (!existing) throw new SiteMenuNotFoundError()
  const sourceIssues = await validateSiteMenuDynamicSources(db, parsed.data.document)
  if (sourceIssues.length) throw new SiteMenuValidationError(sourceIssues)
  await assertSiteMenuNameAvailable(db, parsed.data.name, menuId.data)

  const next: SiteMenuRow = {
    ...existing,
    name: parsed.data.name,
    nameKey: siteMenuNameKey(parsed.data.name),
    documentJson: JSON.stringify(parsed.data.document),
    bootstrapOwned: false,
    bootstrapSourceUpdatedAt: null,
    updatedBy: actorId,
    updatedAt: new Date()
  }
  try {
    // A whole-document update keeps reorder, field edits, and rename atomic.
    const updated = await db.update(siteMenuSetTable).set({
      name: next.name,
      nameKey: next.nameKey,
      documentJson: next.documentJson,
      bootstrapOwned: false,
      bootstrapSourceUpdatedAt: null,
      updatedBy: next.updatedBy,
      updatedAt: next.updatedAt
    }).where(eq(siteMenuSetTable.id, menuId.data)).returning({ id: siteMenuSetTable.id })
    if (!updated.some((row: { id: string }) => row.id === menuId.data)) throw new SiteMenuNotFoundError()
  } catch (error) {
    if (isUniqueNameError(error)) throw new SiteMenuNameConflictError()
    throw error
  }
  return await rowToAdminResource(db, next)
}

export async function deleteSiteMenu(event: H3Event, menuIdInput: unknown) {
  const menuId = siteMenuIdSchema.safeParse(menuIdInput)
  if (!menuId.success) throw new SiteMenuValidationError('Invalid menu set ID')

  const db = await getDb(event)
  let existing: SiteMenuRow | undefined
  try {
    await ensureGlobalSiteMenu(event, db, { repairReference: true })
    existing = await db.select().from(siteMenuSetTable)
      .where(eq(siteMenuSetTable.id, menuId.data)).get()
  } catch (error) {
    if (isMissingSiteMenuTableError(error)) throw new SiteMenuStorageUnavailableError()
    throw error
  }
  if (!existing) throw new SiteMenuNotFoundError()

  try {
    // The NOT EXISTS predicate makes the guard and deletion one conditional
    // operation; the restrictive FK remains the final authority if a future
    // Layout reference is inserted concurrently.
    await withDbTransaction(event, db, async (tx, statements) => {
      await executeDbStatement(tx.delete(siteMenuSetTable).where(and(
        eq(siteMenuSetTable.id, menuId.data),
        notExists(tx.select({ one: sql`1` }).from(siteMenuReferenceTable)
          .where(eq(siteMenuReferenceTable.menuSetId, menuId.data)))
      )), statements)
    })
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw new SiteMenuInUseError(await listSiteMenuUsage(db, menuId.data))
    }
    throw error
  }
  // D1 batch statements do not expose RETURNING rows to the transaction
  // callback, so verify the affected row explicitly on every runtime.
  const remaining = await db.select({ id: siteMenuSetTable.id }).from(siteMenuSetTable)
    .where(eq(siteMenuSetTable.id, menuId.data)).get()
  if (remaining) throw new SiteMenuInUseError(await listSiteMenuUsage(db, menuId.data))
  return { deleted: true as const, id: menuId.data }
}

export async function getGlobalSiteMenuDocument(
  event: H3Event,
  legacyItems: PublicNavigationItem[]
): Promise<SiteMenuDocument> {
  const fallback = legacyDocument(legacyItems)
  const db = await getDb(event)
  try {
    const row = await ensureGlobalSiteMenu(event, db)
    return parseStoredSiteMenu(row).document
  } catch (error) {
    // app.vue requests presentation before installation is complete. A rolling
    // deploy without migration 0008 must retain the legacy navigation safely.
    if (isMissingSiteMenuTableError(error)) return fallback
    throw error
  }
}

export async function resolvePublicSiteMenu(
  event: H3Event,
  legacyItems: PublicNavigationItem[]
): Promise<PublicSiteMenu> {
  const document = await getGlobalSiteMenuDocument(event, legacyItems)
  const resolved = await resolvePublicMenuDocument(event, document, {
    visibility: 'public',
    documentKind: 'schema',
    documentId: GLOBAL_SITE_MENU_ID,
    schemaKey: null,
    schemaVersion: null,
    canonicalPath: null
  })

  return {
    id: GLOBAL_SITE_MENU_ID,
    name: GLOBAL_SITE_MENU_NAME,
    document: resolved.document
  }
}

export async function resolveAnonymousReadableNavigationTargets(
  event: H3Event,
  destinations: PublicNavigationDestination[]
) {
  const identities: Array<{ documentKind: PublicDocumentKind, documentId: string }> = []
  for (const destination of destinations) {
    if (destination.type === 'page') identities.push({ documentKind: 'page', documentId: destination.pageId })
    else if (destination.type === 'collection') identities.push({ documentKind: 'schema', documentId: destination.schemaKey })
    else if (destination.type === 'content') identities.push({ documentKind: 'content', documentId: destination.contentId })
  }
  const routes = await listCanonicalPublicRoutesByIdentity(await getDb(event), identities)
  const routeMap = new Map(routes.map(route => [`${route.documentKind}:${route.documentId}`, route]))
  return destinations.map((destination): string | null => {
    if (destination.type === 'home') return '/'
    if (destination.type === 'external') return resolvePublicNavigationTarget(destination)
    const documentKind = destination.type === 'page'
      ? 'page'
      : destination.type === 'collection' ? 'schema' : 'content'
    const documentId = destination.type === 'page'
      ? destination.pageId
      : destination.type === 'collection' ? destination.schemaKey : destination.contentId
    const route = routeMap.get(`${documentKind}:${documentId}`)
    if (!route || (destination.type === 'content' && route.schemaKey !== destination.schemaKey)) return null
    return route.path
  })
}

function publicMenuDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function emptyPublicMenuDocument() {
  return publicSiteMenuDocumentSchema.parse({ version: 1, items: [] })
}

type ParsedLayoutMenu = {
  menuSetId: string
  row?: SiteMenuRow
  document?: SiteMenuDocument
  malformed?: true
  omittedInvalidSources?: true
}

function routeIdentityKey(documentKind: PublicDocumentKind, documentId: string) {
  return `${documentKind}:${documentId}`
}

function staticMenuIdentities(document: SiteMenuDocument) {
  const identities: Array<{ documentKind: PublicDocumentKind, documentId: string }> = []
  const staticItems: SiteMenuLeaf[] = []
  for (const item of document.items) {
    if (isSiteMenuDynamicItem(item)) continue
    staticItems.push(item)
    for (const child of item.children) if (!isSiteMenuDynamicItem(child)) staticItems.push(child)
  }
  for (const item of staticItems) {
    const destination = item.destination
    if (destination.type === 'page') identities.push({ documentKind: 'page', documentId: destination.pageId })
    else if (destination.type === 'collection') identities.push({ documentKind: 'schema', documentId: destination.schemaKey })
    else if (destination.type === 'content') identities.push({ documentKind: 'content', documentId: destination.contentId })
  }
  return identities
}

function sourceCandidateIdentities(candidatesBySourceId: Map<string, SiteMenuSourceCandidate[]>) {
  return [...candidatesBySourceId.values()].flatMap(candidates => candidates.map(candidate => ({
    documentKind: candidate.documentKind,
    documentId: candidate.documentId
  })))
}

function staticMenuClaims(document: SiteMenuDocument) {
  const ids = new Set<string>()
  const values = new Set<string>()
  for (const item of document.items) {
    if (isSiteMenuDynamicItem(item)) continue
    ids.add(item.id)
    values.add(item.value || item.id)
    for (const child of item.children) {
      if (isSiteMenuDynamicItem(child)) continue
      ids.add(child.id)
      values.add(child.value || child.id)
    }
  }
  return { ids, values }
}

function dynamicResultIdentity(sourceId: string, documentKind: string, documentId: string) {
  const fingerprint = createHash('sha256')
    .update(`${sourceId}\0${documentKind}\0${documentId}`)
    .digest('hex')
    .slice(0, 48)
  return `dynamic:${fingerprint}`
}

function resolveStaticLeaf(
  item: SiteMenuLeaf,
  publicRouteMap: Map<string, PublicRouteRow>
): ResolvedSiteMenuLeaf | null {
  const destination = item.destination
  let to: string | null
  if (destination.type === 'home') to = '/'
  else if (destination.type === 'external') to = resolvePublicNavigationTarget(destination)
  else {
    const documentKind = destination.type === 'page'
      ? 'page'
      : destination.type === 'collection' ? 'schema' : 'content'
    const documentId = destination.type === 'page'
      ? destination.pageId
      : destination.type === 'collection' ? destination.schemaKey : destination.contentId
    const route = publicRouteMap.get(routeIdentityKey(documentKind, documentId))
    to = route && (destination.type !== 'content' || route.schemaKey === destination.schemaKey)
      ? route.path
      : null
  }
  if (!to) return null
  const externalWindow = destination.type === 'external' && destination.newWindow
  return {
    id: item.id,
    label: item.label,
    to,
    value: item.value || item.id,
    icon: item.icon,
    badge: item.badge,
    target: externalWindow ? '_blank' : undefined,
    rel: externalWindow ? 'noopener noreferrer' : undefined
  }
}

function resolveDynamicLeaves(args: {
  item: SiteMenuDynamicItem
  candidatesBySourceId: Map<string, SiteMenuSourceCandidate[]>
  publicRouteMap: Map<string, PublicRouteRow>
  staticIds: Set<string>
  staticValues: Set<string>
  usedIds: Set<string>
  usedValues: Set<string>
  limit: number
}) {
  const leaves: ResolvedSiteMenuLeaf[] = []
  for (const candidate of args.candidatesBySourceId.get(args.item.id) ?? []) {
    if (leaves.length >= args.limit) break
    const route = args.publicRouteMap.get(routeIdentityKey(candidate.documentKind, candidate.documentId))
    if (!route || (candidate.documentKind === 'content' && route.schemaKey !== candidate.schemaKey)) continue
    const identity = dynamicResultIdentity(args.item.id, candidate.documentKind, candidate.documentId)
    if (args.staticIds.has(identity) || args.staticValues.has(identity)
      || args.usedIds.has(identity) || args.usedValues.has(identity)) continue
    const parsed = resolvedSiteMenuLeafSchema.safeParse({
      id: identity,
      label: candidate.label,
      to: route.path,
      value: identity,
      icon: candidate.icon,
      badge: candidate.badge
    })
    if (!parsed.success) continue
    args.usedIds.add(identity)
    args.usedValues.add(identity)
    leaves.push(parsed.data)
  }
  return leaves
}

function compilePublicMenuDocument(args: {
  document: SiteMenuDocument
  candidatesBySourceId: Map<string, SiteMenuSourceCandidate[]>
  publicRouteMap: Map<string, PublicRouteRow>
}) {
  const staticClaims = staticMenuClaims(args.document)
  const usedIds = new Set<string>()
  const usedValues = new Set<string>()
  const items: Array<ResolvedSiteMenuLeaf & { children: ResolvedSiteMenuLeaf[] }> = []
  const resolvedStaticTopItems = args.document.items.map(item => (
    isSiteMenuDynamicItem(item) ? null : resolveStaticLeaf(item, args.publicRouteMap)
  ))
  const remainingResolvedStaticTopItems = resolvedStaticTopItems.map((_item, index) => (
    resolvedStaticTopItems.slice(index + 1).filter(Boolean).length
  ))
  const claimStatic = (leaf: ResolvedSiteMenuLeaf | null) => {
    if (!leaf || usedIds.has(leaf.id) || usedValues.has(leaf.value)) return null
    usedIds.add(leaf.id)
    usedValues.add(leaf.value)
    return leaf
  }

  for (const [itemIndex, item] of args.document.items.entries()) {
    if (items.length >= SITE_MENU_MAX_ITEMS) break
    if (isSiteMenuDynamicItem(item)) {
      const leaves = resolveDynamicLeaves({
        item,
        candidatesBySourceId: args.candidatesBySourceId,
        publicRouteMap: args.publicRouteMap,
        staticIds: staticClaims.ids,
        staticValues: staticClaims.values,
        usedIds,
        usedValues,
        limit: Math.max(
          0,
          SITE_MENU_MAX_ITEMS - items.length - remainingResolvedStaticTopItems[itemIndex]!
        )
      })
      items.push(...leaves.map(leaf => ({ ...leaf, children: [] })))
      continue
    }

    const parent = claimStatic(resolvedStaticTopItems[itemIndex]!)
    if (!parent) continue
    const children: ResolvedSiteMenuLeaf[] = []
    const resolvedStaticChildren = item.children.map(child => (
      isSiteMenuDynamicItem(child) ? null : resolveStaticLeaf(child, args.publicRouteMap)
    ))
    const remainingResolvedStaticChildren = resolvedStaticChildren.map((_child, index) => (
      resolvedStaticChildren.slice(index + 1).filter(Boolean).length
    ))
    for (const [childIndex, child] of item.children.entries()) {
      if (children.length >= SITE_MENU_MAX_CHILDREN) break
      if (isSiteMenuDynamicItem(child)) {
        children.push(...resolveDynamicLeaves({
          item: child,
          candidatesBySourceId: args.candidatesBySourceId,
          publicRouteMap: args.publicRouteMap,
          staticIds: staticClaims.ids,
          staticValues: staticClaims.values,
          usedIds,
          usedValues,
          limit: Math.max(
            0,
            SITE_MENU_MAX_CHILDREN - children.length - remainingResolvedStaticChildren[childIndex]!
          )
        }))
      } else {
        const resolved = claimStatic(resolvedStaticChildren[childIndex]!)
        if (resolved) children.push(resolved)
      }
    }
    items.push({ ...parent, children })
  }
  return publicSiteMenuDocumentSchema.parse({ version: 1, items })
}

export async function resolvePublicMenuDocument(
  event: H3Event,
  document: SiteMenuDocument,
  context: LayoutRenderContext
): Promise<{
  document: ReturnType<typeof compilePublicMenuDocument>
  diagnostics: SiteMenuSourceDiagnostic[]
  digest: string
}> {
  const db = await getDb(event)
  const d1Gate = createSiteMenuD1Gate()
  const preparedSchemaByKey = await prepareSiteMenuDynamicSourceMetadata({
    db,
    documents: [document],
    d1Gate
  })
  const sourceResolution = await resolveSiteMenuDynamicSources({
    event,
    db,
    document,
    context,
    deadlineAt: Date.now() + SITE_MENU_RENDER_BUDGET_MS,
    preparedSchemaByKey,
    d1Gate
  })
  const publicRoutes = await listCanonicalPublicRoutesByIdentity(db, [
    ...staticMenuIdentities(document),
    ...sourceCandidateIdentities(sourceResolution.candidatesBySourceId)
  ])
  const publicRouteMap = new Map(publicRoutes.map(route => [
    routeIdentityKey(route.documentKind as PublicDocumentKind, route.documentId),
    route
  ]))
  const publicDocument = compilePublicMenuDocument({
    document,
    candidatesBySourceId: sourceResolution.candidatesBySourceId,
    publicRouteMap
  })
  return {
    document: publicDocument,
    diagnostics: sourceResolution.diagnostics,
    digest: publicMenuDigest({ source: document, context, document: publicDocument })
  }
}

/**
 * Resolves all selected named Menus through one bounded identity lookup. Only
 * canonical, published, anonymous-readable internal destinations are emitted;
 * private IDs are never guessed into legacy paths.
 */
export async function resolvePublicLayoutMenus(
  event: H3Event,
  menuSetIdInputs: unknown[],
  options: { context: LayoutRenderContext }
): Promise<Map<string, LayoutMenuProjection>> {
  const menuSetIds = [...new Set(menuSetIdInputs.map(value => siteMenuIdSchema.parse(value)))]
  const db = await getDb(event)
  if (menuSetIds.includes(GLOBAL_SITE_MENU_ID)) await ensureGlobalSiteMenu(event, db)
  const rows = menuSetIds.length
    ? await db.select().from(siteMenuSetTable).where(inArray(siteMenuSetTable.id, menuSetIds)) as SiteMenuRow[]
    : []
  const rowById = new Map(rows.map(row => [row.id, row]))
  const parsedMenus: ParsedLayoutMenu[] = menuSetIds.map((menuSetId) => {
    const row = rowById.get(menuSetId)
    if (!row) return { menuSetId }
    const parsed = parseStoredSiteMenu(row)
    if (!parsed.malformedStoredValue) return { menuSetId, row, document: parsed.document }
    return parsed.omittedInvalidSources
      ? { menuSetId, row, document: parsed.document, omittedInvalidSources: true }
      : { menuSetId, row, malformed: true }
  })
  const d1Gate = createSiteMenuD1Gate()
  const preparedSchemaByKey = await prepareSiteMenuDynamicSourceMetadata({
    db,
    documents: parsedMenus.flatMap(menu => menu.document ? [menu.document] : []),
    d1Gate
  })
  const sourceDeadlineAt = Date.now() + SITE_MENU_RENDER_BUDGET_MS
  const sourceResolutionPairs = (await mapWithSiteMenuConcurrency(parsedMenus, 2, async (menu) => {
    if (!menu.document) return []
    const resolution = await resolveSiteMenuDynamicSources({
      event,
      db,
      document: menu.document,
      context: options.context,
      deadlineAt: sourceDeadlineAt,
      preparedSchemaByKey,
      d1Gate
    })
    return [[menu.menuSetId, resolution] as const]
  })).flat()
  const sourceResolutionByMenuId = new Map(sourceResolutionPairs)
  const publicRoutes = await listCanonicalPublicRoutesByIdentity(
    db,
    parsedMenus.flatMap((menu) => {
      if (!menu.document) return []
      const sourceResolution = sourceResolutionByMenuId.get(menu.menuSetId)
      return [
        ...staticMenuIdentities(menu.document),
        ...sourceCandidateIdentities(sourceResolution?.candidatesBySourceId ?? new Map())
      ]
    })
  )
  const publicRouteMap = new Map(publicRoutes.map(route => [
    routeIdentityKey(route.documentKind as PublicDocumentKind, route.documentId),
    route
  ]))

  const projections = new Map<string, LayoutMenuProjection>()
  for (const parsedMenu of parsedMenus) {
    const { menuSetId, row, document } = parsedMenu
    if (!row) {
      projections.set(menuSetId, layoutMenuProjectionSchema.parse({
        status: 'missing',
        menuSetId,
        document: emptyPublicMenuDocument(),
        digest: publicMenuDigest({ status: 'missing', menuSetId, context: options.context })
      }))
      continue
    }
    if (parsedMenu.malformed || !document) {
      projections.set(menuSetId, layoutMenuProjectionSchema.parse({
        status: 'malformed',
        menuSetId,
        document: emptyPublicMenuDocument(),
        digest: publicMenuDigest({
          status: 'malformed',
          menuSetId,
          stored: row.documentJson,
          updatedAt: row.updatedAt.toISOString(),
          context: options.context
        })
      }))
      continue
    }

    const publicDocument = compilePublicMenuDocument({
      document,
      candidatesBySourceId: sourceResolutionByMenuId.get(menuSetId)?.candidatesBySourceId ?? new Map(),
      publicRouteMap
    })
    projections.set(menuSetId, layoutMenuProjectionSchema.parse({
      status: 'ready',
      menuSetId,
      name: row.name,
      document: publicDocument,
      digest: publicMenuDigest({
        status: 'ready',
        menuSetId,
        name: row.name,
        stored: row.documentJson,
        updatedAt: row.updatedAt.toISOString(),
        context: options.context,
        document: publicDocument
      })
    }))
  }
  return projections
}

export async function resolvePublicLayoutMenu(
  event: H3Event,
  menuSetIdInput: unknown,
  options: { context: LayoutRenderContext }
): Promise<LayoutMenuProjection> {
  const menuSetId = siteMenuIdSchema.parse(menuSetIdInput)
  const projection = (await resolvePublicLayoutMenus(event, [menuSetId], options)).get(menuSetId)
  if (!projection) throw new Error('Menu projection is unavailable')
  return projection
}
