import { describe, expect, it } from 'vitest'

import {
  LAYOUT_RENDERING_MAX_DIAGNOSTICS,
  layoutDiagnosticSchema,
  layoutRenderProjectionSchema,
  parseLayoutRenderProjection,
  resolvedLayoutElementSchema
} from '../shared/layout-rendering'
import {
  createLayoutDocumentFromPreset,
  layoutElementTypes,
  type LayoutDocument,
  type LayoutElement,
  type LayoutElementType
} from '../shared/site-layout'

const digest = 'a'.repeat(64)
const alternateDigest = 'b'.repeat(64)

const context = {
  visibility: 'public' as const,
  documentKind: 'page' as const,
  documentId: 'page-1',
  schemaKey: null,
  schemaVersion: null,
  canonicalPath: '/guides/getting-started'
}

function byType(document: LayoutDocument, type: LayoutElementType) {
  const element = document.elements.find(candidate => candidate.type === type)
  if (!element) throw new Error(`Missing ${type} test element`)
  return element
}

function base(element: LayoutElement) {
  return {
    id: element.id,
    region: element.region,
    order: element.order
  }
}

function createReadyProjection() {
  const document = createLayoutDocumentFromPreset('grid', 'public-grid', 'Public grid')
  const menu = {
    status: 'ready' as const,
    menuSetId: 'global-navigation',
    name: 'Global navigation',
    document: {
      version: 1 as const,
      items: [{
        id: 'home',
        label: 'Home',
        to: '/',
        value: 'home',
        children: []
      }]
    },
    digest
  }

  return {
    contractVersion: 1 as const,
    status: 'ready' as const,
    context,
    revision: digest,
    source: 'page' as const,
    layoutId: document.layoutId,
    name: document.name,
    layoutRevision: 3,
    document,
    theme: {
      contractVersion: 1 as const,
      siteModeEnabled: true,
      revision: digest,
      stylesheetRevision: alternateDigest,
      stylesheetUrl: `https://press.example.com/_halo/theme/v1/${alternateDigest}.css`,
      colorMode: 'system' as const
    },
    site: {
      revision: alternateDigest,
      siteName: 'HaloPress',
      description: 'A public HaloPress Site.',
      locale: 'en-US',
      logoUrl: '/assets/site-logo/raw',
      faviconUrl: '/assets/site-favicon/raw',
      socialImageUrl: '/assets/site-social/raw'
    },
    elements: [
      {
        ...base(byType(document, 'page-content')),
        type: 'page-content' as const,
        props: {}
      },
      {
        ...base(byType(document, 'site-logo')),
        type: 'site-logo' as const,
        props: {
          ...byType(document, 'site-logo').props,
          siteName: 'HaloPress',
          logoUrl: '/assets/site-logo/raw'
        }
      },
      {
        ...base(byType(document, 'site-title')),
        type: 'site-title' as const,
        props: {
          ...byType(document, 'site-title').props,
          siteName: 'HaloPress'
        }
      },
      {
        ...base(byType(document, 'menu')),
        type: 'menu' as const,
        props: {
          ...byType(document, 'menu').props,
          menu
        }
      },
      {
        ...base(byType(document, 'page-list')),
        type: 'page-list' as const,
        props: {
          ...byType(document, 'page-list').props,
          items: [{
            id: 'page-2',
            title: 'About',
            path: '/about',
            publishedAt: '2026-07-18T00:00:00.000Z'
          }]
        }
      },
      {
        ...base(byType(document, 'table-of-contents')),
        type: 'table-of-contents' as const,
        props: {
          ...byType(document, 'table-of-contents').props,
          items: [{ id: 'halo-heading-introduction', level: 2 as const, text: 'Introduction' }]
        }
      },
      {
        ...base(byType(document, 'copyright')),
        type: 'copyright' as const,
        props: {
          ...byType(document, 'copyright').props,
          text: '© 2026 HaloPress'
        }
      }
    ],
    diagnostics: []
  }
}

