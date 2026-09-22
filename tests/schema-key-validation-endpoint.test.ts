import { createError } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  getError: null as Error | null,
  lookupErrorAt: 0,
  lookupCount: 0
}))
const requireStaff = vi.hoisted(() => vi.fn(async () => ({ user: { id: 'admin-1' } })))

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          dbState.lookupCount += 1
          if (dbState.lookupErrorAt === dbState.lookupCount) throw new Error(`lookup ${dbState.lookupCount} failed`)
          return []
        }
      })
    })
  })
}

vi.mock('../server/db/db', () => ({
  getDb: vi.fn(async () => {
    if (dbState.getError) throw dbState.getError
    return fakeDb
  })
}))
vi.mock('../server/utils/auth', () => ({ requireStaff }))
vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: vi.fn(async () => ({
    ast: { schemaKey: 'p', title: 'Pages', fields: [] }
  }))
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)

let handler: (event: any) => Promise<any>

beforeAll(async () => {
  handler = (await import('../server/api/schema/[schemaKey]/validate.post')).default
})

beforeEach(() => {
  dbState.getError = null
  dbState.lookupErrorAt = 0
  dbState.lookupCount = 0
  requireStaff.mockClear()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('reserved schema validation endpoint', () => {
  it('converts only the expected reserved-key error into a field error', async () => {
    await expect(handler({ context: { params: { schemaKey: 'p' } } })).resolves.toMatchObject({
      ok: false,
      error: { fieldErrors: { schemaKey: ['Schema key is reserved for a public route'] } }
    })
    expect(requireStaff).toHaveBeenCalledOnce()
  })

  it('propagates staff authorization failures before reading schema input', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    requireStaff.mockRejectedValueOnce(unauthorized)
    await expect(handler({ context: { params: { schemaKey: 'p' } } })).rejects.toBe(unauthorized)
    expect(dbState.lookupCount).toBe(0)
  })

  it.each([1, 2])('rethrows lookup %s storage failures', async (lookupErrorAt) => {
    dbState.lookupErrorAt = lookupErrorAt
    await expect(handler({ context: { params: { schemaKey: 'p' } } }))
      .rejects.toThrow(`lookup ${lookupErrorAt} failed`)
  })

  it('rethrows getDb and unrelated H3 errors', async () => {
    const storageError = new Error('D1 unavailable')
    dbState.getError = storageError
    await expect(handler({ context: { params: { schemaKey: 'p' } } })).rejects.toBe(storageError)

    const unrelatedBadRequest = createError({ statusCode: 400, statusMessage: 'Other bad request' })
    dbState.getError = unrelatedBadRequest
    await expect(handler({ context: { params: { schemaKey: 'p' } } })).rejects.toBe(unrelatedBadRequest)
  })
})
