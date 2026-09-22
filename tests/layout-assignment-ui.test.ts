import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

async function source(path: string) {
  return await readFile(resolve(projectRoot, path), 'utf8')
}

function createNuxtLikeAsyncData<T>() {
  const state = {
    data: ref<T | null>(null),
    pending: ref(true),
    status: ref<'idle' | 'pending' | 'success' | 'error'>('pending'),
    error: ref<any>(null),
    refresh: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
    clear: vi.fn(() => {})
  }
  const promise = Object.assign(Promise.resolve(state), state)
  Object.defineProperties(promise, {
    then: { enumerable: true, value: promise.then.bind(promise) },
    catch: { enumerable: true, value: promise.catch.bind(promise) },
    finally: { enumerable: true, value: promise.finally.bind(promise) }
  })
  return {
    state,
    promise
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('Layout assignment selector', () => {
  it('offers only ready searchable IDs and normalizes clear without accepting arbitrary input', async () => {
    const selector = await source('app/components/LayoutAssignmentSelect.vue')

    expect(selector).toContain('.filter(item => item.status === \'ready\')')
    expect(selector).toContain('value-key="id"')
    expect(selector).toContain('label-key="label"')
    expect(selector).toContain('description-key="description"')
    expect(selector).toContain(':filter-fields="[\'label\', \'description\']"')
    expect(selector).toContain(':search-input="{ placeholder: \'Search Layouts…\' }"')
    expect(selector).toContain(':clear="effectiveModeEnabled && !controlsDisabled && model !== null"')
    expect(selector).toMatch(/typeof value === 'string' && readyIds\.value\.has\(value\)/)
    expect(selector).toMatch(/model\.value = null/)
    expect(selector).not.toContain('create-item')
  })

  it('keeps stored invalid, loading, error, missing, and repair assignments visible but unselectable', async () => {
    const selector = await source('app/components/LayoutAssignmentSelect.vue')

    expect(selector).toContain('status: \'repair-required\'')
    expect(selector).toContain('status: \'missing\'')
    expect(selector).toContain('status: \'loading\'')
    expect(selector).toContain('status: \'error\'')
    expect(selector).toContain('status: \'invalid\'')
    expect(selector).toContain('diagnosticItem.value ? [diagnosticItem.value, ...readyItems.value]')
    expect(selector.match(/disabled: true/g)).toHaveLength(5)
    expect(selector).toContain('Invalid Layout assignment')
    expect(selector).toContain('Assigned Layout needs repair')
    expect(selector).toContain('Assigned Layout is missing')
    expect(selector).toContain('Layouts are unavailable')
    expect(selector).toContain('No ready Layouts are available')
    expect(selector).toContain(':loading="pending"')
    expect(selector).toContain(':data-layout-assignment-status="selectedStatus"')
  })

  it('renders Site-mode-off assignments read-only without clearing the model', async () => {
    const selector = await source('app/components/LayoutAssignmentSelect.vue')
    const disabledStart = selector.indexOf('const controlsDisabled')
    const updateStart = selector.indexOf('function updateModel')

    expect(selector.slice(disabledStart, updateStart)).toContain('!effectiveModeEnabled.value')
    expect(selector).toContain('The stored Layout assignment is preserved and read-only.')
    expect(selector).toContain(':disabled="controlsDisabled"')
    expect(selector).not.toMatch(/watch\([^)]*effectiveModeEnabled[^)]*model\.value\s*=\s*null/s)
  })
})

describe('Layout assignment composables', () => {
  it('returns options synchronously without leaking the raw useFetch thenable', async () => {
    const { state, promise } = createNuxtLikeAsyncData<{
      modeEnabled: boolean
      items: Array<{ id: string, name: string, revision: number, status: 'ready' | 'repair-required' }>
    }>()
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useFetch', vi.fn(() => promise))

    const { useLayoutAssignmentOptions } = await import('../app/composables/useLayoutAssignmentOptions')
    const result = useLayoutAssignmentOptions()

    expect(Object.keys(promise)).toContain('then')
    expect(result).not.toHaveProperty('then')
    expect(result).not.toHaveProperty('catch')
    expect(result).not.toHaveProperty('finally')
    expect(await result).toBe(result)
    expect(result.data).toBe(state.data)
    expect(result.modeEnabled.value).toBe(false)
    expect(result.readyItems.value).toEqual([])

    state.data.value = {
      modeEnabled: true,
      items: [
        { id: 'ready-layout', name: 'Ready', revision: 2, status: 'ready' },
        { id: 'repair-layout', name: 'Repair', revision: 3, status: 'repair-required' }
      ]
    }
    expect(result.modeEnabled.value).toBe(true)
    expect(result.readyItems.value.map(item => item.id)).toEqual(['ready-layout'])
  })

  it('returns Site settings synchronously and updates caches after a typed save', async () => {
    const { state, promise } = createNuxtLikeAsyncData<any>()
    const response = {
      value: { version: 1, layoutId: 'layout-one' },
      configured: true,
      malformedStoredValue: false,
      storedLayoutId: 'layout-one',
      updatedAt: '2026-07-18T00:00:00.000Z',
      updatedBy: 'admin-1',
      modeEnabled: true,
      assignment: null
    }
    const fetch = vi.fn(async () => response)
    const refreshNuxtData = vi.fn(async () => {})
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', vi.fn(() => promise))
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('refreshNuxtData', refreshNuxtData)
    vi.stubGlobal('LAYOUT_ASSIGNMENT_OPTIONS_DATA_KEY', 'layout-assignment-options')

    const { useSiteLayoutAssignmentSettings } = await import('../app/composables/useSiteLayoutAssignmentSettings')
    const result = useSiteLayoutAssignmentSettings()

    expect(result).not.toHaveProperty('then')
    expect(result).not.toHaveProperty('catch')
    expect(result).not.toHaveProperty('finally')
    expect(await result).toBe(result)
    await result.saveLayoutAssignment('layout-one')
    expect(fetch).toHaveBeenCalledWith('/api/settings/site-layout', {
      method: 'PUT',
      body: { layoutId: 'layout-one' }
    })
    expect(state.data.value).toEqual(response)
    expect(refreshNuxtData).toHaveBeenCalledWith('layout-assignment-options')
    expect(result.saving.value).toBe(false)
  })
})

describe('Layout assignment editor integration', () => {
  it('tracks and saves the Site default independently with immediate-inheritance copy', async () => {
    const site = await source('app/pages/_desk/site/general.vue')

    expect(site).toContain('useSiteLayoutAssignmentSettings()')
    expect(site).toContain('const siteLayoutDirty = computed(() => siteLayoutId.value !== savedSiteLayoutId.value)')
    expect(site).toContain('await saveLayoutAssignment(siteLayoutId.value)')
    expect(site).toContain('if (!siteLayoutDirty.value || modeData.value?.value.enabled !== true) return')
    expect(site).toContain('<LayoutAssignmentSelect')
    expect(site).toContain(':mode-enabled="modeData?.value.enabled === true"')
    expect(site).toContain('Pages and Schema routes without their own assignment inherit this value immediately.')
    expect(site).toContain('Public inheritors now follow the current revision of this Layout.')
  })

  it('includes Schema assignment changes in the versioned AST dirty snapshot and publish flow', async () => {
    const [schema, settings, draftContext, presentation] = await Promise.all([
      source('app/pages/_desk/schemas/[schemaKey]/index.vue'),
      source('app/pages/_desk/schemas/[schemaKey]/settings.vue'),
      source('app/composables/useSchemaSettingsDraft.ts'),
      source('app/components/cms/SchemaPresentationEditor.vue')
    ])

    expect(schema).toContain('layoutId: undefined as string | undefined')
    expect(schema).toMatch(/presentation:\s*deepClone\(state\.presentation\)/)
    expect(schema).toContain('const currentAstJson = computed(() => stableStringify(buildAstFromState()))')
    expect(schema).toContain('for (const key of Object.keys(state.presentation)) delete')
    expect(schema).not.toContain('<CmsSchemaPresentationEditor')
    expect(settings).toContain('<CmsSchemaPresentationEditor')
    expect(settings).toContain(':published-presentation="published?.ast?.presentation ?? null"')
    expect(settings).toContain(':published-version="published?.version ?? null"')
    const saveDraft = schema.slice(schema.indexOf('async function saveDraft()'), schema.indexOf('const publishing'))
    expect(saveDraft).toContain('const ast = buildAstFromState()')
    expect(saveDraft).toMatch(/body:\s*\{[^}]*revision:\s*currentRevision\.value[^}]*title:\s*ast\.title[^}]*\bast\b[^}]*layoutId:\s*state\.presentation\.layoutId\s*\?\?\s*null[^}]*\}/s)
    expect(draftContext).toMatch(/body:\s*\{[^}]*revision:\s*revision\.value[^}]*title:\s*localAst\.title[^}]*ast:\s*localAst[^}]*layoutId:\s*localAst\.presentation\?\.layoutId\s*\?\?\s*null/s)

    expect(presentation).toContain('<LayoutAssignmentSelect')
    expect(presentation).toContain('v-model="layoutId"')
    expect(presentation).toContain('else delete next.layoutId')
    expect(presentation).toContain('Public routes keep their published assignment until then.')
    expect(presentation).toContain('follows the current revision of the selected Layout')
  })

  it('includes Page assignments in dirty snapshots, save/publish payloads, and Inspector plumbing', async () => {
    const [createPage, editPage, editor, panel, properties] = await Promise.all([
      source('app/pages/_desk/pages/new.vue'),
      source('app/pages/_desk/pages/[id].vue'),
      source('app/components/PageEditor.vue'),
      source('app/components/page-editor/PageEditorPanel.vue'),
      source('app/components/page-editor/PagePropertiesInspector.vue')
    ])

    for (const page of [createPage, editPage]) {
      expect(page).toContain('layoutId: null as string | null')
      expect(page).toMatch(/function buildSnapshot\(\)[\s\S]*layoutId: state\.layoutId/)
      expect(page).toContain('v-model:layout-id="state.layoutId"')
    }
    expect(createPage.match(/layoutId: state\.layoutId/g)?.length).toBeGreaterThanOrEqual(4)
    expect(editPage.match(/layoutId: state\.layoutId/g)?.length).toBeGreaterThanOrEqual(3)
    expect(editPage).toContain('state.layoutId = typeof next.layoutId === \'string\' ? next.layoutId : null')
    expect(editPage).toContain(':published-layout-id="doc?.publishedLayoutId ?? null"')
    expect(editPage).toContain(':has-published-revision="doc?.hasPublishedRevision === true"')

    expect(editor).toContain('const layoutId = defineModel<string | null>(\'layoutId\', { default: null })')
    expect(editor.match(/v-model:layout-id="layoutId"/g)).toHaveLength(2)
    expect(editor.match(/:published-layout-id="props\.publishedLayoutId"/g)).toHaveLength(2)
    expect(panel).toContain('const layoutId = defineModel<string | null>(\'layoutId\', { default: null })')
    expect(panel).toContain('v-model:layout-id="layoutId"')
    expect(properties).toContain('<LayoutAssignmentSelect')
    expect(properties).toContain('Working and published Layout assignments differ.')
    expect(properties).toContain('Public delivery keeps the published assignment until you publish again.')
    expect(properties).toContain('follow the current Layout revision')
  })
})
