import { describe, expect, it } from 'vitest'

import { normalizeAuthoredDocument } from '../shared/authored-document'
import { pageBlockRegistry } from '../app/editor/page/registry'
import { normalizePageContent } from '../server/cms/page-content'
import { resolvePageBlock, validatePageDocumentBlocks } from '../shared/page-blocks'

function pageDocument(...content: Record<string, unknown>[]) {
  return { type: 'doc', content }
}

function pageBlock(component: string, attrs: Record<string, unknown> = {}) {
  return {
    type: 'pageBlock',
    attrs: {
      component,
      props: {},
      advanced: {},
      media: {},
      ...attrs
    }
  }
}

describe('page block document validation', () => {
  it('preserves unknown legacy blocks in drafts without rewriting their attributes', () => {
    const legacy = pageDocument(pageBlock('RetiredMarketingWidget', {
      props: { legacy: true, nested: { untouched: 'value' } },
      advanced: { historicalSetting: 'keep-me' },
      media: { url: '/legacy/hero.jpg', alt: 'Legacy hero' }
    }))

    expect(validatePageDocumentBlocks(legacy, { allowUnknown: true })).toEqual([])
    expect(normalizePageContent(legacy, { mode: 'draft' })).toEqual(legacy)
    expect(normalizePageContent(JSON.stringify(legacy), { mode: 'draft' })).toEqual(legacy)
  })

  it.each(['draft', 'publish'] as const)(
    'rejects malformed registered blocks during %s validation',
    (mode) => {
      const malformed = pageDocument(
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        pageBlock('pageCard', {
          props: { title: 'Unsafe card', to: 'javascript:alert(1)' }
        })
      )

      expect(validatePageDocumentBlocks(malformed, { allowUnknown: mode === 'draft' })).toEqual([{
        index: 1,
        key: 'pageCard',
        kind: 'malformed',
        message: 'Block 2 (pageCard) has invalid properties.'
      }])
      expect(() => normalizePageContent(malformed, { mode }))
        .toThrow('Block 2 (pageCard) has invalid properties.')
    }
  )

  it('rejects unknown components when validating a publishable document', () => {
    const unknown = pageDocument(pageBlock('RetiredMarketingWidget', {
      props: { legacy: true }
    }))

    expect(validatePageDocumentBlocks(unknown, { allowUnknown: false })).toEqual([{
      index: 0,
      key: 'RetiredMarketingWidget',
      kind: 'unknown',
      message: 'Block 1 uses an unsupported component (RetiredMarketingWidget).'
    }])
    expect(() => normalizePageContent(unknown, { mode: 'publish' }))
      .toThrow('Block 1 uses an unsupported component (RetiredMarketingWidget).')
  })

  it('keeps legacy media URLs available to the canonical page renderer', () => {
    const document = pageDocument(pageBlock('pageHero', {
      props: { title: 'Legacy media' },
      media: {
        url: '/assets/legacy-hero/raw?width=1200#cover',
        alt: 'Legacy hero',
        width: 1200,
        height: 630
      }
    }))

    expect(resolvePageBlock((document.content[0] as any).attrs)).toMatchObject({
      status: 'known',
      media: {
        url: '/assets/legacy-hero/raw?width=1200#cover',
        alt: 'Legacy hero',
        width: 1200,
        height: 630
      }
    })
    expect(normalizeAuthoredDocument(document, { allowPageBlocks: true }).content).toEqual([{
      type: 'pageBlock',
      anchorId: 'halo-heading-legacy-media',
      attrs: {
        component: 'pageHero',
        props: { title: 'Legacy media', description: '' },
        advanced: {},
        media: (document.content[0] as any).attrs.media
      }
    }])
  })
})

describe('page block palette metadata', () => {
  it('provides complete searchable metadata for every registered block', () => {
    expect(pageBlockRegistry.components.map(component => component.key)).toEqual([
      'pageHero',
      'pageCard',
      'pageSection',
      'pageTestimonial',
      'pageLogos',
      'pageFAQ',
      'pageCTA'
    ])

    for (const component of pageBlockRegistry.components) {
      expect(component.category).toMatch(/^(Hero|Content|Trust|FAQ|Conversion)$/)
      expect(component.icon).toMatch(/^i-lucide-[a-z0-9-]+$/)
      expect(component.summary.trim().length).toBeGreaterThan(0)
      expect(component.keywords.length).toBeGreaterThan(0)
      expect(component.keywords.every(keyword => keyword.trim().length > 0)).toBe(true)
      expect(component.compatibility).toBe('page')
      expect(component.preview.title).toBeTruthy()
      expect(component.preview.description).toBeTruthy()
      expect(component.insertion).toBe('block')

      const searchableValues = [
        component.label,
        component.summary,
        component.category,
        ...component.keywords
      ].map(value => value.toLowerCase())
      expect(searchableValues).toContain(component.category.toLowerCase())
      expect(searchableValues).toEqual(expect.arrayContaining(
        component.keywords.map(keyword => keyword.toLowerCase())
      ))
    }
  })

  it('exposes typed icon and color-token fields instead of raw text controls', () => {
    const fields = pageBlockRegistry.byKey.pageCard.fields

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'icon', type: 'icon' }),
      expect.objectContaining({ key: 'highlightColor', type: 'color-token' }),
      expect.objectContaining({ key: 'spotlightColor', type: 'color-token' })
    ]))
  })

  it('exposes typed repeatable controls for reviewed composite blocks', () => {
    expect(pageBlockRegistry.byKey.pageSection.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'features', type: 'object-list', maxItems: 6 })
    ]))
    expect(pageBlockRegistry.byKey.pageLogos.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'items', type: 'object-list', maxItems: 12 })
    ]))
    expect(pageBlockRegistry.byKey.pageFAQ.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'items', type: 'object-list', maxItems: 12 })
    ]))
  })

  it('rejects unsafe nested URLs in composite block props', () => {
    const unsafeSection = pageDocument(pageBlock('pageSection', {
      props: {
        title: 'Features',
        features: [{ title: 'Unsafe', to: 'javascript:alert(1)' }]
      }
    }))
    const unsafeLogos = pageDocument(pageBlock('pageLogos', {
      props: {
        title: 'Proof',
        items: [{ name: 'Unsafe', src: 'data:text/html;base64,WA==' }]
      }
    }))

    expect(validatePageDocumentBlocks(unsafeSection)).toEqual([
      expect.objectContaining({ key: 'pageSection', kind: 'malformed' })
    ])
    expect(validatePageDocumentBlocks(unsafeLogos)).toEqual([
      expect.objectContaining({ key: 'pageLogos', kind: 'malformed' })
    ])
  })
})
