import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type EndpointHandler = (event: any) => Promise<any>

const permissionCalls = vi.hoisted(() => [] as string[])
const permissionState = vi.hoisted(() => ({ reject: true }))
const bodyState = vi.hoisted(() => ({ current: { revision: 1 } as Record<string, unknown> }))
const getDb = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/schema-permission', () => ({
  requireSchemaPermission: vi.fn(async (_event: unknown, _schemaKey: string, action: string) => {
    permissionCalls.push(action)
    if (permissionState.reject) {
      throw Object.assign(new Error('Permission denied'), { statusCode: 403, statusMessage: 'Permission denied' })
    }
    return {
      roleKey: 'publisher',
      canRead: true,
      canWrite: false,
      canPublish: true,
      canArchive: false,
      canDelete: false,
      canAdmin: false
    }
  })
}))
vi.mock('../server/db/db', () => ({ getDb }))
vi.mock('../server/utils/auth', () => ({ getAuthSession: vi.fn() }))
vi.mock('../server/utils/widget-cache', () => ({ queueWidgetCacheInvalidation: vi.fn() }))
vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: vi.fn(async () => bodyState.current)
}))
vi.stubGlobal('defineEventHandler', (handler: EndpointHandler) => handler)

let publish: EndpointHandler
let archive: EndpointHandler
let remove: EndpointHandler

beforeAll(async () => {
  [publish, archive, remove] = await Promise.all([
    import('../server/api/content/[schemaKey]/[id]/publish.post').then(module => module.default as EndpointHandler),
    import('../server/api/content/[schemaKey]/[id]/unpublish.post').then(module => module.default as EndpointHandler),
    import('../server/api/content/[schemaKey]/[id].delete').then(module => module.default as EndpointHandler)
  ])
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  permissionState.reject = true
  bodyState.current = { revision: 1 }
})

describe('editorial permission endpoints', () => {
  it.each([
    ['publish', () => publish],
    ['archive', () => archive],
    ['delete', () => remove]
  ])('rejects direct %s commands before touching the database', async (action, handler) => {
    permissionCalls.length = 0
    getDb.mockClear()
    await expect(handler()({ context: { params: { schemaKey: 'article', id: 'article-1' } } }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(permissionCalls).toEqual([action])
    expect(getDb).not.toHaveBeenCalled()
  })

  it('does not let a publish-only role edit content through the publish payload', async () => {
    permissionCalls.length = 0
    permissionState.reject = false
    bodyState.current = { revision: 1, content: { title: 'Unauthorized edit' } }
    getDb.mockClear()

    await expect(publish({ context: { params: { schemaKey: 'article', id: 'article-1' } } }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(permissionCalls).toEqual(['publish'])
    expect(getDb).not.toHaveBeenCalled()
  })
})
