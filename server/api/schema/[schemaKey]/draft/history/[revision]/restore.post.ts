import { and, eq } from 'drizzle-orm'
import { readBody } from 'h3'

import { getDocumentRevision, mutateWithDocumentRevision, requireExpectedRevision } from '../../../../../../cms/document-revisions'
import { getDraft } from '../../../../../../cms/repo'
import { schemaAstSchema } from '../../../../../../cms/zod'
import { getDb } from '../../../../../../db/db'
import { schemaDraft as schemaDraftTable } from '../../../../../../db/schema'
import { executeDbStatement } from '../../../../../../db/transaction'
import { requireAdmin } from '../../../../../../utils/auth'
import { badRequest, notFound } from '../../../../../../utils/http'
import {
  layoutAssignmentHttpError,
  prepareLayoutAssignmentChange,
  schemaLayoutAssignmentOwner,
  syncLayoutAssignmentReference
} from '../../../../../../utils/layout-assignments'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const schemaKey = event.context.params?.schemaKey as string
  const targetRevision = Number(event.context.params?.revision)
  const body = await readBody<{ revision?: number }>(event)
  const expectedRevision = requireExpectedRevision(body?.revision)
  const db = await getDb(event)
  const existing = await getDraft(db, schemaKey)
  if (!existing) throw notFound('Draft not found')
  const target = await getDocumentRevision(db, 'schema-draft', schemaKey, targetRevision)
  const parsedTarget = schemaAstSchema.safeParse(target.snapshot)
  if (!parsedTarget.success) throw badRequest('Stored Schema revision is invalid', parsedTarget.error.flatten())
  const targetLayoutId = parsedTarget.data.presentation?.layoutId ?? null

  try {
    const layoutId = await prepareLayoutAssignmentChange({
      event,
      db,
      body: { layoutId: targetLayoutId },
      currentLayoutId: existing.ast.presentation?.layoutId ?? null
    })
    await mutateWithDocumentRevision({
      event,
      db,
      identity: { currentRevision: existing.revision, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy },
      expectedRevision,
      documentKind: 'schema-draft',
      documentId: schemaKey,
      schemaKey,
      action: 'restore',
      state: { snapshot: parsedTarget.data, title: target.title },
      actorId,
      work: async (tx, statements, nextRevision, now) => {
        await executeDbStatement(tx.update(schemaDraftTable).set({
          title: target.title,
          astJson: JSON.stringify(parsedTarget.data),
          currentRevision: nextRevision,
          updatedBy: actorId,
          updatedAt: now
        }).where(and(
          eq(schemaDraftTable.schemaKey, schemaKey),
          eq(schemaDraftTable.currentRevision, expectedRevision)
        )), statements)
        await syncLayoutAssignmentReference({
          db: tx,
          statements,
          owner: schemaLayoutAssignmentOwner(schemaKey, 'working'),
          layoutId,
          now
        })
      }
    })
  } catch (error) {
    throw layoutAssignmentHttpError(error)
  }

  return { ok: true, revision: expectedRevision + 1 }
})
