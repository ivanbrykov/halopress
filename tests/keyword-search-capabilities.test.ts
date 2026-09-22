import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type EndpointHandler = (event: any) => Promise<any>

const state = vi.hoisted(() => ({
  roleKey: 'anonymous',
  mode: 'server',
  browserFallback: false,
  analyzer: {
    status: 'available' as 'initializing' | 'available' | 'unavailable',
    retryable: true
  }
}))

vi.mock('../server/db/db', () => ({
  getRawDb: vi.fn(async () => ({
    prepare(query: string) {
      return {
        bind() {
          return {
            async first() {
              if (query.includes('full_text_control')) {
                return {
                  tokenizer_generation: 'fixture-generation',
                  query_epoch: 1,
                  status: 'available'
                }
              }
              return { count: 1 }
            }
          }
        }
      }
    }
  }))
}))

vi.mock('../server/utils/schema-permission', () => ({
  getSchemaRoleKey: vi.fn(async () => state.roleKey)
}))

vi.mock('../server/utils/search-analyzer', () => ({
  getServerSearchAnalyzerAvailability: vi.fn(async () => state.analyzer)
}))

vi.stubGlobal('defineEventHandler', (handler: EndpointHandler) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({
  public: {
    keywordSearchMode: state.mode,
    keywordSearchBrowserFallback: state.browserFallback
  }
}))

let handler: EndpointHandler

function responseEvent() {
  const headers = new Map<string, unknown>()
  return {
    event: {
      context: {},
      node: {
        res: {
          setHeader(name: string, value: unknown) {
            headers.set(name.toLowerCase(), value)
          }
        }
      }
    },
    header: (name: string) => headers.get(name.toLowerCase())
  }
}

beforeAll(async () => {
  handler = (await import(
    '../server/api/keyword-search/capabilities.get'
  )).default as EndpointHandler
})

beforeEach(() => {
  state.roleKey = 'anonymous'
  state.mode = 'server'
  state.browserFallback = false
  state.analyzer = { status: 'available', retryable: true }
})

describe('keyword-search capability caching', () => {
  it.each(['initializing', 'unavailable'] as const)(
    'does not cache a transient %s server analyzer state',
    async (status) => {
      state.analyzer = { status, retryable: true }
      const request = responseEvent()

      const result = await handler(request.event)

      expect(result.analyzer.status).toBe(status)
      expect(result.available).toBe(false)
      expect(request.header('cache-control')).toBe('no-store')
    }
  )

  it('keeps anonymous caching for an available server analyzer', async () => {
    const request = responseEvent()

    await expect(handler(request.event)).resolves.toMatchObject({
      available: true,
      analyzer: { status: 'available' }
    })
    expect(request.header('cache-control')).toBe(
      'public, max-age=30, stale-while-revalidate=60'
    )
  })
})
