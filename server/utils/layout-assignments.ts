import type { H3Event } from 'h3'
import { and, asc, eq } from 'drizzle-orm'

import {
  defaultLayoutAssignmentSetting,
  layoutAssignmentPatchSchema,
  layoutAssignmentSettingSchema,
  resolveLayoutAssignmentCandidates,
  type LayoutAssignmentCandidate,
  type LayoutAssignmentOption,
  type LayoutAssignmentOptionsResponse,
  type LayoutAssignmentProjection,
  type LayoutAssignmentSetting,
  type ResolvedLayoutAssignment
} from '../../shared/layout-assignment'
import {
  findForbiddenLayoutData,
  layoutIdSchema,
  parseLayoutDocument
} from '../../shared/site-layout'
import type { Db } from '../db/db'
import { getDb } from '../db/db'
import {
  content as contentTable,
  layoutReference as layoutReferenceTable,
  layoutResource as layoutResourceTable,
  page as pageTable,
  publicationRevision as publicationRevisionTable,
  schema as schemaTable,
  schemaActive as schemaActiveTable,
  settings as settingsTable
} from '../db/schema'
import { executeDbStatement, withDbTransaction, type DbStatement } from '../db/transaction'
import { getSiteMode } from './site-mode-settings'
import { badRequest, forbidden } from './http'

export const SITE_LAYOUT_ASSIGNMENT_SETTING_KEY = 'site.layout.default'
export const SITE_LAYOUT_ASSIGNMENT_GROUP = 'site.layout'
export const SITE_LAYOUT_ASSIGNMENT_OWNER_ID = 'default'

export class LayoutAssignmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutAssignmentValidationError'
  }
}

export class LayoutAssignmentModeDisabledError extends Error {
  constructor() {
    super('Enable Site features before changing a Layout assignment')
    this.name = 'LayoutAssignmentModeDisabledError'
  }
}

type AssignmentOwner = {
  ownerType: 'site' | 'schema' | 'page'
  ownerId: string
  slot: string
  label: string
}

type StoredSiteAssignment = {
  value: LayoutAssignmentSetting
  configured: boolean
  malformedStoredValue: boolean
  rawLayoutId: string | null
  updatedAt: Date | null
  updatedBy: string | null
}

function errorMessages(error: unknown) {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error ? current.message : String(current))
    current = typeof current === 'object' && current && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return messages
}

export function isLayoutAssignmentForeignKeyError(error: unknown) {
  return errorMessages(error).some(message => message.includes('FOREIGN KEY constraint failed')
    || message.includes('foreign key constraint'))
}

export function layoutAssignmentHttpError(error: unknown) {
  if (error instanceof LayoutAssignmentModeDisabledError) return forbidden(error.message)
  if (error instanceof LayoutAssignmentValidationError) return badRequest(error.message)
  if (isLayoutAssignmentForeignKeyError(error)) {
    return badRequest('The selected Layout changed or was deleted; choose another ready Layout')
  }
  return error
}

function parseLayoutRow(row: typeof layoutResourceTable.$inferSelect | undefined): LayoutAssignmentProjection {
  if (!row) {
    return { status: 'missing', layoutId: 'missing-layout', reason: 'Layout resource is missing' }
  }
  if (findForbiddenLayoutData({ name: row.name }).length) {
    return { status: 'repair-required', layoutId: row.id, reason: 'Stored Layout metadata failed strict validation' }
  }
  try {
    const parsed = parseLayoutDocument(JSON.parse(row.documentJson))
    if (!parsed.success || parsed.document.layoutId !== row.id || parsed.document.name !== row.name) {
      return { status: 'repair-required', layoutId: row.id, reason: 'Stored Layout document failed strict validation' }
    }
    return {
      status: 'ready',
      version: parsed.document.version,
      layoutId: row.id,
      name: row.name,
      revision: row.currentRevision,
      document: parsed.document
    }
  } catch {
    return { status: 'repair-required', layoutId: row.id, reason: 'Stored Layout document failed strict validation' }
  }
}

export async function resolveLayoutAssignmentProjection(db: Db, layoutId: unknown): Promise<LayoutAssignmentProjection> {
  const parsed = layoutIdSchema.safeParse(layoutId)
  if (!parsed.success) {
    return { status: 'invalid', layoutId: String(layoutId || 'invalid-layout'), reason: 'Layout ID is invalid' }
  }
  const row = await db.select().from(layoutResourceTable).where(eq(layoutResourceTable.id, parsed.data)).get()
  const projection = parseLayoutRow(row)
  return projection.status === 'missing' ? { ...projection, layoutId: parsed.data } : projection
}

