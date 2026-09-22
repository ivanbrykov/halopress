import { getDb } from '../../../db/db'
import { getDraft, getPublishedSchema } from '../../../cms/repo'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const schemaKey = event.context.params?.schemaKey as string
  const db = await getDb(event)
  const draft = await getDraft(db, schemaKey)
  if (draft) return draft

  const active = await getPublishedSchema(db, schemaKey, { includeInactive: true })
  if (active) {
    return { schemaKey, title: active.title, ast: active.ast, updatedAt: active.updatedAt }
  }

  return null
})
