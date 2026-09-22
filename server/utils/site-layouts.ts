import type { H3Event } from 'h3'
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm'

import {
  LAYOUT_DOCUMENT_VERSION,
  createLayoutDocumentFromPreset,
  findForbiddenLayoutData,
  layoutCreateSchema,
  layoutDeleteSchema,
  layoutDuplicateSchema,
  layoutElementDescriptors,
  layoutIdSchema,
  layoutMenuReferences,
  layoutNameKey,
  layoutPresetMetadata,
  layoutRenameSchema,
  layoutUpdateSchema,
  parseLayoutDocument,
  serializeLayoutDocument,
  type LayoutAdminResource,
  type LayoutDocument,
  type LayoutElementDescriptor,
  type LayoutListResponse,
  type LayoutPresetMetadata,
  type LayoutUsage,
  type LayoutValidationIssue,
  type ResolvedLayoutProjection
} from '../../shared/site-layout'
import { GLOBAL_SITE_MENU_ID } from '../../shared/site-menu'
import {
  assertExpectedRevision,
  createInitialDocumentRevision,
  mutateWithDocumentRevision,
  revisionConflict,
  type DocumentRevisionAction
} from '../cms/document-revisions'
import type { Db } from '../db/db'
import { getDb } from '../db/db'
import {
  documentRevision as documentRevisionTable,
  layoutReference as layoutReferenceTable,
  layoutResource as layoutResourceTable,
  siteMenuReference as siteMenuReferenceTable,
  siteMenuSet as siteMenuSetTable
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { newId } from './ids'
import { ensureGlobalSiteMenu } from './site-menus'

type LayoutRow = typeof layoutResourceTable.$inferSelect

export class LayoutValidationError extends Error {
  readonly issues: LayoutValidationIssue[]

  constructor(issues: LayoutValidationIssue[] | string) {
    const normalized = typeof issues === 'string'
      ? [{ path: '', message: issues, kind: 'invalid' as const }]
      : issues
    super(normalized[0]?.message || 'Invalid Layout')
    this.name = 'LayoutValidationError'
    this.issues = normalized
  }
}

export class LayoutNotFoundError extends Error {
  constructor() {
    super('Layout not found')
    this.name = 'LayoutNotFoundError'
  }
}

export class LayoutNameConflictError extends Error {
  constructor() {
    super('A Layout with this name already exists')
    this.name = 'LayoutNameConflictError'
  }
}

export class LayoutInUseError extends Error {
  readonly usage: LayoutUsage[]

  constructor(usage: LayoutUsage[]) {
    super('Layout is in use and cannot be deleted')
    this.name = 'LayoutInUseError'
    this.usage = usage
  }
}

export class LayoutStorageUnavailableError extends Error {
  constructor() {
    super('Layout storage is not ready. Apply the add_site_layout_documents database migration.')
    this.name = 'LayoutStorageUnavailableError'
  }
}

function zodValidationIssues(error: { issues: Array<{ path: PropertyKey[], message: string }> }, prefix = ''): LayoutValidationIssue[] {
  return error.issues.map(issue => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
    kind: 'invalid'
  }))
}

function errorMessages(error: unknown) {
  const seen = new Set<unknown>()
  let current: unknown = error
  const messages: string[] = []
  while (current && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error
      ? current.message
      : typeof current === 'object' && 'message' in current
        ? String((current as { message?: unknown }).message || '')
        : String(current))
    current = typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return messages
}

function isMissingLayoutTableError(error: unknown) {
  return errorMessages(error).some(message => message.includes('no such table: site_layout_')
    || message.includes('no such table: site_menu_set')
    || message.includes('no such table: site_menu_reference'))
}

function isUniqueLayoutNameError(error: unknown) {
  return errorMessages(error).some(message => message.includes('UNIQUE constraint failed: site_layout_resource.name_key')
    || message.includes('idx_site_layout_resource_name_unique'))
}

function isForeignKeyConstraintError(error: unknown) {
  return errorMessages(error).some(message => message.includes('FOREIGN KEY constraint failed')
    || message.includes('SQLITE_CONSTRAINT_FOREIGNKEY'))
}