export async function assertReadyLayoutAssignment(db: Db, layoutId: string | null) {
  if (layoutId === null) return
  const projection = await resolveLayoutAssignmentProjection(db, layoutId)
  if (projection.status !== 'ready') {
    throw new LayoutAssignmentValidationError(projection.reason)
  }
}

export function parseLayoutAssignmentField(body: unknown) {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (!Object.hasOwn(record, 'layoutId')) return { provided: false as const, layoutId: undefined }
  const parsed = layoutIdSchema.nullable().safeParse(record.layoutId)
  if (!parsed.success) throw new LayoutAssignmentValidationError(parsed.error.issues[0]?.message || 'Invalid Layout assignment')
  return { provided: true as const, layoutId: parsed.data }
}

export async function prepareLayoutAssignmentChange(args: {
  event: H3Event
  db: Db
  body: unknown
  currentLayoutId: string | null | undefined
}) {
  const input = parseLayoutAssignmentField(args.body)
  const currentLayoutId = args.currentLayoutId ?? null
  if (!input.provided) return currentLayoutId
  if (input.layoutId === currentLayoutId) return currentLayoutId
  const mode = await getSiteMode(args.event)
  if (!mode.enabled) throw new LayoutAssignmentModeDisabledError()
  await assertReadyLayoutAssignment(args.db, input.layoutId)
  return input.layoutId
}

export async function syncLayoutAssignmentReference(args: {
  db: Db
  statements?: DbStatement[]
  owner: AssignmentOwner
  layoutId: string | null
  now: Date
}) {
  const predicate = and(
    eq(layoutReferenceTable.ownerType, args.owner.ownerType),
    eq(layoutReferenceTable.ownerId, args.owner.ownerId),
    eq(layoutReferenceTable.slot, args.owner.slot)
  )
  if (args.layoutId === null) {
    await executeDbStatement(args.db.delete(layoutReferenceTable).where(predicate), args.statements)
    return
  }
  await executeDbStatement(args.db.insert(layoutReferenceTable).values({
    ownerType: args.owner.ownerType,
    ownerId: args.owner.ownerId,
    slot: args.owner.slot,
    layoutId: args.layoutId,
    label: args.owner.label,
    behavior: 'use-current',
    createdAt: args.now,
    updatedAt: args.now
  }).onConflictDoUpdate({
    target: [layoutReferenceTable.ownerType, layoutReferenceTable.ownerId, layoutReferenceTable.slot],
    set: {
      layoutId: args.layoutId,
      label: args.owner.label,
      behavior: 'use-current',
      updatedAt: args.now
    }
  }), args.statements)
}

export function pageLayoutAssignmentOwner(pageId: string, slot: 'working' | 'published', title?: string | null): AssignmentOwner {
  return {
    ownerType: 'page',
    ownerId: pageId,
    slot,
    label: `${title?.trim() || pageId} ${slot} Layout`
  }
}

export function schemaLayoutAssignmentOwner(schemaKey: string, slot: 'working' | `published:${number}`): AssignmentOwner {
  return {
    ownerType: 'schema',
    ownerId: schemaKey,
    slot,
    label: slot === 'working' ? `${schemaKey} draft Layout` : `${schemaKey} v${slot.slice('published:'.length)} Layout`
  }
}

async function readSiteAssignment(db: Db): Promise<StoredSiteAssignment> {
  const row = await db.select().from(settingsTable).where(and(
    eq(settingsTable.scope, 'global'),
    eq(settingsTable.key, SITE_LAYOUT_ASSIGNMENT_SETTING_KEY)
  )).get()
  if (!row) {
    return {
      value: defaultLayoutAssignmentSetting(),
      configured: false,
      malformedStoredValue: false,
      rawLayoutId: null,
      updatedAt: null,
      updatedBy: null
    }
  }
  try {
    const raw = JSON.parse(row.value)
    const parsed = !row.isEncrypted && row.valueType === 'json'
      ? layoutAssignmentSettingSchema.safeParse(raw)
      : null
    if (parsed?.success) {
      return {
        value: parsed.data,
        configured: true,
        malformedStoredValue: false,
        rawLayoutId: parsed.data.layoutId,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null
      }
    }
    return {
      value: defaultLayoutAssignmentSetting(),
      configured: true,
      malformedStoredValue: true,
      rawLayoutId: typeof raw?.layoutId === 'string' ? raw.layoutId : null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null
    }
  } catch {
    return {
      value: defaultLayoutAssignmentSetting(),
      configured: true,
      malformedStoredValue: true,
      rawLayoutId: null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null
    }
  }
}

