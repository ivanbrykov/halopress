import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createLayoutDocumentFromPreset,
  layoutDocumentSchema,
  layoutNameKey,
  type LayoutDocument
} from '../shared/site-layout'
import type { LayoutRenderContext, ResolvedLayoutElement } from '../shared/layout-rendering'
import {
  content,
  layoutResource,
  page,
  publicationRevision,
  publicRoute,
  schema,
  schemaActive,
  settings,
  siteMenuSet
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
const themeState = vi.hoisted(() => ({
  current: {
    contractVersion: 1 as const,
    siteModeEnabled: true,
    revision: 'a'.repeat(64),
    stylesheetRevision: 'b'.repeat(64),
    stylesheetUrl: 'https://press.example.com/_halo/theme/v1/theme.css',
    colorMode: 'system' as const
  }
}))
const siteState = vi.hoisted(() => ({
  current: {
    revision: 'c'.repeat(64),
    siteName: 'Fixture Press',
    description: 'Fixture description',
    locale: 'en',
    logoUrl: null,
    faviconUrl: '/branding/favicon.png',
    socialImageUrl: '/branding/social.png'
  }
}))

vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))
vi.mock('../server/utils/site-theme-settings', () => ({
  getPublicSiteThemeManifest: vi.fn(async () => themeState.current)
}))
vi.mock('../server/utils/site-presentation-settings', () => ({
  getPublicSiteIdentity: vi.fn(async () => siteState.current)
}))

const event = { context: {} } as any
const publicPageContext = (documentId: string, canonicalPath: string): LayoutRenderContext => ({
  visibility: 'public',
  documentKind: 'page',
  documentId,
  schemaKey: null,
  schemaVersion: null,
  canonicalPath
})

let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>

async function setSiteMode(enabled: boolean) {
  const now = new Date('2026-07-18T00:00:00.000Z')
  await fixture.db.insert(settings).values({
    scope: 'global',
    key: 'site.mode',
    value: JSON.stringify({ version: 1, enabled }),
    valueType: 'json',
    isEncrypted: false,
    groupKey: 'site.mode',
    updatedAt: now
  }).onConflictDoUpdate({
    target: [settings.scope, settings.key],
    set: { value: JSON.stringify({ version: 1, enabled }), updatedAt: now }
  })
}

async function seedLayout(id: string, name: string, preset: 'blank' | 'grid' = 'blank') {
  const document = createLayoutDocumentFromPreset(preset, id, name)
  const now = new Date('2026-07-18T00:01:00.000Z')
  await fixture.db.insert(layoutResource).values({
    id,
    name,
    nameKey: layoutNameKey(name),
    documentJson: JSON.stringify(document),
    currentRevision: 1,
    createdAt: now,
    updatedAt: now
  })
  return document
}

async function seedPublishedPage(args: {
  id: string
  workingTitle: string
  publishedTitle: string | null
  path: string
  layoutId?: string | null
}) {
  const now = new Date('2026-07-18T00:02:00.000Z')
  const revisionId = `publication-${args.id}`
  await fixture.db.insert(publicationRevision).values({
    id: revisionId,
    documentKind: 'page',
    documentId: args.id,
    title: args.publishedTitle,
    contentJson: JSON.stringify({ type: 'doc', content: [] }),
    layoutId: args.layoutId ?? null,
    createdAt: now
  })
  await fixture.db.insert(page).values({
    id: args.id,
    title: args.workingTitle,
    status: 'published',
    contentJson: JSON.stringify({ type: 'doc', content: [] }),
    layoutId: args.layoutId ?? null,
    publishedRevisionId: revisionId,
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  })
  await fixture.db.insert(publicRoute).values({
    path: args.path,
    routeKind: 'canonical',
    documentKind: 'page',
    documentId: args.id,
    schemaKey: null,
    createdAt: now,
    updatedAt: now
  })
}

function readyAssignment(document: LayoutDocument) {
  return {
    status: 'ready' as const,
    source: 'page' as const,
    layoutId: document.layoutId,
    name: document.name,
    revision: 1,
    document
  }
}

function element<Type extends ResolvedLayoutElement['type']>(
  elements: ResolvedLayoutElement[],
  type: Type,
  id?: string
) {
  return elements.find(candidate => candidate.type === type && (!id || candidate.id === id)) as
    | Extract<ResolvedLayoutElement, { type: Type }>
    | undefined
}