function validateLayoutId(value: unknown) {
  const parsed = layoutIdSchema.safeParse(value)
  if (!parsed.success) throw new LayoutValidationError('Invalid Layout ID')
  return parsed.data
}

function parseStoredLayout(row: LayoutRow) {
  let raw: unknown
  try {
    raw = JSON.parse(row.documentJson)
  } catch {
    return {
      success: false as const,
      issues: [{ path: '', message: 'Stored Layout JSON is malformed', kind: 'invalid' as const }]
    }
  }
  const parsed = parseLayoutDocument(raw)
  if (!parsed.success) return parsed
  const issues: LayoutValidationIssue[] = []
  if (parsed.document.layoutId !== row.id) {
    issues.push({ path: 'layoutId', message: 'Stored Layout ID does not match its resource identity', kind: 'invalid' })
  }
  if (parsed.document.name !== row.name) {
    issues.push({ path: 'name', message: 'Stored Layout name does not match its resource metadata', kind: 'invalid' })
  }
  return issues.length ? { success: false as const, issues } : parsed
}

function safeStoredLayoutName(row: LayoutRow) {
  return findForbiddenLayoutData({ name: row.name }).length ? 'Layout requiring repair' : row.name
}

async function findLayoutRow(db: Db, layoutId: string) {
  try {
    return await db.select().from(layoutResourceTable).where(eq(layoutResourceTable.id, layoutId)).get() as LayoutRow | undefined
  } catch (error) {
    if (isMissingLayoutTableError(error)) throw new LayoutStorageUnavailableError()
    throw error
  }
}

async function requireLayoutRow(db: Db, layoutId: string) {
  const row = await findLayoutRow(db, layoutId)
  if (!row) throw new LayoutNotFoundError()
  return row
}

function isDocumentRevisionConflict(error: unknown) {
  return Boolean(error && typeof error === 'object'
    && 'statusCode' in error
    && (error as { statusCode?: unknown }).statusCode === 409
    && 'data' in error
    && Number.isInteger((error as { data?: { currentRevision?: unknown } }).data?.currentRevision))
}

async function rethrowResourceRevisionConflict(
  error: unknown,
  db: Db,
  layoutId: string,
  expectedRevision: number
) {
  if (!isDocumentRevisionConflict(error)) return
  const current = await findLayoutRow(db, layoutId)
  if (current && current.currentRevision !== expectedRevision) throw revisionConflict(current)
}

async function guardLayoutResourceRevision(
  tx: Db,
  statements: any[] | undefined,
  layoutId: string,
  expectedRevision: number
) {
  // History is normally authoritative, but a corrupt/out-of-band resource
  // update can advance only the row. If the expected resource row no longer
  // exists, deliberately re-insert its immutable expected history revision.
  // The unique conflict aborts the SQLite transaction or D1 batch before any
  // resource, reference, or history mutation can commit.
  const resourceAtExpectedRevision = tx.select({ one: sql`1` }).from(layoutResourceTable).where(and(
    eq(layoutResourceTable.id, layoutId),
    eq(layoutResourceTable.currentRevision, expectedRevision)
  ))
  const failedResourceGuard = tx.select().from(documentRevisionTable).where(and(
    eq(documentRevisionTable.documentKind, 'layout'),
    eq(documentRevisionTable.documentId, layoutId),
    eq(documentRevisionTable.revision, expectedRevision),
    notExists(resourceAtExpectedRevision)
  )).limit(1)
  await executeDbStatement(tx.insert(documentRevisionTable).select(failedResourceGuard), statements)
}

export async function listLayoutUsage(db: Db, layoutId: string): Promise<LayoutUsage[]> {
  const rows = await db.select({
    ownerType: layoutReferenceTable.ownerType,
    ownerId: layoutReferenceTable.ownerId,
    label: layoutReferenceTable.label,
    behavior: layoutReferenceTable.behavior
  }).from(layoutReferenceTable)
    .where(eq(layoutReferenceTable.layoutId, layoutId))
    .orderBy(asc(layoutReferenceTable.ownerType), asc(layoutReferenceTable.ownerId), asc(layoutReferenceTable.slot))

  return rows.map((row: { ownerType: string, ownerId: string, label: string, behavior: string }) => ({
    resourceType: ['site', 'schema', 'page'].includes(row.ownerType)
      ? row.ownerType as LayoutUsage['resourceType']
      : 'unknown',
    resourceId: row.ownerId,
    label: row.label,
    behavior: row.behavior === 'missing-fallback'
      ? 'missing-fallback'
      : row.behavior === 'use-current'
        ? 'use-current'
        : 'unknown'
  }))
}