describe('runtime Layout rendering contract', () => {
  it('strictly discriminates disabled, built-in fallback, and ready projections', () => {
    const disabled = {
      contractVersion: 1,
      status: 'disabled',
      context,
      revision: digest,
      reason: 'site-disabled'
    }
    const fallback = {
      contractVersion: 1,
      status: 'built-in-fallback',
      context,
      revision: digest,
      reason: 'unassigned',
      diagnostics: [{ code: 'layout-unassigned', message: 'No effective Layout is assigned.' }]
    }
    const ready = createReadyProjection()

    expect(parseLayoutRenderProjection(disabled).success).toBe(true)
    expect(parseLayoutRenderProjection(fallback).success).toBe(true)
    expect(parseLayoutRenderProjection(ready).success).toBe(true)

    expect(layoutRenderProjectionSchema.safeParse({ ...disabled, diagnostics: [] }).success).toBe(false)
    expect(layoutRenderProjectionSchema.safeParse({ ...fallback, layoutId: 'stored-layout' }).success).toBe(false)
    expect(layoutRenderProjectionSchema.safeParse({ ...ready, componentName: 'LayoutRenderer' }).success).toBe(false)
    expect(layoutRenderProjectionSchema.safeParse({ ...ready, status: 'fallback' }).success).toBe(false)
  })

  it('bounds diagnostics and accepts only the finite diagnostic vocabulary', () => {
    const diagnostics = Array.from({ length: LAYOUT_RENDERING_MAX_DIAGNOSTICS }, (_, index) => ({
      code: 'element-unavailable' as const,
      elementId: `element-${index}`,
      message: `Element ${index} is unavailable.`
    }))
    const fallback = {
      contractVersion: 1,
      status: 'built-in-fallback',
      context,
      revision: digest,
      reason: 'explicit-assignment-unavailable',
      diagnostics
    }

    expect(layoutRenderProjectionSchema.safeParse(fallback).success).toBe(true)
    expect(layoutRenderProjectionSchema.safeParse({
      ...fallback,
      diagnostics: [...diagnostics, diagnostics[0]]
    }).success).toBe(false)
    expect(layoutDiagnosticSchema.safeParse({ code: 'runtime-exception', message: 'Unsafe detail' }).success).toBe(false)
    expect(layoutDiagnosticSchema.safeParse({ code: 'element-unavailable', message: 'x'.repeat(501) }).success).toBe(false)
  })

  it('keeps the resolved element union exhaustive across all seven semantic types', () => {
    const ready = createReadyProjection()
    const resolvedTypes = ready.elements.map(element => element.type)

    expect(resolvedTypes).toHaveLength(layoutElementTypes.length)
    expect(new Set(resolvedTypes)).toEqual(new Set(layoutElementTypes))
    for (const element of ready.elements) {
      expect(resolvedLayoutElementSchema.safeParse(element).success, element.type).toBe(true)
    }
    expect(resolvedLayoutElementSchema.safeParse({
      id: 'runtime-component',
      region: 'content',
      order: 0,
      type: 'vue-component',
      props: {}
    }).success).toBe(false)
  })

  it('rejects Nuxt application Layout, renderer, import, and executable vocabulary at the runtime boundary', () => {
    const ready = createReadyProjection()
    const attacks: Array<{ label: string, mutate: (candidate: any) => void }> = [
      { label: 'Nuxt application Layout selector', mutate: candidate => { candidate.document.nuxtLayout = 'default' } },
      { label: 'Desk component', mutate: candidate => { candidate.elements[0].component = 'DeskLayout' } },
      { label: 'dynamic component key', mutate: candidate => { candidate.elements[0].props.componentKey = 'PageContent' } },
      { label: 'dynamic import', mutate: candidate => { candidate.elements[0].props.importPath = '~/components/PageContent.vue' } },
      { label: 'Tailwind class', mutate: candidate => { candidate.elements[0].props.class = 'grid grid-cols-12' } },
      { label: 'Nuxt UI payload', mutate: candidate => { candidate.elements[0].props.ui = { root: 'unsafe' } } },
      { label: 'slot template', mutate: candidate => { candidate.elements[0].props.slots = { default: '<main />' } } },
      { label: 'arbitrary HTML', mutate: candidate => { candidate.elements[0].props.html = '<script>alert(1)</script>' } },
      { label: 'arbitrary CSS', mutate: candidate => { candidate.elements[0].props.css = 'body { display: none }' } },
      { label: 'arbitrary JavaScript', mutate: candidate => { candidate.elements[0].props.script = 'alert(1)' } },
      { label: 'editor canvas', mutate: candidate => { candidate.document.elements[0].component = 'LayoutCanvas' } },
      { label: 'workspace shell name', mutate: candidate => { candidate.document.name = 'SiteWorkspaceShell' } }
    ]

    for (const attack of attacks) {
      const candidate = structuredClone(ready)
      attack.mutate(candidate)
      expect(layoutRenderProjectionSchema.safeParse(candidate).success, attack.label).toBe(false)
    }
  })
})