beforeEach(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  event.context = {}
  await runMigrations(fixture.db)
})

afterEach(() => {
  fixture.close()
  dbState.current = null
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('Layout rendering resolver', () => {
  it('short-circuits to the fixed shell while Sites mode is disabled', async () => {
    const resolveAssignment = vi.fn(async () => readyAssignment(
      createLayoutDocumentFromPreset('blank', 'stored-layout', 'Stored Layout')
    ))
    const resolveOutline = vi.fn(async () => [])
    const resolveContext = vi.fn(async () => {
      throw new Error('Disabled Sites mode must not enrich publication context')
    })
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')

    const projection = await resolveLayoutRendering({
      event,
      context: publicPageContext('page-disabled', '/disabled'),
      resolveContext,
      resolveAssignment,
      resolveOutline
    })

    expect(projection).toMatchObject({
      status: 'disabled',
      reason: 'site-disabled',
      context: { documentId: 'page-disabled' }
    })
    expect(resolveAssignment).not.toHaveBeenCalled()
    expect(resolveContext).not.toHaveBeenCalled()
    expect(resolveOutline).not.toHaveBeenCalled()
  })

  it('preserves unassigned and broken-explicit fallback reasons', async () => {
    await setSiteMode(true)
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')
    const context = publicPageContext('page-fallback', '/fallback')

    const unassigned = await resolveLayoutRendering({
      event,
      context,
      resolveOutline: vi.fn(async () => {
        throw new Error('Fallback must not resolve authored content')
      }),
      resolveAssignment: async () => ({
        status: 'fallback',
        source: 'built-in',
        reason: 'unassigned'
      })
    })
    expect(unassigned).toMatchObject({
      status: 'built-in-fallback',
      reason: 'unassigned',
      diagnostics: [{ code: 'layout-unassigned' }]
    })

    const firstBroken = await resolveLayoutRendering({
      event,
      context,
      resolveAssignment: async () => ({
        status: 'fallback',
        source: 'built-in',
        reason: 'explicit-assignment-unavailable',
        diagnostic: {
          source: 'page',
          layoutId: 'deleted-layout',
          status: 'missing',
          reason: 'Assigned Layout resource is unavailable'
        }
      })
    })
    expect(firstBroken).toMatchObject({
      status: 'built-in-fallback',
      reason: 'explicit-assignment-unavailable',
      diagnostics: [{ code: 'layout-unavailable', message: 'Assigned Layout resource is unavailable' }]
    })
    const secondBroken = await resolveLayoutRendering({
      event,
      context,
      resolveAssignment: async () => ({
        status: 'fallback',
        source: 'built-in',
        reason: 'explicit-assignment-unavailable',
        diagnostic: {
          source: 'page',
          layoutId: 'another-deleted-layout',
          status: 'missing',
          reason: 'Assigned Layout resource is unavailable'
        }
      })
    })
    expect(secondBroken.revision).not.toBe(firstBroken.revision)
  })

  it('degrades an invalid published Page-list row without suppressing Page content', async () => {
    await setSiteMode(true)
    await seedPublishedPage({
      id: 'long-title-page',
      workingTitle: 'Working title',
      publishedTitle: 'x'.repeat(501),
      path: '/long-title-page'
    })
    const document = createLayoutDocumentFromPreset('grid', 'long-title-layout', 'Long title Layout')
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')
    const projection = await resolveLayoutRendering({
      event,
      context: publicPageContext('long-title-page', '/long-title-page'),
      resolveAssignment: async () => readyAssignment(document)
    })
    expect(projection.status).toBe('ready')
    if (projection.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(projection.elements, 'page-content')).toBeTruthy()
    expect(element(projection.elements, 'page-list')?.props.items).toEqual([])
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({ code: 'page-list-unavailable' }))
  })

  it('uses canonical parent directories and published Page titles, filters named Menus, and invalidates revisions', async () => {
    await setSiteMode(true)
    await seedPublishedPage({
      id: 'current-page',
      workingTitle: 'Working Current',
      publishedTitle: 'Current Published',
      path: '/foo/bar/current'
    })
    await seedPublishedPage({
      id: 'sibling-page',
      workingTitle: 'ZZZ Working Sibling',
      publishedTitle: 'Alpha Published',
      path: '/foo/bar/sibling'
    })
    await seedPublishedPage({
      id: 'other-directory-page',
      workingTitle: 'Working Other',
      publishedTitle: 'Other Published',
      path: '/foo/baz/other'
    })
    await seedPublishedPage({
      id: 'nested-page',
      workingTitle: 'Working Nested',
      publishedTitle: 'Nested Published',
      path: '/foo/bar/nested/child'
    })

    const now = new Date('2026-07-18T00:03:00.000Z')
    await fixture.db.insert(page).values({
      id: 'private-page',
      title: 'Private working title',
      status: 'draft',
      contentJson: JSON.stringify({ type: 'doc', content: [] }),
      createdAt: now,
      updatedAt: now
    })
    await fixture.db.insert(publicRoute).values({
      path: '/private',
      routeKind: 'canonical',
      documentKind: 'page',
      documentId: 'private-page',
      schemaKey: null,
      createdAt: now,
      updatedAt: now
    })

    await fixture.db.insert(siteMenuSet).values([
      {
        id: 'named-menu',
        name: 'Named Menu',
        nameKey: 'named menu',
        documentJson: JSON.stringify({
          version: 1,
          items: [
            {
              id: 'public-link',
              label: 'Published sibling',
              destination: { type: 'page', pageId: 'sibling-page' },
              children: []
            },
            {
              id: 'private-link',
              label: 'Private page',
              destination: { type: 'page', pageId: 'private-page' },
              children: []
            }
          ]
        }),
        bootstrapOwned: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'malformed-menu',
        name: 'Malformed Menu',
        nameKey: 'malformed menu',
        documentJson: '{not-json',
        bootstrapOwned: false,
        createdAt: now,
        updatedAt: now
      }
    ])

    const base = createLayoutDocumentFromPreset('grid', 'runtime-layout', 'Runtime Layout')
    const menu = base.elements.find(candidate => candidate.type === 'menu')!
    menu.props.menuSetId = 'named-menu'
    const pageList = base.elements.find(candidate => candidate.type === 'page-list')!
    pageList.props.scope = 'current-section'
    pageList.props.sort = 'title-ascending'
    pageList.props.limit = 2
    base.elements.push(
      {
        id: 'malformed-menu-element',
        type: 'menu',
        region: 'header',
        order: 3,
        props: { menuSetId: 'malformed-menu', orientation: 'horizontal' }
      },
      {
        id: 'missing-menu-element',
        type: 'menu',
        region: 'header',
        order: 4,
        props: { menuSetId: 'missing-menu', orientation: 'horizontal' }
      }
    )
    const document = layoutDocumentSchema.parse(base)
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')
    const context = publicPageContext('current-page', '/foo/bar/current')
    const resolve = (nextContext = context) => resolveLayoutRendering({
      event,
      context: nextContext,
      resolveAssignment: async () => readyAssignment(document)
    })

    const first = await resolve()
    const stable = await resolve()
    expect(first.status).toBe('ready')
    expect(stable.revision).toBe(first.revision)
    if (first.status !== 'ready' || stable.status !== 'ready') throw new Error('Expected a ready Layout projection')

    expect(element(first.elements, 'page-list')?.props.items).toEqual([
      expect.objectContaining({ id: 'sibling-page', title: 'Alpha Published', path: '/foo/bar/sibling' }),
      expect.objectContaining({ id: 'current-page', title: 'Current Published', path: '/foo/bar/current' })
    ])
    expect(element(first.elements, 'page-list')?.props.items.map(item => item.id))
      .not.toEqual(expect.arrayContaining(['other-directory-page', 'nested-page']))

    const readyMenu = element(first.elements, 'menu', 'menu-header')
    expect(readyMenu?.props.menu).toMatchObject({
      status: 'ready',
      menuSetId: 'named-menu',
      document: {
        items: [{ id: 'public-link', to: '/foo/bar/sibling' }]
      }
    })
    expect(JSON.stringify(readyMenu?.props.menu.document)).not.toContain('private-page')
    expect(element(first.elements, 'menu', 'malformed-menu-element')?.props.menu.status).toBe('malformed')
    expect(element(first.elements, 'menu', 'missing-menu-element')?.props.menu.status).toBe('missing')
    expect(first.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'menu-malformed', elementId: 'malformed-menu-element' }),
      expect.objectContaining({ code: 'menu-missing', elementId: 'missing-menu-element' })
    ]))

    const differentContext = await resolve(publicPageContext('current-page', '/foo/bar/another'))
    expect(differentContext.status).toBe('ready')
    if (differentContext.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(differentContext.elements, 'menu', 'menu-header')?.props.menu.digest)
      .not.toBe(readyMenu?.props.menu.digest)
    expect(differentContext.revision).not.toBe(first.revision)

    await fixture.db.update(publicRoute).set({
      path: '/foo/bar/renamed',
      updatedAt: new Date('2026-07-18T00:04:00.000Z')
    }).where(eq(publicRoute.path, '/foo/bar/sibling'))
    const routeChanged = await resolve()
    expect(routeChanged.status).toBe('ready')
    if (routeChanged.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(routeChanged.elements, 'menu', 'menu-header')?.props.menu.document.items[0]?.to)
      .toBe('/foo/bar/renamed')
    expect(element(routeChanged.elements, 'menu', 'menu-header')?.props.menu.digest)
      .not.toBe(readyMenu?.props.menu.digest)
    expect(routeChanged.revision).not.toBe(first.revision)
  })

  it('uses SQLite Unicode length and an intentional empty section when preview paths are unavailable', async () => {
    await setSiteMode(true)
    await seedPublishedPage({
      id: 'unicode-current',
      workingTitle: 'Working current',
      publishedTitle: 'Unicode Current',
      path: '/𐐀/current'
    })
    await seedPublishedPage({
      id: 'unicode-sibling',
      workingTitle: 'Working sibling',
      publishedTitle: 'Unicode Sibling',
      path: '/𐐀/sibling'
    })
    const document = createLayoutDocumentFromPreset('grid', 'unicode-layout', 'Unicode Layout')
    const pageList = document.elements.find(candidate => candidate.type === 'page-list')!
    pageList.props.scope = 'current-section'
    pageList.props.limit = 10
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')
    const resolve = (canonicalPath: string | null) => resolveLayoutRendering({
      event,
      context: {
        ...publicPageContext('unicode-current', '/𐐀/current'),
        visibility: 'preview',
        canonicalPath
      },
      resolveAssignment: async () => readyAssignment(document)
    })

    const unicode = await resolve('/𐐀/current')
    expect(unicode.status).toBe('ready')
    if (unicode.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(unicode.elements, 'page-list')?.props.items.map(item => item.id)).toEqual([
      'unicode-current',
      'unicode-sibling'
    ])

    const withoutPath = await resolve(null)
    expect(withoutPath.status).toBe('ready')
    if (withoutPath.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(withoutPath.elements, 'page-list')?.props.items).toEqual([])
  })

  it('sorts Page-list rows by the same effective title shown to readers', async () => {
    await setSiteMode(true)
    await seedPublishedPage({
      id: 'untitled-page',
      workingTitle: 'Working untitled',
      publishedTitle: null,
      path: '/untitled'
    })
    await seedPublishedPage({
      id: 'apple-page',
      workingTitle: 'Working apple',
      publishedTitle: 'Apple',
      path: '/apple'
    })
    const document = createLayoutDocumentFromPreset('grid', 'title-order-layout', 'Title order Layout')
    const pageList = document.elements.find(candidate => candidate.type === 'page-list')!
    pageList.props.scope = 'all-pages'
    pageList.props.sort = 'title-ascending'
    pageList.props.limit = 10
    const { resolveLayoutRendering } = await import('../server/utils/layout-rendering')
    const projection = await resolveLayoutRendering({
      event,
      context: publicPageContext('apple-page', '/apple'),
      resolveAssignment: async () => readyAssignment(document)
    })
    expect(projection.status).toBe('ready')
    if (projection.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(element(projection.elements, 'page-list')?.props.items.map(item => item.title)).toEqual([
      'Apple',
      'Untitled page'
    ])
  })

  it('selects working Page and exact content Schema-version assignments for preview', async () => {
    await setSiteMode(true)
    await seedLayout('layout-page-working', 'Working Page Layout', 'grid')
    await seedLayout('layout-page-published', 'Published Page Layout')
    await seedLayout('layout-schema-v1', 'Schema v1 Layout')
    await seedLayout('layout-schema-v2', 'Schema v2 Layout')
    const now = new Date('2026-07-18T00:05:00.000Z')

    await fixture.db.insert(publicationRevision).values([
      {
        id: 'publication-page-preview',
        documentKind: 'page',
        documentId: 'page-preview',
        title: 'Published Page',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        layoutId: 'layout-page-published',
        createdAt: now
      },
      {
        id: 'publication-content-preview',
        documentKind: 'content',
        documentId: 'content-preview',
        schemaKey: 'article',
        schemaVersion: 2,
        contentJson: JSON.stringify({ title: 'Published content' }),
        createdAt: now
      }
    ])
    await fixture.db.insert(page).values({
      id: 'page-preview',
      title: 'Working Page',
      status: 'published',
      contentJson: JSON.stringify({ type: 'doc', content: [] }),
      layoutId: 'layout-page-working',
      publishedRevisionId: 'publication-page-preview',
      createdAt: now,
      updatedAt: now
    })
    await fixture.db.insert(schema).values([
      {
        schemaKey: 'article',
        version: 1,
        title: 'Article v1',
        astJson: JSON.stringify({
          schemaKey: 'article',
          title: 'Article',
          fields: [],
          presentation: { layoutId: 'layout-schema-v1' }
        }),
        jsonSchema: JSON.stringify({ type: 'object' }),
        createdAt: now
      },
      {
        schemaKey: 'article',
        version: 2,
        title: 'Article v2',
        astJson: JSON.stringify({
          schemaKey: 'article',
          title: 'Article',
          fields: [],
          presentation: { layoutId: 'layout-schema-v2' }
        }),
        jsonSchema: JSON.stringify({ type: 'object' }),
        createdAt: now
      }
    ])
    await fixture.db.insert(schemaActive).values({ schemaKey: 'article', activeVersion: 2, updatedAt: now })
    await fixture.db.insert(content).values({
      id: 'content-preview',
      schemaKey: 'article',
      schemaVersion: 1,
      status: 'published',
      contentJson: JSON.stringify({ title: 'Working content' }),
      publishedRevisionId: 'publication-content-preview',
      createdAt: now,
      updatedAt: now
    })

    const {
      resolvePreviewContentLayoutRendering,
      resolvePreviewPageLayoutRendering,
      resolvePublicLayoutRendering
    } = await import('../server/utils/layout-rendering')
    const previewPageOutline = vi.fn(() => [{ id: 'working-heading', level: 2 as const, text: 'Working heading' }])
    const previewContentOutline = vi.fn(() => {
      throw new Error('A Layout without a table of contents must not resolve its outline')
    })
    const publicPage = await resolvePublicLayoutRendering(event, publicPageContext('page-preview', '/page-preview'), [])
    const previewPage = await resolvePreviewPageLayoutRendering(event, {
      visibility: 'preview',
      documentKind: 'page',
      documentId: 'page-preview',
      schemaKey: null,
      schemaVersion: null,
      canonicalPath: '/page-preview'
    }, previewPageOutline)
    const publicContent = await resolvePublicLayoutRendering(event, {
      visibility: 'public',
      documentKind: 'content',
      documentId: 'content-preview',
      schemaKey: 'article',
      schemaVersion: 2,
      canonicalPath: '/article/content-preview'
    }, [])
    const previewContent = await resolvePreviewContentLayoutRendering(event, {
      visibility: 'preview',
      documentKind: 'content',
      documentId: 'content-preview',
      schemaKey: 'article',
      schemaVersion: 1,
      canonicalPath: '/article/content-preview'
    }, previewContentOutline)

    expect(publicPage).toMatchObject({ status: 'ready', source: 'page', layoutId: 'layout-page-published' })
    expect(previewPage).toMatchObject({ status: 'ready', source: 'page', layoutId: 'layout-page-working' })
    expect(publicContent).toMatchObject({ status: 'ready', source: 'schema', layoutId: 'layout-schema-v2' })
    expect(previewContent).toMatchObject({ status: 'ready', source: 'schema', layoutId: 'layout-schema-v1' })
    expect(publicContent.context.schemaVersion).toBe(2)
    expect(previewContent.context.schemaVersion).toBe(1)
    expect(previewPageOutline).toHaveBeenCalledOnce()
    expect(previewContentOutline).not.toHaveBeenCalled()
    expect(previewPage.status === 'ready' && element(previewPage.elements, 'table-of-contents')?.props.items)
      .toEqual([{ id: 'working-heading', level: 2, text: 'Working heading' }])
  })
})