export async function getSiteLayoutAssignmentAdmin(event: H3Event) {
  const db = await getDb(event)
  const [stored, mode] = await Promise.all([readSiteAssignment(db), getSiteMode(event)])
  const projection = stored.rawLayoutId
    ? await resolveLayoutAssignmentProjection(db, stored.rawLayoutId)
    : null
  return {
    value: stored.value,
    storedLayoutId: stored.rawLayoutId,
    configured: stored.configured,
    malformedStoredValue: stored.malformedStoredValue,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
    modeEnabled: mode.enabled,
    assignment: projection
  }
}

export async function updateSiteLayoutAssignment(event: H3Event, body: unknown, actorId: string | null) {
  const parsed = layoutAssignmentPatchSchema.safeParse(body)
  if (!parsed.success) throw new LayoutAssignmentValidationError(parsed.error.issues[0]?.message || 'Invalid Layout assignment')
  const db = await getDb(event)
  const current = await readSiteAssignment(db)
  const assignmentChanged = current.malformedStoredValue
    || parsed.data.layoutId !== current.rawLayoutId
  if (assignmentChanged) {
    const mode = await getSiteMode(event)
    if (!mode.enabled) throw new LayoutAssignmentModeDisabledError()
    await assertReadyLayoutAssignment(db, parsed.data.layoutId)
  }
  const now = new Date()
  const value: LayoutAssignmentSetting = { version: 1, layoutId: parsed.data.layoutId }
  try {
    await withDbTransaction(event, db, async (tx, statements) => {
      await executeDbStatement(tx.insert(settingsTable).values({
        scope: 'global',
        key: SITE_LAYOUT_ASSIGNMENT_SETTING_KEY,
        value: JSON.stringify(value),
        valueType: 'json',
        isEncrypted: false,
        groupKey: SITE_LAYOUT_ASSIGNMENT_GROUP,
        updatedBy: actorId,
        updatedAt: now,
        note: 'Managed from Desk Site Layout assignment'
      }).onConflictDoUpdate({
        target: [settingsTable.scope, settingsTable.key],
        set: {
          value: JSON.stringify(value),
          valueType: 'json',
          isEncrypted: false,
          groupKey: SITE_LAYOUT_ASSIGNMENT_GROUP,
          updatedBy: actorId,
          updatedAt: now,
          note: 'Managed from Desk Site Layout assignment'
        }
      }), statements)
      await syncLayoutAssignmentReference({
        db: tx,
        statements,
        owner: {
          ownerType: 'site',
          ownerId: SITE_LAYOUT_ASSIGNMENT_OWNER_ID,
          slot: 'default',
          label: 'Site default Layout'
        },
        layoutId: value.layoutId,
        now
      })
    })
  } catch (error) {
    if (isLayoutAssignmentForeignKeyError(error)) {
      throw new LayoutAssignmentValidationError('The selected Layout changed or was deleted; choose another ready Layout')
    }
    throw error
  }
  return await getSiteLayoutAssignmentAdmin(event)
}

export async function getLayoutAssignmentOptions(event: H3Event): Promise<LayoutAssignmentOptionsResponse> {
  const db = await getDb(event)
  const [rows, mode] = await Promise.all([
    db.select().from(layoutResourceTable).orderBy(asc(layoutResourceTable.nameKey)),
    getSiteMode(event)
  ])
  const items: LayoutAssignmentOption[] = rows.map((row: typeof layoutResourceTable.$inferSelect) => {
    const projection = parseLayoutRow(row)
    return projection.status === 'ready'
      ? { id: row.id, name: row.name, revision: row.currentRevision, status: 'ready' }
      : { id: row.id, name: row.name, revision: row.currentRevision, status: 'repair-required', reason: projection.reason }
  })
  return { modeEnabled: mode.enabled, items }
}

