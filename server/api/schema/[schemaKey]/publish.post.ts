import { readBody } from 'h3'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../../db/db'
import { compileSchemaAst } from '../../../cms/compiler'
import { syncContentListing } from '../../../cms/content-listing'
import { getDraft, getPublishedSchema } from '../../../cms/repo'
import { getKindChanges, migrateSchemaContent } from '../../../cms/migrate'
import { syncSearchIndexForSchema } from '../../../cms/search-index'
import { schema as schemaTable } from '../../../db/schema'
import { requireAdmin } from '../../../utils/auth'
import { badRequest, notFound } from '../../../utils/http'
import { schemaAstSchema } from '../../../cms/zod'
import { assertSchemaKeyCanBePersisted, assertSchemaKeyCanBePublished } from '../../../cms/schema-key'
import { assertExpectedRevision, requireExpectedRevision } from '../../../cms/document-revisions'
import { getTrustedRequestOrigin } from '../../../utils/request-origin'
import { queueWidgetCacheInvalidation } from '../../../utils/widget-cache'
import { queueFullTextReconcile } from '../../../utils/full-text-queue'
import { assertPublicRouteAvailable } from '../../../cms/public-routes'
import { commitSchemaPublication } from '../../../cms/schema-publication'
import {
  LayoutAssignmentValidationError,
  assertReadyLayoutAssignment,
  layoutAssignmentHttpError,
  parseLayoutAssignmentField,
  prepareLayoutAssignmentChange
} from '../../../utils/layout-assignments'

const DEFAULT_PRESENTATION = {
  contractVersion: 1 as const,
  preset: 'generic' as const,
  collectionTemplate: 'list' as const,
  detailTemplate: 'document' as const
}

function schemaPresentationAssignmentInput(body: unknown) {
  const direct = parseLayoutAssignmentField(body)
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const ast = record.ast && typeof record.ast === 'object' ? record.ast as Record<string, unknown> : {}
  const presentation = ast.presentation && typeof ast.presentation === 'object'
    ? ast.presentation as Record<string, unknown>
    : {}
  const nested = parseLayoutAssignmentField(presentation)
  if (direct.provided && nested.provided && direct.layoutId !== nested.layoutId) {
    throw new LayoutAssignmentValidationError('Conflicting Layout assignments were supplied')
  }
  return direct.provided ? direct : nested
}

function withSchemaLayoutId(ast: any, layoutId: string | null) {
  if (!ast.presentation && layoutId === null) return ast
  const presentation = { ...(ast.presentation ?? DEFAULT_PRESENTATION) }
  if (layoutId === null) delete presentation.layoutId
  else presentation.layoutId = layoutId
  return { ...ast, presentation }
}

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const schemaKey = event.context.params?.schemaKey as string
  const body = await readBody<{ ast?: unknown; note?: string; migrate?: boolean; revision?: number; layoutId?: string | null }>(event)
  const db = await getDb(event)

  const draft = await getDraft(db, schemaKey)
  if (!draft) throw notFound('Draft not found')
  assertExpectedRevision({
    currentRevision: draft.revision,
    updatedAt: draft.updatedAt,
    updatedBy: draft.updatedBy
  }, requireExpectedRevision(body?.revision))

  let requestedAst: any = null
  if (body?.ast) {
    const parsed = schemaAstSchema.safeParse(body.ast)
    if (!parsed.success) throw badRequest('Invalid AST', parsed.error.flatten())
    requestedAst = parsed.data
  } else {
    requestedAst = draft.ast
  }
  let ast: any
  let layoutId: string | null
  try {
    const assignmentInput = schemaPresentationAssignmentInput(body)
    layoutId = await prepareLayoutAssignmentChange({
      event,
      db,
      body: assignmentInput.provided ? { layoutId: assignmentInput.layoutId } : {},
      currentLayoutId: draft.ast.presentation?.layoutId ?? null
    })
    // Publish validates the selected resource even when the assignment did not
    // change, so a broken draft can never become a new public Schema version.
    await assertReadyLayoutAssignment(db, layoutId)
    ast = withSchemaLayoutId(requestedAst, layoutId)
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }
  if (ast.schemaKey !== schemaKey) throw badRequest('schemaKey mismatch')
  await assertSchemaKeyCanBePersisted(db, schemaKey)
  assertSchemaKeyCanBePublished(schemaKey)

  const latest = await db
    .select({ version: schemaTable.version })
    .from(schemaTable)
    .where(eq(schemaTable.schemaKey, schemaKey))
    .orderBy(desc(schemaTable.version))
    .get()

  const nextVersion = (latest?.version ?? 0) + 1
  let compiled: ReturnType<typeof compileSchemaAst>
  try {
    compiled = compileSchemaAst(ast, nextVersion)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid presentation bindings')
  }
  const active = await getPublishedSchema(db, schemaKey, { includeInactive: true })
  const kindChanges = getKindChanges(active?.ast ?? null, ast)
  const listingChanged = JSON.stringify(active?.registry?.listing ?? null) !== JSON.stringify(compiled.registry.listing ?? null)

  const now = new Date()

  // Schema publication has several legacy post-publish synchronization steps,
  // so reject collection-path collisions before writing the new version.
  await assertPublicRouteAvailable({
    db,
    documentKind: 'schema',
    documentId: schemaKey,
    path: `/${schemaKey}`
  })

  try {
    await commitSchemaPublication({
      event,
      db,
      schemaKey,
      expectedDraftRevision: draft.revision,
      version: nextVersion,
      previousVersion: latest?.version ?? null,
      title: ast.title,
      ast,
      jsonSchema: compiled.jsonSchema,
      uiSchema: compiled.uiSchema,
      registry: compiled.registry,
      note: body?.note?.trim() || null,
      actorId,
      layoutId,
      now
    })
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }

  let migrated = 0
  if (body?.migrate && kindChanges.length) {
    const result = await migrateSchemaContent({
      event,
      db,
      schemaKey,
      nextVersion,
      registry: compiled.registry,
      changes: kindChanges,
      actorId,
      trustedOrigin: getTrustedRequestOrigin(event)
    })
    migrated = result.updated
  }

  const searchIndex = await syncSearchIndexForSchema({ db, schemaKey, registry: compiled.registry })

  if (listingChanged && !(body?.migrate && kindChanges.length)) {
    await syncContentListing({ db, schemaKey, onlyMissing: false })
  }

  // Dynamic Menu sources depend on the exact active search configuration,
  // including changes that do not alter listing fields or migrate content.
  queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)
  queueFullTextReconcile(event)

  return { ok: true, schemaKey, version: nextVersion, migrated, searchIndexed: searchIndex.indexed }
})
