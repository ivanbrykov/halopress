import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import type { LayoutRenderContext } from '../shared/layout-rendering'
import {
  SITE_MENU_MAX_DYNAMIC_SOURCES,
  SITE_MENU_MAX_EXACT_SET_VALUES,
  SITE_MENU_MAX_SOURCE_FILTERS,
  SITE_MENU_MAX_SOURCE_RESULTS,
  siteMenuDocumentSchema,
  siteMenuNameKey,
  type SiteMenuDocument,
  type SiteMenuSource
} from '../shared/site-menu'
import type { SchemaRegistry } from '../server/cms/types'
import {
  content,
  contentListing,
  contentSearchData,
  page,
  publicationRevision,
  publicRoute,
  schema,
  schemaActive,
  schemaRole,
  searchConfig,
  siteMenuSet,
  userRole
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { bumpWidgetCacheScope } from '../server/utils/widget-cache'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => vi.restoreAllMocks())

const articleRegistry: SchemaRegistry = {
  schemaKey: 'article',
  version: 1,
  title: 'Articles',
  fields: [{
    fieldId: 'tags-field',
    key: 'tags',
    kind: 'string',
    title: 'Tag',
    search: { mode: 'exact_set', filterable: true, sortable: true }
  }, {
    fieldId: 'category-field',
    key: 'category',
    kind: 'enum',
    title: 'Category',
    enumValues: [{ label: 'News', value: 'news' }, { label: 'Guide', value: 'guide' }],
    search: { mode: 'exact', filterable: true, sortable: true }
  }, {
    fieldId: 'body-field',
    key: 'body',
    kind: 'richtext',
    title: 'Body',
    search: { mode: 'off' }
  }],
  relations: []
}

function schemaSource(overrides: Partial<Extract<SiteMenuSource, { type: 'schemaQuery' }>> = {}) {
  return {
    version: 1,
    type: 'schemaQuery',
    schemaKey: 'article',
    filters: [],
    sort: { type: 'system', field: 'createdAt', direction: 'desc' },
    label: { type: 'systemTitle' },
    limit: 10,
    ...overrides
  } as const
}

function pageSource(overrides: Partial<Extract<SiteMenuSource, { type: 'pagePrefix' }>> = {}) {
  return {
    version: 1,
    type: 'pagePrefix',
    scope: { type: 'fixed', prefix: '/foo/' },
    sort: 'path',
    limit: 12,
    ...overrides
  } as const
}

function dynamicDocument(source: SiteMenuSource, id = 'source-main'): SiteMenuDocument {
  return siteMenuDocumentSchema.parse({
    version: 1,
    items: [{ kind: 'dynamic', id, source }]
  })
}

let eventSequence = 0
function publicEvent() {
  eventSequence += 1
  return {
    context: {},
    node: { req: { headers: { host: `menu-source-${eventSequence}.example.test` } } }
  } as any
}

function context(overrides: Partial<LayoutRenderContext> = {}): LayoutRenderContext {
  return {
    visibility: 'public',
    documentKind: 'page',
    documentId: 'page-foo-bar',
    schemaKey: null,
    schemaVersion: null,
    canonicalPath: '/foo/bar',
    ...overrides
  }
}

function createQueryAudit() {
  const state = {
    enabled: false,
    statements: 0,
    active: 0,
    maxActive: 0,
    maxParams: 0
  }
  return {
    state,
    onQueryStart: async ({ params }: { params: any[] }) => {
      if (!state.enabled) return
      state.statements++
      state.active++
      state.maxActive = Math.max(state.maxActive, state.active)
      state.maxParams = Math.max(state.maxParams, params.length)
      // Yield while the query is counted as active so Promise.all fan-out is
      // observable even though node:sqlite executes each statement synchronously.
      await new Promise(resolve => setTimeout(resolve, 2))
    },
    onQueryEnd: () => {
      if (state.enabled) state.active--
    }
  }
}

function simpleRegistry(schemaKey: string, version: number, withField = false): SchemaRegistry {
  return {
    schemaKey,
    version,
    title: `Schema ${schemaKey}`,
    fields: withField
      ? [{
          fieldId: `${schemaKey}-title-field`,
          key: 'menu_label',
          kind: 'string',
          title: 'Menu label',
          search: { mode: 'exact', filterable: true, sortable: true }
        }]
      : [],
    relations: []
  }
}