async function rowToAdminResource(db: Db, row: LayoutRow): Promise<LayoutAdminResource> {
  const parsed = parseStoredLayout(row)
  const metadataNameUnsafe = safeStoredLayoutName(row) !== row.name
  const usage = await listLayoutUsage(db, row.id)
  const base = {
    id: row.id,
    name: safeStoredLayoutName(row),
    revision: row.currentRevision,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    usage,
    canDelete: usage.length === 0
  }
  if (!parsed.success || metadataNameUnsafe) {
    const parsedIssues = parsed.success ? [] : parsed.issues
    const repairIssues = metadataNameUnsafe || parsedIssues.some(issue => issue.kind === 'forbidden')
      ? [{ path: '', message: 'Stored Layout contains forbidden framework or runtime data', kind: 'forbidden' as const }]
      : parsedIssues
    return {
      ...base,
      status: 'repair-required',
      document: null,
      repair: { revision: row.currentRevision, issues: repairIssues }
    }
  }
  return { ...base, status: 'ready', document: parsed.document }
}

async function assertLayoutNameAvailable(db: Db, name: string, exceptId?: string) {
  const row = await db.select({ id: layoutResourceTable.id }).from(layoutResourceTable)
    .where(eq(layoutResourceTable.nameKey, layoutNameKey(name))).get()
  if (row && row.id !== exceptId) throw new LayoutNameConflictError()
}

async function missingMenuSetIds(db: Db, document: LayoutDocument) {
  const menuIds = [...new Set(layoutMenuReferences(document).map(reference => reference.menuSetId))]
  if (!menuIds.length) return []
  const rows = await db.select({ id: siteMenuSetTable.id }).from(siteMenuSetTable)
    .where(inArray(siteMenuSetTable.id, menuIds))
  const found = new Set(rows.map((row: { id: string }) => row.id))
  return menuIds.filter(id => !found.has(id))
}

async function assertMenuReferencesAvailable(db: Db, document: LayoutDocument) {
  const missing = new Set(await missingMenuSetIds(db, document))
  if (!missing.size) return
  throw new LayoutValidationError(document.elements.flatMap((element, index) => (
    element.type === 'menu' && missing.has(element.props.menuSetId)
      ? [{
          path: `document.elements.${index}.props.menuSetId`,
          message: `Menu set does not exist: ${element.props.menuSetId}`,
          kind: 'invalid' as const
        }]
      : []
  )))
}

async function ensureBuiltInMenuReferences(event: H3Event, db: Db, document: LayoutDocument) {
  if (!layoutMenuReferences(document).some(reference => reference.menuSetId === GLOBAL_SITE_MENU_ID)) return
  try {
    await ensureGlobalSiteMenu(event, db, { repairReference: true })
  } catch (error) {
    if (isMissingLayoutTableError(error)) throw new LayoutStorageUnavailableError()
    throw error
  }
}

async function syncMenuReferences(
  tx: Db,
  statements: any[] | undefined,
  document: LayoutDocument,
  now: Date
) {
  // Stable LayoutElement IDs are the reference slots. Moving a Menu between
  // regions therefore never changes its reference identity. The restrictive
  // Menu FK and this same-batch synchronization close save/delete races.
  await executeDbStatement(tx.delete(siteMenuReferenceTable).where(and(
    eq(siteMenuReferenceTable.ownerType, 'site-layout'),
    eq(siteMenuReferenceTable.ownerId, document.layoutId)
  )), statements)
  const references = layoutMenuReferences(document)
  if (!references.length) return
  await executeDbStatement(tx.insert(siteMenuReferenceTable).values(references.map(reference => ({
    ownerType: 'site-layout',
    ownerId: document.layoutId,
    slot: reference.elementId,
    menuSetId: reference.menuSetId,
    label: `${document.name}: ${reference.elementId}`,
    createdAt: now,
    updatedAt: now
  }))), statements)
}

