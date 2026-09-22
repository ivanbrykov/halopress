import { describe, expect, it, vi } from 'vitest'

import {
  applyWidgetCacheHeaders,
  buildWidgetCacheKey,
  queueWidgetCacheInvalidation,
  resolveWidgetCacheKey,
  withWidgetCache
} from '../server/utils/widget-cache'

function widgetEvent(host = 'acme-news.example.com') {
  return {
    context: {},
    node: {
      req: {
        headers: { host }
      }
    }
  }
}

describe('widget cache background work', () => {
  it('calls the Cloudflare waitUntil method with its owning context', async () => {
    let backgroundTask: Promise<unknown> | undefined
    const workerContext = {
      waitUntil: vi.fn(function (this: unknown, task: Promise<unknown>) {
        expect(this).toBe(workerContext)
        backgroundTask = task
      })
    }
    const event = {
      context: {
        cloudflare: {
          context: workerContext,
          env: {}
        }
      },
      node: {
        req: {
          headers: { host: 'acme-news.example.com' }
        }
      }
    }

    expect(() => queueWidgetCacheInvalidation(event as any, 'schema:article')).not.toThrow()
    expect(workerContext.waitUntil).toHaveBeenCalledOnce()
    await expect(backgroundTask).resolves.toBeDefined()
  })

  it('re-reads configured distributed scope revisions across isolate-style requests', async () => {
    let distributedRevision = 'scope-v1'
    const kv = {
      get: vi.fn(async () => distributedRevision),
      put: vi.fn(async (_key: string, value: string) => {
        distributedRevision = value
      })
    }
    const event = {
      context: { cloudflare: { env: { WIDGET_CACHE: kv } } },
      node: { req: { headers: { host: 'acme-news.example.com' } } }
    }

    const first = await resolveWidgetCacheKey(event as any, 'site-menu-source', 'v1', {
      sourceId: 'recent'
    }, 'schema:article')
    distributedRevision = 'scope-v2-from-another-isolate'
    const second = await resolveWidgetCacheKey(event as any, 'site-menu-source', 'v1', {
      sourceId: 'recent'
    }, 'schema:article')

    expect(second).not.toBe(first)
    expect(kv.get).toHaveBeenCalledTimes(2)
  })
})

describe('widget cache visibility isolation', () => {
  it('varies public widget responses by authentication cookie', () => {
    const setHeader = vi.fn()
    const event = {
      node: {
        res: { setHeader }
      }
    }

    applyWidgetCacheHeaders(event as any, { softTtl: 60, hardTtl: 300 })

    expect(setHeader).toHaveBeenCalledWith('Vary', 'Cookie')
  })

  it('shares a key for normalized public requests and isolates authenticated visibility', () => {
    const event = widgetEvent()
    const publicFromAll = buildWidgetCacheKey(event as any, 'recent', 'v1', {
      schemaKey: 'article',
      status: 'published',
      visibility: 'public:published'
    })
    const publicFromDraft = buildWidgetCacheKey(event as any, 'recent', 'v1', {
      schemaKey: 'article',
      status: 'published',
      visibility: 'public:published'
    })
    const authenticatedDraft = buildWidgetCacheKey(event as any, 'recent', 'v1', {
      schemaKey: 'article',
      status: 'draft',
      visibility: 'authenticated:user'
    })

    expect(publicFromAll).toBe(publicFromDraft)
    expect(authenticatedDraft).not.toBe(publicFromAll)
  })

  it('does not reuse cached public data for an authenticated visibility key', async () => {
    const event = widgetEvent()
    const nonce = `${Date.now()}-${Math.random()}`
    const policy = { softTtl: 60, hardTtl: 300 }
    const publicLoader = vi.fn(async () => [{ id: 'published', status: 'published' }])
    const authenticatedLoader = vi.fn(async () => [{ id: 'draft', status: 'draft' }])
    const publicKey = buildWidgetCacheKey(event as any, 'recent', 'v1', {
      nonce,
      schemaKey: 'article',
      status: 'published',
      visibility: 'public:published'
    })
    const authenticatedKey = buildWidgetCacheKey(event as any, 'recent', 'v1', {
      nonce,
      schemaKey: 'article',
      status: null,
      visibility: 'authenticated:user'
    })

    const publicResult = await withWidgetCache(event as any, publicKey, policy, publicLoader)
    const authenticatedResult = await withWidgetCache(event as any, authenticatedKey, policy, authenticatedLoader)
    const repeatedPublicResult = await withWidgetCache(event as any, publicKey, policy, publicLoader)

    expect(publicResult).toMatchObject({ status: 'miss', data: [{ id: 'published', status: 'published' }] })
    expect(authenticatedResult).toMatchObject({ status: 'miss', data: [{ id: 'draft', status: 'draft' }] })
    expect(repeatedPublicResult).toMatchObject({ status: 'hit', data: [{ id: 'published', status: 'published' }] })
    expect(publicLoader).toHaveBeenCalledOnce()
    expect(authenticatedLoader).toHaveBeenCalledOnce()
  })
})
