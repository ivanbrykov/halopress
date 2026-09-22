import { computed, ref, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

type AsyncDataStatus = 'idle' | 'pending' | 'success' | 'error'

function createNuxtLikeAsyncData<T>() {
  const state = {
    data: shallowRef<T>(),
    pending: ref(true),
    status: ref<AsyncDataStatus>('pending'),
    error: ref<unknown>(),
    refresh: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
    clear: vi.fn()
  }
  const promise = Object.assign(Promise.resolve(state), state)

  // Nuxt exposes these Promise methods as enumerable own properties. A spread
  // of the raw result therefore remains thenable and is unsafe for wrappers.
  Object.defineProperties(promise, {
    then: { enumerable: true, value: promise.then.bind(promise) },
    catch: { enumerable: true, value: promise.catch.bind(promise) },
    finally: { enumerable: true, value: promise.finally.bind(promise) }
  })

  return { state, promise }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Site reactive composables', () => {
  it('exposes a validated public Theme synchronously without leaking thenable methods', async () => {
    const { state, promise } = createNuxtLikeAsyncData<any>()
    const useFetch = vi.fn(() => promise)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useFetch', useFetch)
    const { useSiteTheme } = await import('../app/composables/useSiteTheme')
    const result = useSiteTheme()
    expect(result).not.toHaveProperty('then')
    expect(result.theme.value).toBeNull()
    expect(result.error.value).toBeNull()
    const digest = 'a'.repeat(64)
    state.data.value = {
      contractVersion: 1,
      siteModeEnabled: true,
      revision: digest,
      stylesheetRevision: digest,
      stylesheetUrl: `https://press.example.com/_halo/theme/v1/${digest}.css`,
      colorMode: 'system'
    }
    expect(result.theme.value).toEqual(state.data.value)
    state.data.value = { ...state.data.value, stylesheetUrl: `https://user@press.example.com/_halo/theme/v1/${digest}.css` }
    state.status.value = 'success'
    expect(result.theme.value).toBeNull()
    expect(result.error.value).toBeInstanceOf(Error)
    expect((result.error.value as Error).message).toContain('malformed contract')
    state.data.value = null
    expect(result.error.value).toBeInstanceOf(Error)
    expect(useFetch).toHaveBeenCalledWith('/api/delivery/site-theme', {
      key: 'site-theme-manifest',
      dedupe: 'defer'
    })
  })

  it('exposes Site mode refs synchronously without leaking Nuxt thenable methods', async () => {
    const { state, promise } = createNuxtLikeAsyncData<{
      value: { version: 1; enabled: boolean }
    }>()
    const useFetch = vi.fn(() => promise)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', useFetch)

    const { useSiteMode, useSiteModeSettings } = await import('../app/composables/useSiteModeSettings')
    const mode = useSiteMode()

    expect(Object.keys(promise)).toContain('then')
    expect(mode).not.toHaveProperty('then')
    expect(mode.data).toBe(state.data)
    expect(mode.pending.value).toBe(true)
    expect(mode.enabled.value).toBe(false)
    expect(useFetch).toHaveBeenLastCalledWith('/api/settings/site-mode', {
      key: 'site-mode',
      dedupe: 'defer'
    })

    state.data.value = { value: { version: 1, enabled: true } }
    expect(mode.enabled.value).toBe(true)

    const settings = useSiteModeSettings()
    expect(settings).not.toHaveProperty('then')
    expect(settings.saving.value).toBe(false)
  })

  it('keeps the overview status synchronous and the mutable presentation editor awaited', async () => {
    const { state, promise } = createNuxtLikeAsyncData<{ configured: boolean }>()
    const useFetch = vi.fn(() => promise)
    const updated = { configured: true }
    const updatePresentation = vi.fn(async () => updated)
    const refreshNuxtData = vi.fn(async () => {})
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', useFetch)
    vi.stubGlobal('$fetch', updatePresentation)
    vi.stubGlobal('refreshNuxtData', refreshNuxtData)

    const {
      useSitePresentationSettings,
      useSitePresentationStatus
    } = await import('../app/composables/useSitePresentationSettings')
    const status = useSitePresentationStatus()

    expect(status).not.toHaveProperty('then')
    expect(status.data).toBe(state.data)
    expect(status.pending.value).toBe(true)
    expect(useFetch).toHaveBeenLastCalledWith('/api/settings/site-presentation', {
      key: 'site-presentation-settings',
      dedupe: 'defer'
    })

    const editor = useSitePresentationSettings()
    expect(editor).toBeInstanceOf(Promise)
    const editorState = await editor
    expect(editorState).toMatchObject({
      data: state.data,
      pending: state.pending,
      saving: expect.objectContaining({ value: false })
    })

    await editorState.savePatch({})
    expect(state.data.value).toEqual(updated)
    expect(updatePresentation).toHaveBeenCalledWith('/api/settings/site-presentation', {
      method: 'PUT',
      body: {}
    })
    expect(refreshNuxtData).toHaveBeenCalledWith('site-presentation')
  })

  it('keeps Theme status synchronous while the mutable Theme editor awaits persisted state', async () => {
    const { state, promise } = createNuxtLikeAsyncData<any>()
    const useFetch = vi.fn(() => promise)
    const updated = { source: 'theme', configured: true, revision: 'theme-revision' }
    const saveTheme = vi.fn(async () => updated)
    const refreshNuxtData = vi.fn(async () => {})
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', useFetch)
    vi.stubGlobal('$fetch', saveTheme)
    vi.stubGlobal('refreshNuxtData', refreshNuxtData)

    const {
      useSiteThemeSettings,
      useSiteThemeStatus
    } = await import('../app/composables/useSiteThemeSettings')
    const status = useSiteThemeStatus()

    expect(Object.keys(promise)).toContain('then')
    expect(status).not.toHaveProperty('then')
    expect(status).not.toHaveProperty('catch')
    expect(status).not.toHaveProperty('finally')
    expect(status.data).toBe(state.data)
    expect(status.pending.value).toBe(true)
    expect(useFetch).toHaveBeenLastCalledWith('/api/settings/theme', {
      key: 'site-theme-settings',
      dedupe: 'defer'
    })

    const editor = useSiteThemeSettings()
    expect(editor).toBeInstanceOf(Promise)
    const editorState = await editor
    expect(editorState).toMatchObject({
      data: state.data,
      pending: state.pending,
      saving: expect.objectContaining({ value: false })
    })

    await editorState.saveTheme({} as any, 'expected-revision')
    expect(saveTheme).toHaveBeenCalledWith('/api/settings/theme', {
      method: 'PUT',
      body: { theme: {}, expectedRevision: 'expected-revision' }
    })
    expect(state.data.value).toEqual(updated)
    expect(refreshNuxtData).toHaveBeenCalledWith('site-theme-manifest')
  })

  it('keeps Site menu editor helpers on a non-thenable AsyncData return surface', async () => {
    const { state, promise } = createNuxtLikeAsyncData<{ items: never[] }>()
    const useFetch = vi.fn(() => promise)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', useFetch)

    const { useSiteMenus, useSiteMenusEditor } = await import('../app/composables/useSiteMenus')
    const editor = useSiteMenus()

    expect(editor).not.toBeInstanceOf(Promise)
    expect(editor).not.toHaveProperty('then')
    expect(editor).not.toHaveProperty('catch')
    expect(editor).not.toHaveProperty('finally')
    expect(await editor).toBe(editor)
    expect(editor).toMatchObject({
      data: state.data,
      pending: state.pending,
      status: state.status,
      error: state.error,
      refresh: state.refresh,
      execute: state.execute,
      clear: state.clear,
      saving: expect.objectContaining({ value: false }),
      creating: expect.objectContaining({ value: false }),
      deleting: expect.objectContaining({ value: false }),
      createMenu: expect.any(Function),
      saveMenu: expect.any(Function),
      deleteMenu: expect.any(Function)
    })

    const awaitedEditor = useSiteMenusEditor()
    expect(awaitedEditor).toBeInstanceOf(Promise)
    await expect(awaitedEditor).resolves.toMatchObject({
      data: state.data,
      pending: state.pending,
      previewMenu: expect.any(Function)
    })
  })

  it('invalidates shallow AsyncData consumers after every Site menu mutation', async () => {
    const initialMenu = {
      id: 'global-navigation',
      name: 'Global navigation',
      document: { version: 1 as const, items: [] },
      malformedStoredValue: false,
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      usage: [{ resourceType: 'public-site-shell' as const, resourceId: 'default', label: 'Public site shell' }],
      canDelete: false
    }
    const createdMenu = {
      ...initialMenu,
      id: 'footer-links',
      name: 'Footer links',
      usage: [],
      canDelete: true
    }
    const renamedMenu = {
      ...createdMenu,
      name: 'Company links',
      document: {
        version: 1 as const,
        items: [{
          id: 'about',
          value: 'about',
          label: 'About',
          destination: { type: 'url' as const, url: '/about' },
          children: []
        }]
      }
    }
    const conflictUsage = [{ resourceType: 'site-layout' as const, resourceId: 'layout-1', label: 'Marketing layout' }]
    const initialResponse = {
      defaultMenuId: 'global-navigation',
      items: [initialMenu]
    }
    const { state, promise } = createNuxtLikeAsyncData<typeof initialResponse>()
    state.data.value = initialResponse
    const fetch = vi.fn()
      .mockResolvedValueOnce(createdMenu)
      .mockResolvedValueOnce(renamedMenu)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ data: { usage: conflictUsage } })
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useFetch', vi.fn(() => promise))
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('refreshNuxtData', vi.fn(async () => {}))
    vi.stubGlobal('siteMenuUsageFromFetchError', (error: { data?: { usage?: unknown } }) => error.data?.usage ?? null)

    const { useSiteMenus } = await import('../app/composables/useSiteMenus')
    const editor = useSiteMenus()
    const summaries = computed(() => editor.data.value?.items.map(menu => (
      `${menu.name}:${menu.document.items.length}:${menu.canDelete}:${menu.usage.map(usage => usage.label).join(',')}`
    )))
    const responseSnapshots: unknown[] = []

    responseSnapshots.push(editor.data.value)
    expect(summaries.value).toEqual(['Global navigation:0:false:Public site shell'])

    await editor.createMenu('Footer links')
    responseSnapshots.push(editor.data.value)
    expect(summaries.value).toEqual([
      'Global navigation:0:false:Public site shell',
      'Footer links:0:true:'
    ])

    await editor.saveMenu('footer-links', {
      name: renamedMenu.name,
      document: renamedMenu.document
    })
    responseSnapshots.push(editor.data.value)
    expect(summaries.value).toEqual([
      'Global navigation:0:false:Public site shell',
      'Company links:1:true:'
    ])

    await editor.deleteMenu('footer-links')
    responseSnapshots.push(editor.data.value)
    expect(summaries.value).toEqual(['Global navigation:0:false:Public site shell'])

    state.data.value = {
      ...state.data.value,
      items: [...state.data.value.items, renamedMenu]
    }
    responseSnapshots.push(editor.data.value)
    expect(summaries.value.at(-1)).toBe('Company links:1:true:')

    await expect(editor.deleteMenu('footer-links')).rejects.toEqual({ data: { usage: conflictUsage } })
    responseSnapshots.push(editor.data.value)
    expect(summaries.value.at(-1)).toBe('Company links:1:false:Marketing layout')

    for (let index = 1; index < responseSnapshots.length; index += 1) {
      expect(responseSnapshots[index]).not.toBe(responseSnapshots[index - 1])
    }
  })
})