async function createLayoutFromDocument(
  event: H3Event,
  db: Db,
  documentInput: LayoutDocument,
  actorId: string | null
) {
  const validated = parseLayoutDocument(documentInput)
  if (!validated.success) throw new LayoutValidationError(validated.issues)
  const document = validated.document
  const now = new Date(Math.floor(Date.now() / 1000) * 1000)
  const row: LayoutRow = {
    id: document.layoutId,
    name: document.name,
    nameKey: layoutNameKey(document.name),
    documentJson: serializeLayoutDocument(document),
    currentRevision: 1,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  }
  try {
    await ensureBuiltInMenuReferences(event, db, document)
    await assertLayoutNameAvailable(db, document.name)
    await assertMenuReferencesAvailable(db, document)
    await withDbTransaction(event, db, async (tx, statements) => {
      await executeDbStatement(tx.insert(layoutResourceTable).values(row), statements)
      await createInitialDocumentRevision({
        tx,
        statements,
        documentKind: 'layout',
        documentId: row.id,
        state: { snapshot: document, status: 'active', title: document.name },
        actorId,
        createdAt: now
      })
      await syncMenuReferences(tx, statements, document, now)
    })
  } catch (error) {
    if (isMissingLayoutTableError(error)) throw new LayoutStorageUnavailableError()
    if (isUniqueLayoutNameError(error)) throw new LayoutNameConflictError()
    if (isForeignKeyConstraintError(error)) {
      await assertMenuReferencesAvailable(db, document)
    }
    throw error
  }
  return await rowToAdminResource(db, row)
}

export async function listLayouts(event: H3Event): Promise<LayoutListResponse> {
  const db = await getDb(event)
  let rows: LayoutRow[]
  try {
    rows = await db.select().from(layoutResourceTable).orderBy(asc(layoutResourceTable.nameKey))
  } catch (error) {
    if (isMissingLayoutTableError(error)) throw new LayoutStorageUnavailableError()
    throw error
  }
  return {
    presets: structuredClone(layoutPresetMetadata()) as LayoutPresetMetadata[],
    elementDescriptors: structuredClone(layoutElementDescriptors) as LayoutElementDescriptor[],
    items: await Promise.all(rows.map(row => rowToAdminResource(db, row)))
  }
}

export async function getLayout(event: H3Event, layoutIdInput: unknown) {
  const layoutId = validateLayoutId(layoutIdInput)
  const db = await getDb(event)
  return await rowToAdminResource(db, await requireLayoutRow(db, layoutId))
}

export async function createLayout(event: H3Event, body: unknown, actorId: string | null) {
  const parsed = layoutCreateSchema.safeParse(body)
  if (!parsed.success) throw new LayoutValidationError(zodValidationIssues(parsed.error))
  const db = await getDb(event)
  const layoutId = newId()
  const forbiddenName = findForbiddenLayoutData({ name: parsed.data.name })
  if (forbiddenName.length) throw new LayoutValidationError(forbiddenName.map(issue => ({ ...issue, path: 'name' })))
  const document = createLayoutDocumentFromPreset(parsed.data.presetKey, layoutId, parsed.data.name, () => newId())
  return await createLayoutFromDocument(event, db, document, actorId)
}

