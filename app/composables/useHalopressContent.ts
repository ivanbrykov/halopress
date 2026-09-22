import { computed, unref } from 'vue'
import type { MaybeRef } from 'vue'
import { convertJsonSchemaToZod } from 'zod-from-json-schema'
import type { HalopressItem } from './useHalopressQuery'
import type { StandaloneStructuredContentRendering } from '~~/shared/standalone-document'

export type HalopressContent<TContent = Record<string, unknown>> = HalopressItem & {
  content: TContent
  extra?: TContent
  rendering?: StandaloneStructuredContentRendering
}

export type HalopressSurroundings = {
  prev: HalopressItem | null
  next: HalopressItem | null
}

export type HalopressContentOptions = {
  id?: MaybeRef<string | number>
  order?: MaybeRef<'asc' | 'desc'>
  status?: MaybeRef<string>
  includeRendering?: MaybeRef<boolean>
  respectStandalonePageClaim?: MaybeRef<boolean>
}

type HalopressContentResponse<TContent = Record<string, unknown>> = HalopressContent<TContent> & {
  surroundings?: HalopressSurroundings
}

function parseTarget(schemaOrPath: string, id?: string | number | null) {
  const trimmed = schemaOrPath.trim()
  if (trimmed.includes('/')) {
    const [schemaKey, contentId] = trimmed.split('/').filter(Boolean)
    return { schemaKey, contentId }
  }
  return { schemaKey: trimmed, contentId: id != null ? String(id) : '' }
}

export async function useHalopressContent(schemaOrPath: MaybeRef<string>, options: HalopressContentOptions = {}) {
  const target = computed(() => {
    const raw = unref(schemaOrPath)
    return parseTarget(raw == null ? '' : String(raw), unref(options.id))
  })
  const schemaKey = computed(() => target.value.schemaKey)
  const contentId = computed(() => target.value.contentId)

  const query = computed(() => ({
    order: unref(options.order) ?? undefined,
    status: unref(options.status) ?? undefined,
    rendering: unref(options.includeRendering) === false ? '0' : undefined,
    routeScope: unref(options.respectStandalonePageClaim) ? 'public-page' : undefined,
    surroundings: '1',
    includeSchema: '1'
  }))

  const { data, refresh, pending, error } = await useFetch<HalopressContentResponse & { schema?: any }>(
    () => `/api/content/${schemaKey.value}/${contentId.value}`,
    { query }
  )
  const schema = computed(() => data.value?.schema ?? null)

  const schemaZod = computed(() => {
    if (!schema.value?.jsonSchema) return null
    try {
      return convertJsonSchemaToZod(schema.value.jsonSchema)
    } catch (err) {
      if (import.meta.dev) {
        console.warn(`[halopress] Failed to convert jsonSchema for ${schemaKey.value}`, err)
      }
      return null
    }
  })

  const content = computed(() => {
    if (!data.value) return null
    const { surroundings: _surroundings, schema: _schema, ...base } = data.value
    if (!base) return null
    const rawContent = (base as any).content ?? (base as any).extra ?? {}
    const zodSchema = schemaZod.value
    if (!zodSchema) return base
    const result = zodSchema.safeParse(rawContent)
    if (result.success) {
      return {
        ...base,
        content: result.data,
        extra: result.data
      }
    }
    if (import.meta.dev) {
      console.warn(`[halopress] Content payload failed schema validation for ${schemaKey.value}/${contentId.value}`, result.error)
    }
    return {
      ...base,
      content: rawContent,
      extra: rawContent
    }
  })

  const surroundings = computed(() => data.value?.surroundings ?? { prev: null, next: null })

  return {
    content,
    surroundings,
    schema,
    schemaZod,
    reload: refresh,
    pending,
    error
  }
}
