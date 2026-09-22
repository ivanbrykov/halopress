import { convertJsonSchemaToZod } from 'zod-from-json-schema'
import { badRequest } from '../utils/http'

export function validateContentJson(jsonSchema: unknown, content: Record<string, unknown>) {
  const schema = convertJsonSchemaToZod(jsonSchema as any)
  const result = schema.safeParse(content)
  if (result.success) return result.data as Record<string, unknown>

  throw badRequest('Invalid content', result.error.flatten())
}