async function saveLayoutDocument(
  event: H3Event,
  layoutId: string,
  expectedRevision: number,
  documentInput: LayoutDocument,
  actorId: string | null,
  action: Extract<DocumentRevisionAction, 'save' | 'rename'>
) {
  const validated = parseLayoutDocument(documentInput)
  if (!validated.success) {
    throw new LayoutValidationError(validated.issues.map(issue => ({ ...issue, path: ['document', issue.path].filter(Boolean).join('.') })))
  }
  const document = validated.document
  const db = await getDb(event)
  const existing = await requireLayoutRow(db, layoutId)
  // Stale writers must receive the current resource metadata before any
  // validation that depends on the current name or Menu state.
  assertExpectedRevision(existing, expectedRevision)
  if (action === 'save' && document.name !== existing.name) {
    throw new LayoutValidationError([{
      path: 'document.name',
      message: 'Rename the Layout through the dedicated rename endpoint',
      kind: 'invalid'
    }])
  }
  await assertLayoutNameAvailable(db, document.name, layoutId)
  await ensureBuiltInMenuReferences(event, db, document)
  await assertMenuReferencesAvailable(db, document)

  try {
    await mutateWithDocumentRevision({
      event,
      db,
      identity: existing,
      expectedRevision,
      documentKind: 'layout',
      documentId: layoutId,
      action,
      state: { snapshot: document, status: 'active', title: document.name },
      actorId,
      preserveOrdinarySaves: true,
      work: async (tx, statements, nextRevision, now) => {
        await guardLayoutResourceRevision(tx, statements, layoutId, expectedRevision)
        await executeDbStatement(tx.update(layoutResourceTable).set({
          name: document.name,
          nameKey: layoutNameKey(document.name),
          documentJson: serializeLayoutDocument(document),
          currentRevision: nextRevision,
          updatedBy: actorId,
          updatedAt: now
        }).where(and(
          eq(layoutResourceTable.id, layoutId),
          eq(layoutResourceTable.currentRevision, expectedRevision)
        )), statements)
        await syncMenuReferences(tx, statements, document, now)
      }
    })
  } catch (error) {
    await rethrowResourceRevisionConflict(error, db, layoutId, expectedRevision)
    if (isUniqueLayoutNameError(error)) throw new LayoutNameConflictError()
    if (isForeignKeyConstraintError(error)) {
      await assertMenuReferencesAvailable(db, document)
    }
    throw error
  }

  const row = await requireLayoutRow(db, layoutId)
  if (row.currentRevision !== expectedRevision + 1) throw revisionConflict(row)
  return await rowToAdminResource(db, row)
}

export async function updateLayout(
  event: H3Event,
  layoutIdInput: unknown,
  body: unknown,
  actorId: string | null
) {
  const layoutId = validateLayoutId(layoutIdInput)
  const parsedBody = layoutUpdateSchema.safeParse(body)
  if (!parsedBody.success) throw new LayoutValidationError(zodValidationIssues(parsedBody.error))
  const parsedDocument = parseLayoutDocument(parsedBody.data.document)
  if (!parsedDocument.success) {
    throw new LayoutValidationError(parsedDocument.issues.map(issue => ({ ...issue, path: ['document', issue.path].filter(Boolean).join('.') })))
  }
  if (parsedDocument.document.layoutId !== layoutId) {
    throw new LayoutValidationError([{
      path: 'document.layoutId',
      message: 'Layout ID cannot be changed',
      kind: 'invalid'
    }])
  }
  return await saveLayoutDocument(event, layoutId, parsedBody.data.revision, parsedDocument.document, actorId, 'save')
}

export async function renameLayout(
  event: H3Event,
  layoutIdInput: unknown,
  body: unknown,
  actorId: string | null
) {
  const layoutId = validateLayoutId(layoutIdInput)
  const parsed = layoutRenameSchema.safeParse(body)
  if (!parsed.success) throw new LayoutValidationError(zodValidationIssues(parsed.error))
  const db = await getDb(event)
  const existing = await requireLayoutRow(db, layoutId)
  const stored = parseStoredLayout(existing)
  if (!stored.success) throw new LayoutValidationError('Repair the stored Layout document before renaming it')
  return await saveLayoutDocument(event, layoutId, parsed.data.revision, {
    ...stored.document,
    name: parsed.data.name
  }, actorId, 'rename')
}

export async function duplicateLayout(
  event: H3Event,
  layoutIdInput: unknown,
  body: unknown,
  actorId: string | null
) {
  const layoutId = validateLayoutId(layoutIdInput)
  const parsed = layoutDuplicateSchema.safeParse(body)
  if (!parsed.success) throw new LayoutValidationError(zodValidationIssues(parsed.error))
  const db = await getDb(event)
  const existing = await requireLayoutRow(db, layoutId)
  const stored = parseStoredLayout(existing)
  if (!stored.success) throw new LayoutValidationError('Repair the stored Layout document before duplicating it')
  const duplicateId = newId()
  const document = {
    ...structuredClone(stored.document),
    layoutId: duplicateId,
    name: parsed.data.name,
    elements: stored.document.elements.map(element => ({ ...structuredClone(element), id: newId() }))
  }
  const validated = parseLayoutDocument(document)
  if (!validated.success) throw new LayoutValidationError(validated.issues)
  return await createLayoutFromDocument(event, db, validated.document, actorId)
}

