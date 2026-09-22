import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { getPublishedPage, hasStandalonePageRouteClaim } from '../server/cms/page-delivery'
import { page, publicationRevision } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.mock('../server/utils/schema-permission', () => ({
  getSchemaPermission: vi.fn(),
  hasSchemaPermission: vi.fn()
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('published standalone page delivery', () => {
  it('always resolves the immutable published revision instead of a working draft', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const publishedAt = new Date('2026-07-13T00:00:00.000Z')
      await fixture.db.insert(page).values({
        id: 'page-1',
        title: 'Working title',
        status: 'draft',
        contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Working draft' }] }] }),
        publishedRevisionId: 'revision-1',
        firstPublishedAt: publishedAt,
        publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt
      })
      await fixture.db.insert(publicationRevision).values({
        id: 'revision-1',
        documentKind: 'page',
        documentId: 'page-1',
        title: 'Published title',
        contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }] }),
        createdAt: publishedAt
      })

      await expect(getPublishedPage(fixture.db, 'page-1')).resolves.toMatchObject({
        id: 'page-1',
        title: 'Published title',
        status: 'published',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }] }
      })
    } finally {
      fixture.close()
    }
  })

  it('serves the published API response with public cache headers even when cookies are present', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-13T00:00:00.000Z')
      await fixture.db.insert(page).values({
        id: 'page-api',
        title: 'Unreleased title',
        status: 'draft',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        publishedRevisionId: 'revision-api',
        firstPublishedAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now
      })
      await fixture.db.insert(publicationRevision).values({
        id: 'revision-api',
        documentKind: 'page',
        documentId: 'page-api',
        title: 'Published API title',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        createdAt: now
      })
      const headers = new Map<string, unknown>()
      const handler = (await import('../server/api/delivery/page/[id].get')).default as (event: any) => Promise<any>
      const event = {
        context: { params: { id: 'page-api' } },
        node: {
          req: {
            headers: {
              cookie: 'auth-token=ignored',
              host: 'press.example.com',
              'x-forwarded-proto': 'https'
            }
          },
          res: {
            setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
            getHeader: (name: string) => headers.get(name.toLowerCase())
          }
        }
      }
      await expect(handler(event)).resolves.toMatchObject({
        id: 'page-api',
        title: 'Published API title',
        status: 'published'
      })
      expect(headers.get('cache-control')).toMatch(/^public,/)
      expect(headers.get('vary')).toBe('Cookie, X-Forwarded-Proto')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it.each([
    { id: 'draft', status: 'draft', pointer: null },
    { id: 'unpublished', status: 'draft', pointer: null },
    { id: 'deleted', status: 'deleted', pointer: 'deleted-revision' }
  ])('returns the same 404 for $id pages', async ({ id, status, pointer }) => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date()
      await fixture.db.insert(page).values({
        id,
        title: id,
        status,
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        publishedRevisionId: pointer,
        createdAt: now,
        updatedAt: now
      })
      if (pointer) {
        await fixture.db.insert(publicationRevision).values({
          id: pointer,
          documentKind: 'page',
          documentId: id,
          contentJson: JSON.stringify({ type: 'doc', content: [] }),
          createdAt: now
        })
      }
      await expect(getPublishedPage(fixture.db, id)).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'Page not found'
      })
    } finally {
      fixture.close()
    }
  })

  it('stops delivery immediately when the current published pointer is cleared', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date()
      await fixture.db.insert(page).values({
        id: 'page-2',
        title: 'Page',
        status: 'published',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        publishedRevisionId: 'revision-2',
        createdAt: now,
        updatedAt: now
      })
      await fixture.db.insert(publicationRevision).values({
        id: 'revision-2',
        documentKind: 'page',
        documentId: 'page-2',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        createdAt: now
      })
      await fixture.db.update(page).set({ publishedRevisionId: null, status: 'draft' }).where(eq(page.id, 'page-2'))
      await expect(getPublishedPage(fixture.db, 'page-2')).rejects.toMatchObject({ statusCode: 404 })
    } finally {
      fixture.close()
    }
  })

  it.each([
    { id: 'reserved-draft', status: 'draft', pointer: null },
    { id: 'reserved-unpublished', status: 'draft', pointer: null },
    { id: 'reserved-deleted', status: 'deleted', pointer: 'reserved-deleted-revision' },
    { id: 'reserved-published', status: 'published', pointer: 'reserved-published-revision' }
  ])('keeps the public route claimed while standalone page $id exists', async ({ id, status, pointer }) => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const now = new Date()
      await fixture.db.insert(page).values({
        id,
        title: id,
        status,
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        publishedRevisionId: pointer,
        createdAt: now,
        updatedAt: now
      })
      if (pointer) {
        await fixture.db.insert(publicationRevision).values({
          id: pointer,
          documentKind: 'page',
          documentId: id,
          contentJson: JSON.stringify({ type: 'doc', content: [] }),
          createdAt: now
        })
      }
      await expect(hasStandalonePageRouteClaim(fixture.db, id)).resolves.toBe(true)
      await expect(hasStandalonePageRouteClaim(fixture.db, 'missing-page')).resolves.toBe(false)
    } finally {
      fixture.close()
    }
  })

  it('uses published content on the reserved page prefix and general schema routes', async () => {
    const root = resolve(import.meta.dirname, '..')
    expect(existsSync(resolve(root, 'app/pages/p/[id].vue'))).toBe(false)
    expect(existsSync(resolve(root, 'app/pages/p/index.vue'))).toBe(false)
    expect(existsSync(resolve(root, 'app/pages/_pages/[id].vue'))).toBe(false)
    expect(existsSync(resolve(root, 'app/pages/[schema]/[id].vue'))).toBe(true)
    expect(existsSync(resolve(root, 'app/pages/[schema]/index.vue'))).toBe(true)
    expect(existsSync(resolve(root, 'app/pages/_desk/index.vue'))).toBe(true)
    expect(existsSync(resolve(root, 'server/api/delivery/page/[id].get.ts'))).toBe(true)

    const publicDetailRoute = await readFile(resolve(root, 'app/pages/[schema]/[id].vue'), 'utf8')
    expect(publicDetailRoute).toMatch(/useHalopressContent\(schemaKey, \{[\s\S]*?status: 'published',[\s\S]*?respectStandalonePageClaim:/)
  })
})
