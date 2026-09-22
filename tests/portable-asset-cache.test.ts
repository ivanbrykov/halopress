import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authorized: true,
  isPublic: true,
  dbReads: 0,
  objectReads: 0,
  row: { objectKey: 'objects/asset', mimeType: 'image/png' } as null | { objectKey: string, mimeType: string },
  object: {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'image/png',
    identity: 'object-revision-1'
  } as null | { bytes: Uint8Array, contentType?: string, identity: string }
}))

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => {
            state.dbReads += 1
            return state.row
          }
        })
      })
    })
  }))
}))
vi.mock('../server/storage/assets', () => ({
  getObject: vi.fn(async () => {
    state.objectReads += 1
    return state.object
  })
}))
vi.mock('../server/utils/asset-delivery', () => ({
  requireAssetDelivery: vi.fn(async (event: any) => {
    if (!state.authorized) throw Object.assign(new Error('Asset not found'), { statusCode: 404 })
    if (!state.isPublic) event.node.res.setHeader('Cache-Control', 'private, no-store')
    return { isPublic: state.isPublic }
  })
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)

function requestEvent(assetId: string | string[] = 'asset-1', headers: Record<string, string> = {}) {
  const responseHeaders = new Map<string, unknown>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      responseHeaders.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    }
  }
  return {
    event: {
      context: { params: { assetId } },
      node: { req: { headers }, res: response }
    },
    header: (name: string) => responseHeaders.get(name.toLowerCase()),
    status: () => response.statusCode
  }
}

beforeEach(() => {
  state.authorized = true
  state.isPublic = true
  state.dbReads = 0
  state.objectReads = 0
  state.row = { objectKey: 'objects/asset', mimeType: 'image/png' }
  state.object = {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'image/png',
    identity: 'object-revision-1'
  }
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('portable public asset validators', () => {
  it('serves mutable public IDs with CORS, must-revalidate, a strong ETag, and weak conditional matching', async () => {
    const handler = (await import('../server/routes/assets/[assetId]/raw.get')).default as (event: any) => Promise<unknown>
    const initial = requestEvent()

    await expect(handler(initial.event)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    const etag = String(initial.header('etag'))
    expect(etag).toMatch(/^"sha256-/)
    expect(initial.header('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(initial.header('access-control-allow-origin')).toBe('*')
    expect(initial.header('cross-origin-resource-policy')).toBe('cross-origin')
    expect(initial.header('x-content-type-options')).toBe('nosniff')

    for (const validator of [etag, `W/${etag}`, `"other", W/${etag}`, '*']) {
      const conditional = requestEvent('asset-1', { 'if-none-match': validator })
      await expect(handler(conditional.event)).resolves.toBeUndefined()
      expect(conditional.status()).toBe(304)
      expect(conditional.header('etag')).toBe(etag)
    }
  })

  it('changes identity after same-ID object replacement or MIME changes', async () => {
    const handler = (await import('../server/routes/assets/[assetId]/raw.get')).default as (event: any) => Promise<unknown>
    const first = requestEvent()
    await handler(first.event)
    const firstEtag = String(first.header('etag'))

    state.object = {
      bytes: new Uint8Array([9, 8, 7]),
      contentType: 'image/png',
      identity: 'object-revision-2'
    }
    const replaced = requestEvent('asset-1', { 'if-none-match': firstEtag })
    await expect(handler(replaced.event)).resolves.toEqual(new Uint8Array([9, 8, 7]))
    expect(replaced.status()).toBe(200)
    expect(replaced.header('etag')).not.toBe(firstEtag)

    const replacedEtag = String(replaced.header('etag'))
    state.row = { objectKey: 'objects/asset', mimeType: 'image/webp' }
    const mimeChanged = requestEvent('asset-1', { 'if-none-match': replacedEtag })
    await expect(handler(mimeChanged.event)).resolves.toEqual(new Uint8Array([9, 8, 7]))
    expect(mimeChanged.header('etag')).not.toBe(replacedEtag)
    expect(mimeChanged.header('content-type')).toBe('image/webp')
  })

  it('uses the same representation validator for raw and filename aliases', async () => {
    const rawHandler = (await import('../server/routes/assets/[assetId]/raw.get')).default as (event: any) => Promise<unknown>
    const aliasHandler = (await import('../server/routes/assets/[...assetId].get')).default as (event: any) => Promise<unknown>
    const raw = requestEvent()
    const alias = requestEvent('asset-1/logo.png')

    await rawHandler(raw.event)
    await aliasHandler(alias.event)
    expect(alias.header('etag')).toBe(raw.header('etag'))
    expect(alias.header('content-disposition')).toBe('inline; filename="logo.png"')
  })

  it('authorizes before conditional evaluation and keeps private delivery no-store without validators', async () => {
    const handler = (await import('../server/routes/assets/[assetId]/raw.get')).default as (event: any) => Promise<unknown>
    state.authorized = false
    const denied = requestEvent('asset-1', { 'if-none-match': '*' })
    await expect(handler(denied.event)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.dbReads).toBe(0)
    expect(state.objectReads).toBe(0)
    expect(denied.header('etag')).toBeUndefined()

    state.authorized = true
    state.isPublic = false
    const privateRequest = requestEvent('asset-1', { 'if-none-match': '*' })
    await expect(handler(privateRequest.event)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(privateRequest.status()).toBe(200)
    expect(privateRequest.header('cache-control')).toBe('private, no-store')
    expect(privateRequest.header('etag')).toBeUndefined()
    expect(privateRequest.header('access-control-allow-origin')).toBeUndefined()
  })
})
