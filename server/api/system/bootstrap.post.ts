import { getDb } from '../../db/db'
import { requireAdmin } from '../../utils/auth'
import { ensureBootstrapSchema } from '../../utils/install'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const actorId = (session.user as any)?.id ?? null
  const db = await getDb(event)
  const schemaKey = await ensureBootstrapSchema(db, actorId ? `user:${actorId}` : 'system:bootstrap', event)

  return schemaKey
    ? { ok: true, schemaKey }
    : { ok: true, already: true }
})
