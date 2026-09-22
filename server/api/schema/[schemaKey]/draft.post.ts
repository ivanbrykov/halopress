import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'
import { getDb } from '../../../db/db'
import { getDraft, getPublishedSchema } from '../../../cms/repo'
import { createInitialDocumentRevision, mutateWithDocumentRevision, requireExpectedRevision } from '../../../cms/document-revisions'
import { assertSchemaKeyCanBePersisted } from '../../../cms/schema-key'
import { schemaAstSchema } from '../../../cms/zod'
import { schemaDraft as schemaDraftTable } from '../../../db/schema'
import { executeDbStatement, withDbTransaction } from '../../../db/transaction'
import { requireAdmin } from '../../../utils/auth'
import { badRequest } from '../../../utils/http'
import {
  LayoutAssignmentValidationError,
  layoutAssignmentHttpError,
  parseLayoutAssignmentField,
  prepareLayoutAssignmentChange,
  schemaLayoutAssignmentOwner,
  syncLayoutAssignmentReference
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
  const body = await readBody<{ ast?: unknown; title?: string; revision?: number; layoutId?: string | null }>(event)

  const parsed = schemaAstSchema.safeParse(body?.ast)
  if (!parsed.success) throw badRequest('Invalid AST', parsed.error.flatten())
  if (parsed.data.schemaKey !== schemaKey) throw badRequest('schemaKey mismatch')

  const title = body?.title?.trim() || parsed.data.title
  const db = await getDb(event)
  await assertSchemaKeyCanBePersisted(db, schemaKey)
  const existing = await getDraft(db, schemaKey)
  const published = existing ? null : await getPublishedSchema(db, schemaKey, { includeInactive: true })
  const currentLayoutId = existing?.ast.presentation?.layoutId ?? published?.ast.presentation?.layoutId ?? null
  const now = new Date()

  try {
    const assignmentInput = schemaPresentationAssignmentInput(body)
    const layoutId = await prepareLayoutAssignmentChange({
      event,
      db,
      body: assignmentInput.provided ? { layoutId: assignmentInput.layoutId } : {},
      currentLayoutId
    })
    const ast = withSchemaLayoutId(parsed.data, layoutId)

    if (!existing) {
      await withDbTransaction(event, db, async (tx: any, statements) => {
        await executeDbStatement(tx.insert(schemaDraftTable).values({
          schemaKey,
          title,
          astJson: JSON.stringify(ast),
          currentRevision: 1,
          updatedBy: actorId,
          updatedAt: now
        }), statements)
        await createInitialDocumentRevision({
          tx,
          statements,
          documentKind: 'schema-draft',
          documentId: schemaKey,
          schemaKey,
          state: { snapshot: ast, title },
          actorId,
          createdAt: now
        })
        await syncLayoutAssignmentReference({
          db: tx,
          statements,
          owner: schemaLayoutAssignmentOwner(schemaKey, 'working'),
          layoutId,
          now
        })
      })
      return { ok: true, revision: 1 }
    }

    const expectedRevision = requireExpectedRevision(body?.revision)
    await mutateWithDocumentRevision({
      event,
      db,
      identity: { currentRevision: existing.revision, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy },
      expectedRevision,
      documentKind: 'schema-draft',
      documentId: schemaKey,
      schemaKey,
      action: 'save',
      state: { snapshot: ast, title },
      actorId,
      work: async (tx, statements, nextRevision, savedAt) => {
        await executeDbStatement(tx.update(schemaDraftTable).set({
          title,
          astJson: JSON.stringify(ast),
          currentRevision: nextRevision,
          updatedBy: actorId,
          updatedAt: savedAt
        }).where(and(
          eq(schemaDraftTable.schemaKey, schemaKey),
          eq(schemaDraftTable.currentRevision, expectedRevision)
        )), statements)
        await syncLayoutAssignmentReference({
          db: tx,
          statements,
          owner: schemaLayoutAssignmentOwner(schemaKey, 'working'),
          layoutId,
          now: savedAt
        })
      }
    })

    return { ok: true, revision: expectedRevision + 1 }
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }
})