async function seedSimpleSchema(db: any, args: {
  schemaKey: string
  version?: number
  withField?: boolean
  active?: boolean
}) {
  const version = args.version ?? 1
  const registry = simpleRegistry(args.schemaKey, version, args.withField)
  const now = new Date('2026-07-19T00:00:00.000Z')
  await db.insert(schema).values({
    schemaKey: args.schemaKey,
    version,
    title: registry.title,
    astJson: JSON.stringify({ schemaKey: args.schemaKey, title: registry.title, fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object' }),
    registryJson: JSON.stringify(registry),
    createdAt: now
  })
  if (args.active !== false) {
    await db.insert(schemaActive).values({
      schemaKey: args.schemaKey,
      activeVersion: version,
      status: 'active',
      updatedAt: now
    })
    await db.insert(schemaRole).values({
      schemaKey: args.schemaKey,
      roleKey: 'anonymous',
      canRead: true
    })
  }
  if (args.withField) {
    const field = registry.fields[0]!
    await db.insert(searchConfig).values({
      schemaKey: args.schemaKey,
      fieldId: field.fieldId,
      fieldKey: field.key,
      kind: field.kind,
      searchMode: 'exact',
      filterable: true,
      sortable: true
    })
  }
  return registry
}

async function seedSimplePublishedContent(db: any, args: {
  schemaKey: string
  schemaVersion: number
  id: string
  title: string
  path: string
}) {
  const now = new Date('2026-07-19T02:00:00.000Z')
  await db.insert(content).values({
    id: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: args.schemaVersion,
    status: 'published',
    contentJson: '{}',
    publishedRevisionId: `revision-${args.id}`,
    createdAt: now,
    updatedAt: now
  })
  await db.insert(contentListing).values({
    contentId: args.id,
    projectionScope: 'published',
    schemaKey: args.schemaKey,
    schemaVersion: args.schemaVersion,
    title: args.title,
    status: 'published',
    createdAt: now,
    updatedAt: now
  })
  await db.insert(publicRoute).values({
    path: args.path,
    routeKind: 'canonical',
    documentKind: 'content',
    documentId: args.id,
    schemaKey: args.schemaKey,
    createdAt: now,
    updatedAt: now
  })
}

async function seedArticleSchema(db: any) {
  const now = new Date('2026-07-19T00:00:00.000Z')
  await db.insert(userRole).values({ roleKey: 'anonymous', title: 'Anonymous', level: 0 }).onConflictDoNothing()
  await db.insert(schema).values({
    schemaKey: 'article',
    version: 1,
    title: 'Articles',
    astJson: JSON.stringify({ schemaKey: 'article', title: 'Articles', fields: [] }),
    jsonSchema: JSON.stringify({ type: 'object' }),
    registryJson: JSON.stringify(articleRegistry),
    createdAt: now
  })
  await db.insert(schemaActive).values({
    schemaKey: 'article',
    activeVersion: 1,
    status: 'active',
    updatedAt: now
  })
  await db.insert(schemaRole).values({
    schemaKey: 'article',
    roleKey: 'anonymous',
    canRead: true
  })
  await db.insert(searchConfig).values(articleRegistry.fields.map(field => ({
    schemaKey: 'article',
    fieldId: field.fieldId,
    fieldKey: field.key,
    kind: field.kind,
    searchMode: field.search?.mode ?? 'off',
    filterable: field.search?.filterable ?? false,
    sortable: field.search?.sortable ?? false
  })))
}

async function seedArticle(db: any, args: {
  id: string
  title: string
  path: string
  tag: string
  category: string
  createdAt: Date
  status?: string
  listingStatus?: string
  canonical?: boolean
}) {
  const published = args.status !== 'deleted' && args.listingStatus !== 'draft'
  await db.insert(content).values({
    id: args.id,
    schemaKey: 'article',
    schemaVersion: 1,
    status: args.status ?? 'published',
    contentJson: '{}',
    publishedRevisionId: published ? `revision-${args.id}` : null,
    createdAt: args.createdAt,
    updatedAt: args.createdAt
  })
  await db.insert(contentListing).values({
    contentId: args.id,
    projectionScope: 'published',
    schemaKey: 'article',
    schemaVersion: 1,
    title: args.title,
    status: args.listingStatus ?? 'published',
    createdAt: args.createdAt,
    updatedAt: args.createdAt
  })
  await db.insert(contentSearchData).values([{
    contentId: args.id,
    projectionScope: 'published',
    fieldId: 'tags-field',
    dataType: 'text',
    text: args.tag
  }, {
    contentId: args.id,
    projectionScope: 'published',
    fieldId: 'category-field',
    dataType: 'text',
    text: args.category
  }])
  await db.insert(publicRoute).values({
    path: args.path,
    routeKind: args.canonical === false ? 'alias' : 'canonical',
    documentKind: 'content',
    documentId: args.id,
    schemaKey: 'article',
    createdAt: args.createdAt,
    updatedAt: args.createdAt
  })
}

async function seedPage(db: any, args: {
  id: string
  path: string
  publishedTitle: string
  workingTitle?: string
  published?: boolean
  routeKind?: 'canonical' | 'alias'
}) {
  const now = new Date('2026-07-19T01:00:00.000Z')
  const revisionId = `revision-${args.id}`
  if (args.published !== false) {
    await db.insert(publicationRevision).values({
      id: revisionId,
      documentKind: 'page',
      documentId: args.id,
      title: args.publishedTitle,
      contentJson: '{}',
      createdAt: now
    })
  }
  await db.insert(page).values({
    id: args.id,
    title: args.workingTitle ?? `Working ${args.publishedTitle}`,
    status: args.published === false ? 'draft' : 'published',
    contentJson: '{}',
    publishedRevisionId: args.published === false ? null : revisionId,
    createdAt: now,
    updatedAt: now
  })
  await db.insert(publicRoute).values({
    path: args.path,
    routeKind: args.routeKind ?? 'canonical',
    documentKind: 'page',
    documentId: args.id,
    schemaKey: null,
    createdAt: now,
    updatedAt: now
  })
}

describe('typed dynamic Site menu contract', () => {
  it('round-trips typed sources and rejects every expression-shaped escape hatch and configured cap overflow', () => {
    const valid = {
      version: 1,
      items: [{ kind: 'dynamic', id: 'recent-articles', source: schemaSource() }, {
        id: 'company',
        label: 'Company',
        destination: { type: 'home' },
        children: [{ kind: 'dynamic', id: 'company-pages', source: pageSource() }]
      }]
    }
    expect(siteMenuDocumentSchema.parse(valid)).toEqual({
      ...valid,
      items: [valid.items[0], {
        ...valid.items[1],
        children: [{
          ...valid.items[1]!.children![0],
          source: { ...pageSource(), scope: { type: 'fixed', prefix: '/foo' } }
        }]
      }]
    })

    for (const source of [
      '{ Article, sort=-createdAt, items=10 }',
      { ...schemaSource(), query: 'Article WHERE 1=1' },
      { ...schemaSource(), sql: 'DROP TABLE content' },
      { ...schemaSource(), expression: 'process.exit()' },
      { ...schemaSource(), regex: '/.*/' },
      { ...schemaSource(), sort: '-createdAt' },
      { ...schemaSource(), filters: [{ fieldId: 'tags-field', operator: 'contains', value: 'a' }] }
    ]) {
      expect(siteMenuDocumentSchema.safeParse({
        version: 1,
        items: [{ kind: 'dynamic', id: 'unsafe-source', source }]
      }).success).toBe(false)
    }

    expect(siteMenuDocumentSchema.safeParse({
      version: 1,
      items: [{ kind: 'dynamic', id: 'too-many-filters', source: schemaSource({
        filters: Array.from({ length: SITE_MENU_MAX_SOURCE_FILTERS + 1 }, (_, index) => ({
          fieldId: `field-${index}`,
          operator: 'exact' as const,
          value: 'x'
        }))
      }) }]
    }).success).toBe(false)
    expect(siteMenuDocumentSchema.safeParse({
      version: 1,
      items: [{ kind: 'dynamic', id: 'too-many-values', source: schemaSource({
        filters: [{
          fieldId: 'tags-field',
          operator: 'exactSet',
          values: Array.from({ length: SITE_MENU_MAX_EXACT_SET_VALUES + 1 }, (_, index) => `tag-${index}`)
        }]
      }) }]
    }).success).toBe(false)
    expect(siteMenuDocumentSchema.safeParse({
      version: 1,
      items: Array.from({ length: SITE_MENU_MAX_DYNAMIC_SOURCES + 1 }, (_, index) => ({
        kind: 'dynamic', id: `source-${index}`, source: pageSource()
      }))
    }).success).toBe(false)
    expect(siteMenuDocumentSchema.safeParse({
      version: 1,
      items: [{ kind: 'dynamic', id: 'too-many-results', source: schemaSource({
        limit: SITE_MENU_MAX_SOURCE_RESULTS + 1
      }) }]
    }).success).toBe(false)
  })
})

describe('dynamic Menu D1 execution gate', () => {
  it('transfers queued slots without exceeding the configured concurrency', async () => {
    const { createSiteMenuD1Gate } = await import('../server/utils/site-menu-sources')
    const gate = createSiteMenuD1Gate(4)
    let active = 0
    let maxActive = 0

    await Promise.all(Array.from({ length: 100 }, () => gate.run(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
    })))

    expect(maxActive).toBe(4)
    expect(active).toBe(0)
  })

  it('removes a timed-out queued query without leaking gate capacity', async () => {
    const { createSiteMenuD1Gate, withSourceTimeout } = await import('../server/utils/site-menu-sources')
    const gate = createSiteMenuD1Gate(1)
    let releaseBlocker!: () => void
    let markBlockerStarted!: () => void
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve
    })
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const blocker = gate.run(async () => {
      markBlockerStarted()
      await blockerReleased
    })
    await blockerStarted

    let queuedQueryRan = false
    await expect(withSourceTimeout(
      async signal => await gate.run(async () => {
        queuedQueryRan = true
      }, signal),
      10
    )).rejects.toThrow('Dynamic source exceeded its execution budget')

    releaseBlocker()
    await blocker
    expect(queuedQueryRan).toBe(false)

    let followupRan = false
    await gate.run(async () => {
      followupRan = true
    })
    expect(followupRan).toBe(true)
  })
})

