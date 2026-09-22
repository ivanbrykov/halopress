import { describe, expect, it, vi } from 'vitest'

import { createKeywordSearchClient } from '../shared/keyword-search-client'

const capabilities = {
  contractVersion: 1 as const,
  mode: 'server' as const,
  endpoint: '/api/keyword-search',
  browserFallback: true,
  tokenizerGeneration: 'generation-1',
  queryEpoch: 1,
  indexAvailable: true,
  analyzer: {
    status: 'available' as const,
    retryable: true
  },
  available: true,
  enabledFields: 1
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status })
}

function result(id: string, nextCursor: string | null = null) {
  return {
    contractVersion: 1,
    tokenizerGeneration: 'generation-1',
    queryEpoch: 1,
    items: [{
      id,
      schemaKey: 'article',
      schemaVersion: 1,
      title: id,
      description: null,
      image: null,
      to: `/article/${id}`,
      score: 1
    }],
    nextCursor,
    availability: 'available',
    indexing: { pending: 0, failed: 0 }
  }
}

describe('headless keyword search client', () => {
  it('uses server analysis without loading the browser tokenizer', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return json(capabilities)
      bodies.push(JSON.parse(String(init.body)))
      return json(result('server'))
    }) as typeof globalThis.fetch
    const loadBrowserTokenizer = vi.fn()
    const client = createKeywordSearchClient({ fetch, loadBrowserTokenizer })

    await client.search({ query: '학교 cloudflare', schemaKeys: ['article'] })

    expect(loadBrowserTokenizer).not.toHaveBeenCalled()
    expect(bodies).toEqual([expect.objectContaining({
      mode: 'raw',
      query: '학교 cloudflare',
      schemaKeys: ['article']
    })])
    expect(client.state).toMatchObject({
      status: 'ready',
      mode: 'server',
      fallback: false,
      items: [{ id: 'server' }]
    })
  })

  it('lazy-loads browser analysis only for an explicit browser-mode search', async () => {
    const browserCapabilities = { ...capabilities, mode: 'browser' as const, endpoint: '/api/keyword-search' }
    const requests: Record<string, unknown>[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return json(browserCapabilities)
      requests.push(JSON.parse(String(init.body)))
      return json(result('browser'))
    }) as typeof globalThis.fetch
    const loadBrowserTokenizer = vi.fn(async () => ({
      analyzeQuery: () => ({
        tokenizerGeneration: 'generation-1',
        rawTerms: ['cloudflare'],
        morphTerms: ['학교']
      })
    }))
    const client = createKeywordSearchClient({ fetch, loadBrowserTokenizer })

    await client.loadCapabilities()
    expect(loadBrowserTokenizer).not.toHaveBeenCalled()
    await client.search({ query: '학교 Cloudflare' })

    expect(loadBrowserTokenizer).toHaveBeenCalledOnce()
    expect(requests).toEqual([expect.objectContaining({
      mode: 'tokens',
      tokenizerGeneration: 'generation-1',
      rawTerms: ['cloudflare'],
      morphTerms: ['학교']
    })])
  })

  it('falls back to browser tokenization when server analysis is unavailable', async () => {
    const modes: string[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return json(capabilities)
      const body = JSON.parse(String(init.body))
      modes.push(body.mode)
      if (body.mode === 'raw') {
        return json({
          error: {
            code: 'analyzer_unavailable',
            message: 'Analyzer unavailable',
            retryable: true
          }
        }, 503)
      }
      return json(result('fallback'))
    }) as typeof globalThis.fetch
    const client = createKeywordSearchClient({
      fetch,
      loadBrowserTokenizer: async () => ({
        analyzeQuery: () => ({
          tokenizerGeneration: 'generation-1',
          rawTerms: ['학교'],
          morphTerms: ['학교']
        })
      })
    })

    await client.search({ query: '학교' })

    expect(modes).toEqual(['raw', 'tokens'])
    expect(client.state).toMatchObject({
      status: 'ready',
      fallback: true,
      items: [{ id: 'fallback' }]
    })
  })

  it('refetches a retryable transient server capability on retry', async () => {
    const transient = {
      ...capabilities,
      analyzer: {
        status: 'initializing' as const,
        retryable: true
      },
      available: false
    }
    const capabilityResponses = [transient, capabilities]
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return json(capabilityResponses.shift()!)
      return json(result('recovered'))
    }) as typeof globalThis.fetch
    const client = createKeywordSearchClient({
      fetch,
      loadBrowserTokenizer: vi.fn()
    })

    await client.search({ query: '학교' })
    expect(client.state).toMatchObject({
      status: 'unavailable',
      items: []
    })

    await client.retry()

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(client.state).toMatchObject({
      status: 'ready',
      mode: 'server',
      items: [{ id: 'recovered' }]
    })
  })

  it('ignores an obsolete response even when the transport does not honor abort', async () => {
    const resolvers = new Map<string, (response: Response) => void>()
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Promise.resolve(json(capabilities))
      const body = JSON.parse(String(init.body))
      return new Promise<Response>((resolve) => {
        resolvers.set(body.query, resolve)
      })
    }) as typeof globalThis.fetch
    const client = createKeywordSearchClient({ fetch, loadBrowserTokenizer: vi.fn() })

    const earlier = client.search({ query: 'earlier' })
    await vi.waitFor(() => expect(resolvers.has('earlier')).toBe(true))
    const latest = client.search({ query: 'latest' })
    await vi.waitFor(() => expect(resolvers.has('latest')).toBe(true))
    resolvers.get('latest')!(json(result('latest')))
    await latest
    resolvers.get('earlier')!(json(result('earlier')))
    await earlier

    expect(client.state.query).toBe('latest')
    expect(client.state.items.map(item => item.id)).toEqual(['latest'])
  })

  it('restarts pagination once when the cursor becomes stale', async () => {
    const responses = [
      json(capabilities),
      json(result('first', 'cursor-1')),
      json({
        error: { code: 'stale_cursor', message: 'Stale cursor', retryable: true }
      }, 409),
      json(result('refreshed'))
    ]
    const fetch = vi.fn(async () => responses.shift()!) as typeof globalThis.fetch
    const client = createKeywordSearchClient({ fetch, loadBrowserTokenizer: vi.fn() })

    await client.search({ query: '학교' })
    await client.loadMore()

    expect(client.state).toMatchObject({
      status: 'ready',
      nextCursor: null,
      items: [{ id: 'refreshed' }]
    })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