async function siteCandidate(db: Db): Promise<LayoutAssignmentCandidate> {
  const stored = await readSiteAssignment(db)
  const layoutId = stored.rawLayoutId
  return {
    source: 'site',
    layoutId,
    projection: layoutId ? await resolveLayoutAssignmentProjection(db, layoutId) : undefined
  }
}

async function resolveCandidates(event: H3Event, candidates: LayoutAssignmentCandidate[]): Promise<ResolvedLayoutAssignment> {
  const db = await getDb(event)
  const mode = await getSiteMode(event)
  if (!mode.enabled) return resolveLayoutAssignmentCandidates(false, candidates)
  return resolveLayoutAssignmentCandidates(true, [...candidates, await siteCandidate(db)])
}

export async function resolvePublishedPageLayout(event: H3Event, pageId: string): Promise<ResolvedLayoutAssignment> {
  const db = await getDb(event)
  const row = await db.select({ publishedRevisionId: pageTable.publishedRevisionId })
    .from(pageTable).where(eq(pageTable.id, pageId)).get()
  const revision = row?.publishedRevisionId
    ? await db.select({ layoutId: publicationRevisionTable.layoutId }).from(publicationRevisionTable).where(and(
        eq(publicationRevisionTable.id, row.publishedRevisionId),
        eq(publicationRevisionTable.documentKind, 'page'),
        eq(publicationRevisionTable.documentId, pageId)
      )).get()
    : null
  const layoutId = revision?.layoutId ?? null
  return await resolveCandidates(event, [{
    source: 'page',
    layoutId,
    projection: layoutId ? await resolveLayoutAssignmentProjection(db, layoutId) : undefined
  }])
}

export async function resolveWorkingPageLayout(event: H3Event, pageId: string): Promise<ResolvedLayoutAssignment> {
  const db = await getDb(event)
  const row = await db.select({ layoutId: pageTable.layoutId })
    .from(pageTable).where(eq(pageTable.id, pageId)).get()
  const layoutId = row?.layoutId ?? null
  return await resolveCandidates(event, [{
    source: 'page',
    layoutId,
    projection: layoutId ? await resolveLayoutAssignmentProjection(db, layoutId) : undefined
  }])
}

export async function resolveSchemaVersionLayout(
  event: H3Event,
  schemaKey: string,
  schemaVersion: number
): Promise<ResolvedLayoutAssignment> {
  const db = await getDb(event)
  const row = await db.select({ astJson: schemaTable.astJson }).from(schemaTable).where(and(
    eq(schemaTable.schemaKey, schemaKey),
    eq(schemaTable.version, schemaVersion)
  )).get()
  let layoutId: string | null = null
  try {
    const value = row ? JSON.parse(row.astJson)?.presentation?.layoutId : null
    layoutId = typeof value === 'string' ? value : null
  } catch {
    layoutId = null
  }
  return await resolveCandidates(event, [{
    source: 'schema',
    layoutId,
    projection: layoutId ? await resolveLayoutAssignmentProjection(db, layoutId) : undefined
  }])
}

export async function resolvePublishedSchemaLayout(event: H3Event, schemaKey: string) {
  const db = await getDb(event)
  const active = await db.select({ version: schemaActiveTable.activeVersion })
    .from(schemaActiveTable).where(eq(schemaActiveTable.schemaKey, schemaKey)).get()
  return active
    ? await resolveSchemaVersionLayout(event, schemaKey, active.version)
    : await resolveCandidates(event, [])
}

export async function resolvePublishedContentLayout(event: H3Event, contentId: string) {
  const db = await getDb(event)
  const identity = await db.select({ publishedRevisionId: contentTable.publishedRevisionId })
    .from(contentTable).where(eq(contentTable.id, contentId)).get()
  const revision = identity?.publishedRevisionId
    ? await db.select({
        schemaKey: publicationRevisionTable.schemaKey,
        schemaVersion: publicationRevisionTable.schemaVersion
      }).from(publicationRevisionTable).where(and(
        eq(publicationRevisionTable.id, identity.publishedRevisionId),
        eq(publicationRevisionTable.documentKind, 'content'),
        eq(publicationRevisionTable.documentId, contentId)
      )).get()
    : null
  return revision?.schemaKey && revision.schemaVersion
    ? await resolveSchemaVersionLayout(event, revision.schemaKey, revision.schemaVersion)
    : await resolveCandidates(event, [])
}