export async function getLayoutUsage(event: H3Event, layoutIdInput: unknown) {
  const layoutId = validateLayoutId(layoutIdInput)
  const db = await getDb(event)
  const row = await requireLayoutRow(db, layoutId)
  const usage = await listLayoutUsage(db, layoutId)
  return { id: row.id, revision: row.currentRevision, usage, canDelete: usage.length === 0 }
}

export async function deleteLayout(
  event: H3Event,
  layoutIdInput: unknown,
  body: unknown,
  actorId: string | null
) {
  const layoutId = validateLayoutId(layoutIdInput)
  const parsed = layoutDeleteSchema.safeParse(body)
  if (!parsed.success) throw new LayoutValidationError(zodValidationIssues(parsed.error))
  const db = await getDb(event)
  const existing = await requireLayoutRow(db, layoutId)
  const stored = parseStoredLayout(existing)
  const safeSnapshot = stored.success
    ? stored.document
    : { version: LAYOUT_DOCUMENT_VERSION, layoutId, name: safeStoredLayoutName(existing), repairRequired: true }

  try {
    await mutateWithDocumentRevision({
      event,
      db,
      identity: existing,
      expectedRevision: parsed.data.revision,
      documentKind: 'layout',
      documentId: layoutId,
      action: 'delete',
      state: { snapshot: safeSnapshot, status: 'deleted', title: safeStoredLayoutName(existing) },
      actorId,
      preserveOrdinarySaves: true,
      work: async (tx, statements) => {
        await guardLayoutResourceRevision(tx, statements, layoutId, parsed.data.revision)
        // Do not pre-delete normalized Layout assignments: the restrictive FK
        // must make an assignment/delete race fail atomically and actionably.
        await executeDbStatement(tx.delete(layoutResourceTable).where(and(
          eq(layoutResourceTable.id, layoutId),
          eq(layoutResourceTable.currentRevision, parsed.data.revision)
        )), statements)
        // Clean up Layout-owned Menu references only after the guarded resource
        // delete succeeded. If it matched zero rows because the resource
        // revision advanced, the resource still exists and this predicate keeps
        // every reference intact. Both statements run in one SQLite transaction
        // or D1 batch, so assignment-FK failures roll the cleanup back as well.
        await executeDbStatement(tx.delete(siteMenuReferenceTable).where(and(
          eq(siteMenuReferenceTable.ownerType, 'site-layout'),
          eq(siteMenuReferenceTable.ownerId, layoutId),
          notExists(tx.select({ one: sql`1` }).from(layoutResourceTable)
            .where(eq(layoutResourceTable.id, layoutId)))
        )), statements)
      }
    })
  } catch (error) {
    await rethrowResourceRevisionConflict(error, db, layoutId, parsed.data.revision)
    if (isForeignKeyConstraintError(error)) throw new LayoutInUseError(await listLayoutUsage(db, layoutId))
    throw error
  }

  const remaining = await findLayoutRow(db, layoutId)
  if (remaining) {
    const usage = await listLayoutUsage(db, layoutId)
    if (usage.length) throw new LayoutInUseError(usage)
    throw revisionConflict(remaining)
  }
  return { deleted: true as const, id: layoutId, revision: parsed.data.revision + 1 }
}

export async function resolveLayoutProjection(event: H3Event, layoutIdInput: unknown): Promise<ResolvedLayoutProjection> {
  const parsedId = layoutIdSchema.safeParse(layoutIdInput)
  if (!parsedId.success) return { status: 'missing', layoutId: 'invalid-layout', reason: 'Layout ID is invalid' }
  const db = await getDb(event)
  const row = await findLayoutRow(db, parsedId.data)
  if (!row) return { status: 'missing', layoutId: parsedId.data, reason: 'Layout resource is missing' }
  const stored = parseStoredLayout(row)
  if (!stored.success) {
    return { status: 'repair-required', layoutId: row.id, reason: 'Stored Layout document failed strict validation' }
  }
  return {
    status: 'ready',
    version: LAYOUT_DOCUMENT_VERSION,
    layoutId: row.id,
    name: row.name,
    revision: row.currentRevision,
    document: stored.document
  }
}
