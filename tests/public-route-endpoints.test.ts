import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { publishCanonicalRoute } from '../server/cms/public-routes'
import { page, publicationRevision } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

type Handler = (event: any) => Promise<any> | any

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('#auth', () => ({ getToken: vi.fn() }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://custom.example.com' }))

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>
let routeHandler: Handler
let sitemapHandler: Handler
let robotsHandler: Handler

function eventFor(url: string, host = 'custom.example.com') {
  const headers = new Map<string, unknown>()
  return {
    event: {
      path: url,
      context: {},
      node: {
        req: {
          url,
          headers: { host, 'x-forwarded-proto': 'https' }
        },
        res: {
          setHeader(name: string, value: unknown) {
            headers.set(name.toLowerCase(), value)
          },
          getHeader(name: string) {
            return headers.get(name.toLowerCase())
          }
        }
      }
    },
    header: (name: string) => headers.get(name.toLowerCase())
  }
}

beforeAll(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  routeHandler = (await import('../server/api/delivery/route.get')).default as Handler
  sitemapHandler = (await import('../server/routes/sitemap.xml.get')).default as Handler
  robotsHandler = (await import('../server/routes/robots.txt.get')).default as Handler

  const publishedAt = new Date('2026-07-14T00:00:00.000Z')
  await fixture.db.insert(page).values([
    {
      id: 'page-live',
      title: 'Working draft title',
      status: 'draft',
      contentJson: '{}',
      publishedRevisionId: 'revision-live',
      publishedAt,
      createdAt: publishedAt,
      updatedAt: new Date('2026-07-14T01:00:00.000Z')
    },
    {
      id: 'page-private',
      title: 'Private draft',
      status: 'draft',
      contentJson: '{}',
      publishedRevisionId: null,
      createdAt: publishedAt,
      updatedAt: publishedAt
    }
  ])
  await fixture.db.insert(publicationRevision).values({
    id: 'revision-live',
    documentKind: 'page',
    documentId: 'page-live',
    title: 'Published title',
    contentJson: '{}',
    createdAt: publishedAt
  })
  await publishCanonicalRoute({
    db: fixture.db as any,
    documentKind: 'page',
    documentId: 'page-live',
    path: '/about',
    legacyPath: '/p/page-live',
    seo: { description: 'Published description', structuredDataType: 'Article' },
    now: publishedAt
  })
  await publishCanonicalRoute({
    db: fixture.db as any,
    documentKind: 'page',
    documentId: 'page-private',
    path: '/private-draft',
    legacyPath: '/p/page-private',
    seo: null,
    now: publishedAt
  })
})

afterAll(() => {
  fixture.close()
  dbState.current = null
  vi.unstubAllGlobals()
})

describe('public route endpoints', () => {
  it('uses the live request host for canonical, Open Graph, and structured-data URLs', async () => {
    const { event, header } = eventFor('/api/delivery/route?path=%2Fabout', 'custom.example.com')
    const response = await routeHandler(event)

    expect(response).toMatchObject({
      routeKind: 'canonical',
      canonicalPath: '/about',
      seo: {
        title: 'Published title',
        description: 'Published description',
        canonicalUrl: 'https://custom.example.com/about',
        ogType: 'article',
        structuredData: {
          '@type': 'Article',
          name: 'Published title',
          url: 'https://custom.example.com/about'
        }
      }
    })
    expect(response.seo.title).not.toContain('Working draft')
    expect(header('cache-control')).toMatch(/^public,/)
  })

  it('resolves legacy aliases to the current canonical identity and protects private routes', async () => {
    const alias = eventFor('/api/delivery/route?path=%2Fp%2Fpage-live')
    await expect(routeHandler(alias.event)).resolves.toMatchObject({
      routeKind: 'alias',
      canonicalPath: '/about',
      documentId: 'page-live'
    })

    const privateRoute = eventFor('/api/delivery/route?path=%2Fprivate-draft')
    await expect(routeHandler(privateRoute.event)).rejects.toMatchObject({ statusCode: 404 })
    expect(privateRoute.event.context.publicDeliveryPrivateNoindex).toBe(true)
    expect(privateRoute.header('cache-control')).toBe('private, no-store')
    expect(privateRoute.header('x-robots-tag')).toBe('noindex, nofollow, noarchive')
  })

  it('emits only canonical anonymously readable URLs in sitemap and uses the live robots origin', async () => {
    const sitemapEvent = eventFor('/sitemap.xml', 'custom.example.com')
    const sitemap = await sitemapHandler(sitemapEvent.event)
    expect(sitemap).toContain('<loc>https://custom.example.com/about</loc>')
    expect(sitemap).not.toContain('/p/page-live')
    expect(sitemap).not.toContain('private-draft')
    expect(sitemapEvent.header('content-type')).toBe('application/xml; charset=utf-8')

    const robotsEvent = eventFor('/robots.txt', 'custom.example.com')
    const robots = robotsHandler(robotsEvent.event)
    expect(robots).toContain('Disallow: /_desk')
    expect(robots).toContain('Disallow: /api')
    expect(robots).toContain('Sitemap: https://custom.example.com/sitemap.xml')
  })
})
