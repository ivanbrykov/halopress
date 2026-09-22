import type { MaybeRefOrGetter } from 'vue'

type SchemaDraftResponse = {
  schemaKey: string
  title: string
  ast: Record<string, any>
  revision?: number
  updatedAt?: string
}

type PublishedSchemaResponse = {
  version: number
  ast: Record<string, any>
  status?: 'active' | 'inactive'
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isConflict(error: any) {
  return error?.statusCode === 409 || error?.status === 409 || error?.response?.status === 409
}

export async function useSchemaSettingsDraft(schemaKey: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean> = true) {
  const draftRequest = useFetch<SchemaDraftResponse | null>(
    () => `/api/schema/${toValue(schemaKey)}/draft`,
    {
      key: `schema-settings-draft:${toValue(schemaKey)}`,
      immediate: toValue(enabled)
    }
  )
  const publishedRequest = useFetch<PublishedSchemaResponse | null>(
    () => `/api/schema/${toValue(schemaKey)}/definition`,
    {
      key: `schema-settings-published:${toValue(schemaKey)}`,
      immediate: toValue(enabled)
    }
  )
  await Promise.all([draftRequest, publishedRequest])

  const ast = ref<Record<string, any> | null>(null)
  const revision = ref(0)
  const savedAstJson = ref('')
  const conflict = ref<Record<string, any> | null>(null)
  const saving = ref(false)

  function replaceFromServer(value: SchemaDraftResponse | null | undefined) {
    ast.value = value?.ast ? clone(value.ast) : null
    revision.value = Number(value?.revision ?? 0)
    savedAstJson.value = stableStringify(ast.value)
  }

  watch(draftRequest.data, value => replaceFromServer(value), { immediate: true })

  const currentAstJson = computed(() => stableStringify(ast.value))
  const isDirty = computed(() => ast.value !== null && currentAstJson.value !== savedAstJson.value)
  const differsFromPublished = computed(() => {
    if (!ast.value) return false
    return stableStringify(ast.value) !== stableStringify(publishedRequest.data.value?.ast ?? null)
  })

  async function save() {
    if (!ast.value || !isDirty.value || saving.value) return false
    saving.value = true
    conflict.value = null
    const localAst = clone(ast.value)
    try {
      const result = await $fetch<{ revision: number }>(`/api/schema/${toValue(schemaKey)}/draft`, {
        method: 'POST',
        body: {
          revision: revision.value,
          title: localAst.title,
          ast: localAst,
          layoutId: localAst.presentation?.layoutId ?? null
        }
      })
      revision.value = Number(result.revision)
      savedAstJson.value = stableStringify(localAst)
      return true
    } catch (error: any) {
      if (isConflict(error)) {
        const details = error?.data?.data ?? error?.data ?? {}
        conflict.value = typeof details === 'object' ? details : {}
        return false
      }
      throw error
    } finally {
      saving.value = false
    }
  }

  async function reloadLatest() {
    await draftRequest.refresh()
    replaceFromServer(draftRequest.data.value)
    conflict.value = null
  }

  return {
    ast,
    revision,
    published: publishedRequest.data,
    pending: draftRequest.pending,
    status: draftRequest.status,
    error: draftRequest.error,
    saving,
    isDirty,
    differsFromPublished,
    conflict,
    save,
    reloadLatest,
    refreshPublished: publishedRequest.refresh
  }
}
