import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type EndpointHandler = (event: any) => Promise<any>

const bodyState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>
}))
const draftState = vi.hoisted(() => ({
  current: {
    schemaKey: 'article',
    title: 'Article',
    ast: { schemaKey: 'article', title: 'Article', fields: [] },
    revision: 2,
    updatedAt: new Date('2026-07-14T05:30:00.000Z'),
    updatedBy: 'admin-2'
  }
}))
const getDb = vi.hoisted(() => vi.fn(async () => ({})))
const getDraft = vi.hoisted(() => vi.fn(async () => draftState.current))
const compileSchemaAst = vi.hoisted(() => vi.fn())

vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: vi.fn(async () => bodyState.current)
}))
vi.mock('../server/db/db', () => ({ getDb }))
vi.mock('../server/cms/repo', () => ({
  getActiveSchema: vi.fn(),
  getDraft
}))
vi.mock('../server/cms/compiler', () => ({ compileSchemaAst }))
vi.mock('../server/utils/auth', () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } }))
}))
vi.stubGlobal('defineEventHandler', (handler: EndpointHandler) => handler)

let publish: EndpointHandler

beforeAll(async () => {
  publish = (await import('../server/api/schema/[schemaKey]/publish.post')).default as EndpointHandler
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  bodyState.current = {
    ast: { schemaKey: 'article', title: 'Stale article', fields: [] }
  }
  getDb.mockClear()
  getDraft.mockClear()
  compileSchemaAst.mockClear()
})

describe('schema publish revision checks', () => {
  it('requires a revision when the request supplies an AST', async () => {
    await expect(publish({ context: { params: { schemaKey: 'article' } } }))
      .rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'A valid revision is required'
      })

    expect(getDraft).toHaveBeenCalledWith({}, 'article')
    expect(compileSchemaAst).not.toHaveBeenCalled()
  })

  it('rejects a supplied AST when its revision is stale', async () => {
    bodyState.current.revision = 1

    await expect(publish({ context: { params: { schemaKey: 'article' } } }))
      .rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Document has changed since it was loaded',
        data: {
          currentRevision: 2,
          updatedAt: draftState.current.updatedAt,
          updatedBy: 'admin-2'
        }
      })

    expect(getDraft).toHaveBeenCalledWith({}, 'article')
    expect(compileSchemaAst).not.toHaveBeenCalled()
  })
})