describe('public dynamic Site menu resolution', () => {
  it('validates exact active Schema fields at save and resolves deterministic public exact/exact-set results', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedArticleSchema(fixture.db)
      await seedArticle(fixture.db, {
        id: 'article-alpha', title: 'Alpha', path: '/article/alpha', tag: 'a', category: 'news',
        createdAt: new Date('2026-07-19T02:00:00.000Z')
      })
      await seedArticle(fixture.db, {
        id: 'article-beta', title: 'Beta', path: '/article/beta', tag: 'b', category: 'guide',
        createdAt: new Date('2026-07-19T03:00:00.000Z')
      })
      await seedArticle(fixture.db, {
        id: 'article-gamma', title: 'Gamma', path: '/article/gamma', tag: 'b', category: 'guide',
        createdAt: new Date('2026-07-19T03:00:00.000Z')
      })
      await seedArticle(fixture.db, {
        id: 'article-private', title: 'No route', path: '/article/private-alias', tag: 'a', category: 'news',
        createdAt: new Date('2026-07-19T04:00:00.000Z'), canonical: false
      })
      await seedArticle(fixture.db, {
        id: 'article-draft', title: 'Draft', path: '/article/draft', tag: 'a', category: 'news',
        createdAt: new Date('2026-07-19T05:00:00.000Z'), listingStatus: 'draft'
      })
      await seedArticle(fixture.db, {
        id: 'article-deleted', title: 'Deleted', path: '/article/deleted', tag: 'a', category: 'news',
        createdAt: new Date('2026-07-19T05:30:00.000Z'), status: 'deleted'
      })

      const { createSiteMenu, resolvePublicMenuDocument, updateSiteMenu } = await import('../server/utils/site-menus')
      const created = await createSiteMenu(publicEvent(), { name: 'Dynamic articles' }, 'admin')
      const exactSetDocument = dynamicDocument(schemaSource({
        filters: [{ fieldId: 'tags-field', operator: 'exactSet', values: ['a', 'b'] }]
      }))
      await expect(updateSiteMenu(publicEvent(), created.id, {
        name: created.name,
        document: exactSetDocument
      }, 'admin')).resolves.toMatchObject({ document: exactSetDocument })

      const exactSet = await resolvePublicMenuDocument(publicEvent(), exactSetDocument, context())
      expect(exactSet.document.items.map(item => [item.label, item.to])).toEqual([
        ['Gamma', '/article/gamma'],
        ['Beta', '/article/beta'],
        ['Alpha', '/article/alpha']
      ])
      expect(exactSet.document.items.every(item => item.id === item.value && item.id.startsWith('dynamic:'))).toBe(true)
      expect((await resolvePublicMenuDocument(publicEvent(), exactSetDocument, context())).document.items.map(item => item.id))
        .toEqual(exactSet.document.items.map(item => item.id))

      const exact = await resolvePublicMenuDocument(publicEvent(), dynamicDocument(schemaSource({
        filters: [{ fieldId: 'category-field', operator: 'exact', value: 'news' }],
        sort: { type: 'system', field: 'updatedAt', direction: 'asc' }
      })), context())
      expect(exact.document.items.map(item => item.label)).toEqual(['Alpha'])

      const injectionValue = await resolvePublicMenuDocument(publicEvent(), dynamicDocument(schemaSource({
        filters: [{ fieldId: 'category-field', operator: 'exact', value: 'news\' OR 1=1 --' }]
      })), context())
      expect(injectionValue.document.items).toEqual([])

      await expect(updateSiteMenu(publicEvent(), created.id, {
        name: created.name,
        document: dynamicDocument(schemaSource({
          filters: [{ fieldId: 'body-field', operator: 'exact', value: 'unsafe' }]
        }))
      }, 'admin')).rejects.toMatchObject({
        name: 'SiteMenuValidationError',
        issues: [expect.objectContaining({ message: expect.stringContaining('supported scalar') })]
      })
      await expect(updateSiteMenu(publicEvent(), created.id, {
        name: created.name,
        document: dynamicDocument(schemaSource({
          sort: { type: 'field', fieldId: 'missing-field', direction: 'asc' }
        }))
      }, 'admin')).rejects.toMatchObject({ name: 'SiteMenuValidationError' })

      const malformedAt = new Date('2026-07-19T06:00:00.000Z')
      await fixture.db.insert(siteMenuSet).values({
        id: 'legacy-malformed-source-menu',
        name: 'Legacy malformed source',
        nameKey: siteMenuNameKey('Legacy malformed source'),
        documentJson: JSON.stringify({
          version: 1,
          items: [{
            id: 'legacy-static-parent',
            label: 'Static survives',
            destination: { type: 'home' },
            children: [{
              id: 'legacy-static-child',
              label: 'Static child survives',
              destination: { type: 'home' }
            }, {
              kind: 'dynamic',
              id: 'legacy-invalid-query',
              source: { version: 1, type: 'schemaQuery', query: 'SELECT * FROM content' }
            }]
          }, '{ Article, sort=-createdAt, items=10 }']
        }),
        bootstrapOwned: false,
        createdAt: malformedAt,
        updatedAt: malformedAt
      })
      const { parseStoredSiteMenu, resolvePublicLayoutMenus } = await import('../server/utils/site-menus')
      const malformedRow = await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, 'legacy-malformed-source-menu')).get()
      expect(parseStoredSiteMenu(malformedRow!)).toMatchObject({
        malformedStoredValue: true,
        omittedInvalidSources: true,
        document: { items: [{ id: 'legacy-static-parent', children: [{ id: 'legacy-static-child' }] }] }
      })
      const recoveredProjection = (await resolvePublicLayoutMenus(publicEvent(), ['legacy-malformed-source-menu'], {
        context: context()
      })).get('legacy-malformed-source-menu')
      expect(recoveredProjection).toMatchObject({
        status: 'ready',
        document: {
          items: [{ id: 'legacy-static-parent', children: [{ id: 'legacy-static-child' }] }]
        }
      })

      const privateEvent = publicEvent()
      await fixture.db.update(schemaRole).set({ canRead: false }).where(eq(schemaRole.schemaKey, 'article'))
      await bumpWidgetCacheScope(privateEvent, 'schema:article')
      const privateResult = await resolvePublicMenuDocument(privateEvent, exactSetDocument, context())
      expect(privateResult.document.items).toEqual([])
      expect(privateResult.diagnostics).toEqual([
        expect.objectContaining({ sourceId: 'source-main', status: 'invalid', count: 0 })
      ])

      await fixture.db.update(schemaRole).set({ canRead: true }).where(eq(schemaRole.schemaKey, 'article'))
      await fixture.db.update(schemaActive).set({ status: 'inactive' }).where(eq(schemaActive.schemaKey, 'article'))
      await bumpWidgetCacheScope(privateEvent, 'schema:article')
      const inactiveResult = await resolvePublicMenuDocument(privateEvent, exactSetDocument, context())
      expect(inactiveResult.document.items).toEqual([])
      expect(inactiveResult.diagnostics[0]).toMatchObject({ status: 'invalid' })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('uses canonical publication titles for fixed direct children and structural current-parent context', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await seedPage(fixture.db, { id: 'page-foo', path: '/foo', publishedTitle: 'Foo published' })
      await seedPage(fixture.db, {
        id: 'page-foo-bar', path: '/foo/bar', publishedTitle: 'Bar published', workingTitle: 'Bar working'
      })
      await seedPage(fixture.db, { id: 'page-foo-baz', path: '/foo/baz', publishedTitle: 'Baz published' })
      await seedPage(fixture.db, { id: 'page-deep', path: '/foo/deep/item', publishedTitle: 'Deep' })
      await seedPage(fixture.db, { id: 'page-root', path: '/root-page', publishedTitle: 'Root published' })
      await seedPage(fixture.db, { id: 'page-draft', path: '/foo/draft', publishedTitle: 'Draft', published: false })
      await seedPage(fixture.db, {
        id: 'page-unicode', path: '/café/하위', publishedTitle: 'Unicode published'
      })

      const { resolvePublicMenuDocument } = await import('../server/utils/site-menus')
      const fixedDocument = dynamicDocument(pageSource())
      const fixed = await resolvePublicMenuDocument(publicEvent(), fixedDocument, context())
      expect(fixed.document.items.map(item => [item.label, item.to])).toEqual([
        ['Bar published', '/foo/bar'],
        ['Baz published', '/foo/baz']
      ])
      expect(JSON.stringify(fixed.document)).not.toContain('Bar working')
      expect(JSON.stringify(fixed.document)).not.toContain('/foo/deep/item')
      expect(JSON.stringify(fixed.document)).not.toContain('/foo/draft')

      const contextualDocument = dynamicDocument(pageSource({ scope: { type: 'currentParent' } }))
      const siblings = await resolvePublicMenuDocument(publicEvent(), contextualDocument, context())
      expect(siblings.document.items.map(item => item.to)).toEqual(['/foo/bar', '/foo/baz'])
      expect(siblings.document.items.some(item => item.to === '/foo/bar')).toBe(true)

      const rootSiblings = await resolvePublicMenuDocument(publicEvent(), contextualDocument, context({
        documentId: 'page-foo',
        canonicalPath: '/foo'
      }))
      expect(rootSiblings.document.items.map(item => item.to)).toEqual(['/foo', '/root-page'])

      const unavailable = await resolvePublicMenuDocument(publicEvent(), contextualDocument, context({
        documentKind: 'content',
        documentId: 'article-alpha',
        schemaKey: 'article',
        schemaVersion: 1,
        canonicalPath: '/article/alpha'
      }))
      expect(unavailable.document.items).toEqual([])
      expect(unavailable.diagnostics[0]).toMatchObject({ status: 'context-unavailable' })

      const unicode = await resolvePublicMenuDocument(publicEvent(), dynamicDocument(pageSource({
        scope: { type: 'fixed', prefix: '/Ｃａｆé/' }
      })), context())
      expect(unicode.document.items.map(item => item.to)).toEqual(['/café/하위'])

      const mergedDocument = siteMenuDocumentSchema.parse({
        version: 1,
        items: [{ id: 'home', label: 'Home', destination: { type: 'home' }, children: [] }, {
          kind: 'dynamic', id: 'missing-context', source: pageSource({ scope: { type: 'currentParent' } })
        }, {
          id: 'foo-parent', label: 'Foo', destination: { type: 'page', pageId: 'page-foo' }, children: [{
            kind: 'dynamic', id: 'foo-children', source: pageSource({ limit: SITE_MENU_MAX_SOURCE_RESULTS })
          }]
        }]
      })
      const merged = await resolvePublicMenuDocument(publicEvent(), mergedDocument, context({
        documentKind: 'schema', documentId: 'article', schemaKey: 'article', schemaVersion: 1, canonicalPath: '/article'
      }))
      expect(merged.document.items[0]).toMatchObject({ id: 'home', value: 'home', to: '/' })
      expect(merged.document.items[1]).toMatchObject({ id: 'foo-parent', children: [
        expect.objectContaining({ to: '/foo/bar' }),
        expect.objectContaining({ to: '/foo/baz' })
      ] })
      expect(merged.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: 'missing-context', status: 'context-unavailable' }),
        expect.objectContaining({ sourceId: 'foo-children', status: 'ready' })
      ]))
      expect(merged.digest).toMatch(/^[0-9a-f]{64}$/)

      const boundedTop = await resolvePublicMenuDocument(publicEvent(), siteMenuDocumentSchema.parse({
        version: 1,
        items: [{ kind: 'dynamic', id: 'bounded-top-source', source: pageSource() },
          ...Array.from({ length: 11 }, (_, index) => ({
            id: `bounded-static-${index}`,
            label: `Static ${index}`,
            destination: { type: 'home' },
            children: []
          }))]
      }), context())
      expect(boundedTop.document.items).toHaveLength(12)
      expect(boundedTop.document.items.filter(item => item.id.startsWith('bounded-static-'))).toHaveLength(11)
      expect(boundedTop.document.items.filter(item => item.id.startsWith('dynamic:'))).toHaveLength(1)

      const boundedChildren = await resolvePublicMenuDocument(publicEvent(), siteMenuDocumentSchema.parse({
        version: 1,
        items: [{
          id: 'bounded-parent',
          label: 'Bounded parent',
          destination: { type: 'home' },
          children: [{ kind: 'dynamic', id: 'bounded-child-source', source: pageSource() },
            ...Array.from({ length: 7 }, (_, index) => ({
              id: `bounded-child-${index}`,
              label: `Child ${index}`,
              destination: { type: 'home' }
            }))]
        }]
      }), context())
      expect(boundedChildren.document.items[0]!.children).toHaveLength(8)
      expect(boundedChildren.document.items[0]!.children.filter(item => item.id.startsWith('bounded-child-'))).toHaveLength(7)
      expect(boundedChildren.document.items[0]!.children.filter(item => item.id.startsWith('dynamic:'))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('bulk-prepares eight distinct Schema sources below the D1 statement budget and caps concurrency', async () => {
    const audit = createQueryAudit()
    const fixture = await createTestSqliteDb({
      onQueryStart: audit.onQueryStart,
      onQueryEnd: audit.onQueryEnd
    })
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(userRole).values({ roleKey: 'anonymous', title: 'Anonymous', level: 0 })
      const sources = [] as Array<{ kind: 'dynamic', id: string, source: ReturnType<typeof schemaSource> }>
      for (let index = 0; index < SITE_MENU_MAX_DYNAMIC_SOURCES; index++) {
        const schemaKey = `menu_schema_${index}`
        await seedSimpleSchema(fixture.db, { schemaKey })
        await seedSimplePublishedContent(fixture.db, {
          schemaKey,
          schemaVersion: 1,
          id: `menu-content-${index}`,
          title: `Menu content ${index}`,
          path: `/menu-content-${index}`
        })
        sources.push({
          kind: 'dynamic',
          id: `source-${index}`,
          source: schemaSource({ schemaKey, limit: 1 })
        })
      }
      const document = siteMenuDocumentSchema.parse({ version: 1, items: sources })
      const { resolvePublicMenuDocument } = await import('../server/utils/site-menus')
      const { SITE_MENU_SOURCE_D1_CONCURRENCY } = await import('../server/utils/site-menu-sources')

      audit.state.enabled = true
      const resolved = await resolvePublicMenuDocument(publicEvent(), document, context())
      audit.state.enabled = false

      expect(resolved.document.items).toHaveLength(SITE_MENU_MAX_DYNAMIC_SOURCES)
      expect(audit.state.statements).toBeLessThan(50)
      expect(SITE_MENU_SOURCE_D1_CONCURRENCY).toBeLessThanOrEqual(4)
      expect(audit.state.maxActive).toBeLessThanOrEqual(6)
      expect(audit.state.maxParams).toBeLessThanOrEqual(90)
      expect(audit.state.active).toBe(0)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('chunks more than one hundred published Schema versions within the D1 parameter convention', async () => {
    const audit = createQueryAudit()
    const fixture = await createTestSqliteDb({
      onQueryStart: audit.onQueryStart,
      onQueryEnd: audit.onQueryEnd
    })
    try {
      await runMigrations(fixture.db)
      for (let version = 1; version <= 101; version++) {
        await seedSimpleSchema(fixture.db, { schemaKey: 'versioned_menu', version, active: false })
        await seedSimplePublishedContent(fixture.db, {
          schemaKey: 'versioned_menu',
          schemaVersion: version,
          id: `versioned-content-${version}`,
          title: `Version ${version}`,
          path: `/versioned/${version}`
        })
      }
      const { getPublishedSchemaFields } = await import('../server/cms/published-search')

      audit.state.enabled = true
      const fields = await getPublishedSchemaFields(fixture.db, 'versioned_menu', 'published')
      audit.state.enabled = false

      expect(fields).toHaveLength(101)
      expect(audit.state.statements).toBe(4)
      expect(audit.state.maxParams).toBeLessThanOrEqual(90)
      expect(audit.state.active).toBe(0)
    } finally {
      fixture.close()
    }
  })

  it('bulk-loads source options for more than fifty Schemas in safe chunks', async () => {
    const audit = createQueryAudit()
    const fixture = await createTestSqliteDb({
      onQueryStart: audit.onQueryStart,
      onQueryEnd: audit.onQueryEnd
    })
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(userRole).values({ roleKey: 'anonymous', title: 'Anonymous', level: 0 })
      for (let index = 0; index < 101; index++) {
        await seedSimpleSchema(fixture.db, { schemaKey: `option_schema_${index}`, withField: true })
      }
      const { getSiteMenuSourceOptions } = await import('../server/utils/site-menu-sources')

      audit.state.enabled = true
      const options = await getSiteMenuSourceOptions(publicEvent())
      audit.state.enabled = false

      expect(options.schemas).toHaveLength(101)
      expect(options.schemas.every(option => option.fields.length === 1)).toBe(true)
      expect(audit.state.statements).toBe(4)
      expect(audit.state.maxParams).toBeLessThanOrEqual(90)
      expect(audit.state.active).toBe(0)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('resolves same-host no-KV requests fresh after publish, content, role, and Page changes', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    const sameHostEvent = () => ({
      context: {},
      node: { req: { headers: { host: 'same-host-no-kv.example.test' } } }
    } as any)
    try {
      await runMigrations(fixture.db)
      await seedArticleSchema(fixture.db)
      await seedArticle(fixture.db, {
        id: 'fresh-article',
        title: 'Original article',
        path: '/article/fresh',
        tag: 'a',
        category: 'news',
        createdAt: new Date('2026-07-19T02:00:00.000Z')
      })
      await seedPage(fixture.db, {
        id: 'fresh-page',
        path: '/foo/fresh',
        publishedTitle: 'Original page'
      })
      const { resolvePublicMenuDocument } = await import('../server/utils/site-menus')
      const articleDocument = dynamicDocument(schemaSource({ limit: 1 }))
      const pageDocument = dynamicDocument(pageSource({ limit: 1 }))

      expect((await resolvePublicMenuDocument(sameHostEvent(), articleDocument, context())).document.items[0]?.label)
        .toBe('Original article')

      await seedArticle(fixture.db, {
        id: 'newly-published-article',
        title: 'Newly published article',
        path: '/article/newly-published',
        tag: 'a',
        category: 'news',
        createdAt: new Date('2026-07-19T03:00:00.000Z')
      })
      expect((await resolvePublicMenuDocument(sameHostEvent(), articleDocument, context())).document.items[0]?.label)
        .toBe('Newly published article')

      await fixture.db.update(contentListing).set({ title: 'Changed article' })
        .where(eq(contentListing.contentId, 'newly-published-article'))
      expect((await resolvePublicMenuDocument(sameHostEvent(), articleDocument, context())).document.items[0]?.label)
        .toBe('Changed article')

      await fixture.db.update(schemaRole).set({ canRead: false }).where(eq(schemaRole.schemaKey, 'article'))
      expect((await resolvePublicMenuDocument(sameHostEvent(), articleDocument, context())).document.items).toEqual([])
      await fixture.db.update(schemaRole).set({ canRead: true }).where(eq(schemaRole.schemaKey, 'article'))

      expect((await resolvePublicMenuDocument(sameHostEvent(), pageDocument, context())).document.items[0]?.label)
        .toBe('Original page')
      await fixture.db.update(publicationRevision).set({ title: 'Changed page' })
        .where(eq(publicationRevision.id, 'revision-fresh-page'))
      expect((await resolvePublicMenuDocument(sameHostEvent(), pageDocument, context())).document.items[0]?.label)
        .toBe('Changed page')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('wires private preview and all relevant publication/permission invalidation scopes', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [preview, roles, schemaPublish, pagePublish, pageUnpublish, pageDelete] = await Promise.all([
      readFile(resolve(root, 'server/api/site/menus/[menuId]/preview.post.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/schema/[schemaKey]/roles.patch.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/schema/[schemaKey]/publish.post.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/page/[id]/publish.post.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/page/[id]/unpublish.post.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/page/[id].delete.ts'), 'utf8')
    ])
    expect(preview.indexOf('requireAdmin(event)')).toBeGreaterThan(-1)
    expect(preview).toContain('applyPreviewDeliveryHeaders(event)')
    expect(preview).toContain('resolvePublicMenuDocument(event, document.data, context)')
    expect(preview).not.toMatch(/default\.vue|desk\.vue|app\/layouts|resolveComponent|import\(/)
    expect(roles).toContain('if (roleKey === \'anonymous\') queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)')
    expect(schemaPublish).toContain('queueWidgetCacheInvalidation(event, `schema:${schemaKey}`)')
    for (const source of [pagePublish, pageUnpublish, pageDelete]) {
      expect(source).toContain('queueWidgetCacheInvalidation(event, \'public-routes:page\')')
    }
  })
})
