import { readBody } from 'h3'
import { getDb } from '../../../db/db'
import {
  assertSchemaKeyCanBePersisted,
  isReservedSchemaKeyError,
  RESERVED_SCHEMA_KEY_MESSAGE
} from '../../../cms/schema-key'
import { schemaAstSchema } from '../../../cms/zod'
import { compileSchemaAst } from '../../../cms/compiler'
import { requireStaff } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireStaff(event)
  const schemaKey = event.context.params?.schemaKey as string
  const body = await readBody<{ ast?: unknown }>(event)
  const parsed = schemaAstSchema.safeParse(body?.ast)
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() }
  if (parsed.data.schemaKey !== schemaKey) {
    return { ok: false, error: { formErrors: ['schemaKey mismatch'], fieldErrors: {} } }
  }
  try {
    compileSchemaAst(parsed.data, 1)
  } catch (error) {
    return {
      ok: false,
      error: {
        formErrors: [error instanceof Error ? error.message : 'Invalid presentation bindings'],
        fieldErrors: {}
      }
    }
  }
  try {
    await assertSchemaKeyCanBePersisted(await getDb(event), schemaKey)
  } catch (error) {
    if (!isReservedSchemaKeyError(error)) throw error
    return {
      ok: false,
      error: {
        formErrors: [],
        fieldErrors: { schemaKey: [RESERVED_SCHEMA_KEY_MESSAGE] }
      }
    }
  }
  return { ok: true }
})
