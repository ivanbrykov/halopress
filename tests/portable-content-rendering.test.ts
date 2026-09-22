import { describe, expect, it } from 'vitest'

import {
  createPortablePageRendering,
  createPortableStandaloneDocument,
  createPortableStructuredContentRendering,
  PORTABLE_CONTENT_STYLESHEET_PATH,
  renderPortablePageDocument,
  renderPortableRichText,
  resolvePortableAssetUrl,
  resolvePortableLinkUrl,
  resolvePortablePageAssetUrl
} from '../shared/portable-content'
import {
  pageBlockColors,
  pageBlockVariants,
  resolvePageBlockForDelivery,
  validatePageDocumentBlocks
} from '../shared/page-blocks'
import { portableContentFixture } from './fixtures/portable-content'
import { defaultSiteTheme } from '../shared/site-theme'
import { buildSiteThemeArtifact } from '../server/utils/site-theme-settings'
import { createStandalonePageRendering } from '../server/utils/standalone-document-renderer'

const origin = 'https://press.example.com'

function classTokens(html: string) {
  return [...html.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1]!.split(/\s+/))
}

describe('portable authored-content renderer', () => {
  it('renders the allowlisted structural pageHero without changing legacy pageBlock heroes', () => {
    const structuralHero = {
      type: 'doc',
      content: [{
        type: 'pageHero',
        attrs: { orientation: 'horizontal', reverse: true, class: 'unchecked' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Eyebrow' }] },
          { type: 'heading', attrs: { level: 1, id: 'stored' }, content: [{ type: 'text', text: 'Native hero' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hero body' }] },
          { type: 'image', attrs: { src: '/assets/hero/raw', alt: 'Hero' } }
        ]
      }]
    }
    const rendering = createStandalonePageRendering(structuralHero, { origin })

    expect(rendering.html).toContain('<section class="halo-block halo-hero" data-halo-block="hero" data-halo-orientation="horizontal" data-halo-reverse="true"><div class="halo-block-content">')
    expect(rendering.html).toContain('<h1 id="halo-heading-native-hero">Native hero</h1>')
    expect(rendering.html).not.toContain('class="unchecked"')
    expect(rendering.outline).toContainEqual({ id: 'halo-heading-native-hero', level: 1, text: 'Native hero' })

    const temporaryUpload = structuredClone(structuralHero)
    temporaryUpload.content[0]!.content![3] = { type: 'imageUpload' } as any
    expect(createStandalonePageRendering(temporaryUpload, { origin }).html)
      .toContain('<p class="halo-content-fallback" role="status">Unsupported content</p>')
  })

  it('bounds structural pageHero validation across the whole v2 document', () => {
    const malformedHero = () => ({
      type: 'pageHero',
      content: Array.from({ length: 900 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }]
      }))
    })
    const document = {
      type: 'doc',
      content: [malformedHero(), malformedHero()]
    }
    const before = structuredClone(document)

    for (const hero of document.content) {
      const rendering = createStandalonePageRendering({ type: 'doc', content: [hero] }, { origin })
      expect(rendering.html).toContain('Unsupported content')
      expect(rendering.html).not.toContain('Content exceeds portable rendering limits')
    }

    const rendering = createStandalonePageRendering(document, { origin })
    expect(rendering.html).toContain('Content exceeds portable rendering limits')
    expect(rendering.outline).toEqual([])
    expect(document).toEqual(before)
  })

  it('keeps v2 legacy block and ordinary heading outlines aligned with the native contract', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'pageBlock',
          attrs: {
            component: 'pageSection',
            props: { title: 'Section', features: [{ title: 'Feature', description: 'Detail' }] }
          }
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Feature' }]
        }
      ]
    }
    const rendering = createStandalonePageRendering(document, { origin })

    expect(rendering.outline).toEqual([
      { id: 'halo-heading-section', level: 2, text: 'Section' },
      { id: 'halo-heading-feature-2', level: 2, text: 'Feature' }
    ])
    expect(rendering.html).toContain('<h3 class="halo-feature-title" id="halo-heading-feature">Feature</h3>')
    expect(rendering.html).toContain('<h2 id="halo-heading-feature-2">Feature</h2>')
  })

  it('does not expose v2 outline anchors when output limits replace the fragment', () => {
    const rendering = createStandalonePageRendering({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Missing anchor' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(600_000) }] }
      ]
    }, { origin })

    expect(rendering.html).toContain('Content exceeds portable rendering limits')
    expect(rendering.outline).toEqual([])
  })

  it('renders rich text and every shipped Page block as stable semantic Halo markup', () => {
    const before = JSON.stringify(portableContentFixture)
    const rendering = createPortablePageRendering(portableContentFixture, { origin })

    expect(JSON.stringify(portableContentFixture)).toBe(before)
    expect(rendering).toMatchObject({
      contractVersion: 1,
      themeRevision: 'default',
      stylesheets: [`https://press.example.com${PORTABLE_CONTENT_STYLESHEET_PATH}`]
    })
    expect(rendering.html).toContain('<article class="halo-content halo-page"')
    for (const block of ['hero', 'card', 'section', 'testimonial', 'logos', 'faq', 'cta']) {
      expect(rendering.html).toContain(`data-halo-block="${block}"`)
    }
    expect(rendering.html).toContain('<details class="halo-faq-item">')
    expect(rendering.html).toContain('<blockquote class="halo-testimonial-quote">')
    expect(rendering.html).toContain('<ul class="halo-logo-list">')
    expect(rendering.html).toContain('data-halo-highlight="true"')
    expect(rendering.html).toContain('data-halo-spotlight="true"')
    expect(rendering.html).toContain('data-halo-highlight-color="primary"')
    expect(rendering.html).toContain('data-halo-spotlight-color="primary"')
    expect(rendering.html).toContain('data-halo-reverse="true"')
    expect(rendering.html).toContain('<strong>Bold</strong>')
    expect(rendering.html).toContain('<em> italic</em>')
    expect(rendering.html).toContain('<u> underline</u>')
    expect(rendering.html).toContain('<s> strike</s>')
    expect(rendering.html).toContain('<pre class="halo-code-block"><code>&lt;script&gt;not executable&lt;/script&gt;</code></pre>')
    expect(rendering.html.match(/<svg class="halo-icon"/g)?.length).toBeGreaterThanOrEqual(6)
    expect(classTokens(rendering.html).every(token => token.startsWith('halo-'))).toBe(true)
  })

  it('escapes author text and drops unchecked HTML, attributes, classes, icons, and unsafe URLs', () => {
    const html = renderPortablePageDocument(portableContentFixture, { origin })

    expect(html).toContain('Portable &lt;content&gt;')
    expect(html).toContain('Hero &lt;title&gt;')
    expect(html).toContain('@Editor &lt;one&gt;')
    expect(html).toContain('href="https://press.example.com/docs?from=fixture#start" target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('src="https://press.example.com/assets/rich-image/raw?rev=1#preview"')
    expect(html).toContain('src="https://press.example.com/assets/hero/raw"')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/(?:class|style|id|on[a-z]+)="(?:fixed|author-id|alert)/i)
    expect(html).not.toContain('i-lucide')
    expect(html).not.toContain('UPage')
    expect(html).not.toContain('<script')
    expect(html).toContain('<span class="halo-logo-name">Text fallback</span>')
  })

  it('allocates deterministic duplicate heading IDs and ignores hostile stored IDs', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'stored-admin-anchor', class: 'fixed', onclick: 'alert(1)' },
          content: [{ type: 'text', text: 'Repeated heading' }]
        },
        {
          type: 'heading',
          attrs: { level: 3, id: 'stored-second-anchor' },
          content: [{ type: 'text', text: 'Repeated heading' }]
        }
      ]
    }

    const first = createPortablePageRendering(document, { origin })
    const second = createPortablePageRendering(structuredClone(document), { origin })

    expect(second).toEqual(first)
    expect(first.outline).toEqual([
      { id: 'halo-heading-repeated-heading', level: 2, text: 'Repeated heading' },
      { id: 'halo-heading-repeated-heading-2', level: 3, text: 'Repeated heading' }
    ])
    expect(first.html).toContain('<h2 id="halo-heading-repeated-heading">Repeated heading</h2>')
    expect(first.html).toContain('<h3 id="halo-heading-repeated-heading-2">Repeated heading</h3>')
    expect(first.html).not.toMatch(/stored-(?:admin|second)-anchor|onclick=|class="fixed"/)
  })

  it('fails closed for deeply nested and cyclic hostile heading content without recursive extraction', () => {
    const deepRoot: Record<string, any> = { type: 'paragraph', content: [] }
    let cursor = deepRoot
    for (let depth = 0; depth < 15_000; depth += 1) {
      const child: Record<string, any> = { type: 'paragraph', content: [] }
      cursor.content = [child]
      cursor = child
    }
    cursor.content = [{ type: 'text', text: 'Too deep' }]
    const cyclic: Record<string, any> = { type: 'paragraph', content: [] }
    cyclic.content = [cyclic]

    for (const content of [[deepRoot], [cyclic]]) {
      expect(() => createPortablePageRendering({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content }]
      }, { origin })).not.toThrow()
      expect(createPortablePageRendering({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content }]
      }, { origin }).html).toContain('Content exceeds portable rendering limits')
    }
  })

  it('bounds the portable outline while retaining deterministic SSR anchors', () => {
    const document = {
      type: 'doc',
      content: Array.from({ length: 140 }, () => ({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Section' }]
      }))
    }

    const rendering = createPortablePageRendering(document, { origin })

    expect(rendering.outline).toHaveLength(128)
    expect(rendering.outline[0]).toEqual({ id: 'halo-heading-section', level: 2, text: 'Section' })
    expect(rendering.outline[127]).toEqual({ id: 'halo-heading-section-128', level: 2, text: 'Section' })
    expect(rendering.html.match(/<h2 id="halo-heading-section(?:-\d+)?">/g)).toHaveLength(140)
    expect(rendering.html).toContain('<h2 id="halo-heading-section-140">Section</h2>')
  })

  it('keeps heading IDs unique across rich-text fields with colliding normalized keys', () => {
    const richText = {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 2, id: 'stored-heading' },
        content: [{ type: 'text', text: 'Overview' }]
      }]
    }
    const rendering = createPortableStructuredContentRendering({
      Body: richText,
      body: structuredClone(richText)
    }, [
      { fieldId: 'field-upper-body', key: 'Body', kind: 'richtext' },
      { fieldId: 'field-lower-body', key: 'body', kind: 'richtext' }
    ], { origin })
    const ids = rendering.outline.map(entry => entry.id)

    expect(rendering.outline).toHaveLength(2)
    expect(new Set(ids).size).toBe(ids.length)
    expect(rendering.fields.Body?.outline[0]?.id).not.toBe(rendering.fields.body?.outline[0]?.id)
    expect(rendering.fields.Body?.html).not.toContain('stored-heading')
    expect(rendering.fields.body?.html).not.toContain('stored-heading')
    for (const field of Object.values(rendering.fields)) {
      expect(classTokens(field.html).every(token => token.startsWith('halo-'))).toBe(true)
    }
  })

  it('renders every supported color and variant with finite renderer-owned icons', () => {
    for (const color of pageBlockColors) {
      const html = renderPortablePageDocument({
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: {
              title: color,
              links: [{ label: color, to: '#action', color, icon: 'i-lucide-star' }]
            }
          }
        }]
      }, { origin })
      expect(html).toContain(`data-halo-color="${color}"`)
      expect(html).toContain('<svg class="halo-icon"')
      expect(html).not.toContain('i-lucide-star')
    }

    const independentlyColoredCard = renderPortablePageDocument({
      type: 'doc',
      content: [{
        type: 'pageBlock',
        attrs: {
          component: 'pageCard',
          props: {
            title: 'Independent colors',
            highlight: true,
            highlightColor: 'secondary',
            spotlight: true,
            spotlightColor: 'error'
          }
        }
      }]
    }, { origin })
    expect(independentlyColoredCard).toContain('data-halo-highlight-color="secondary"')
    expect(independentlyColoredCard).toContain('data-halo-spotlight-color="error"')
    expect(independentlyColoredCard).not.toContain('data-halo-color=')

    const dormantColors = renderPortablePageDocument({
      type: 'doc',
      content: [{
        type: 'pageBlock',
        attrs: {
          component: 'pageCard',
          props: { title: 'Dormant colors', highlightColor: 'secondary', spotlightColor: 'error' }
        }
      }]
    }, { origin })
    expect(dormantColors).not.toContain('data-halo-highlight-color')
    expect(dormantColors).not.toContain('data-halo-spotlight-color')

    for (const variant of pageBlockVariants) {
      const html = renderPortablePageDocument({
        type: 'doc',
        content: [
          {
            type: 'pageBlock',
            attrs: {
              component: 'pageCard',
              props: { title: variant, variant, icon: 'i-lucide-book-open' }
            }
          },
          {
            type: 'pageBlock',
            attrs: {
              component: 'pageCTA',
              props: {
                title: variant,
                variant,
                links: [{ label: variant, to: '#action', variant }]
              }
            }
          }
        ]
      }, { origin })
      expect(html.match(new RegExp(`data-halo-variant="${variant}"`, 'g'))?.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps legacy blocks with unsupported icons and gives external legacy logos an explicit fallback', () => {
    const unsupportedIcon = {
      type: 'doc',
      content: [{
        type: 'pageBlock',
        attrs: { component: 'pageCard', props: { title: 'Unsafe', icon: 'i-lucide-user-authored' } }
      }]
    }
    const externalLogo = {
      type: 'doc',
      content: [{
        type: 'pageBlock',
        attrs: {
          component: 'pageLogos',
          props: { title: 'Legacy', items: [{ name: 'External logo', src: 'https://cdn.example/logo.svg' }] }
        }
      }]
    }

    const unsupportedIconHtml = renderPortablePageDocument(unsupportedIcon, { origin })
    expect(unsupportedIconHtml).toContain('data-halo-block="card"')
    expect(unsupportedIconHtml).not.toContain('data-halo-block-status="malformed"')
    expect(unsupportedIconHtml).not.toContain('i-lucide-user-authored')
    expect(validatePageDocumentBlocks(unsupportedIcon)).toEqual([
      expect.objectContaining({ key: 'pageCard', kind: 'malformed' })
    ])
    expect(validatePageDocumentBlocks(externalLogo)).toEqual([
      expect.objectContaining({ key: 'pageLogos', kind: 'malformed' })
    ])
    const legacyHtml = renderPortablePageDocument(externalLogo, { origin })
    expect(legacyHtml).not.toContain('https://cdn.example/logo.svg')
    expect(legacyHtml).toContain('data-halo-asset-status="unavailable"')
    expect(legacyHtml).toContain('External logo')
  })

  it('uses distinct link and trusted-origin media policies', () => {
    expect(resolvePortableLinkUrl('/relative', origin)).toBe('https://press.example.com/relative')
    expect(resolvePortableLinkUrl('#fragment', origin)).toBe('#fragment')
    expect(resolvePortableLinkUrl('mailto:hello@example.com', origin)).toBe('mailto:hello@example.com')
    expect(resolvePortableLinkUrl('https://other.example/path', origin)).toBe('https://other.example/path')
    expect(resolvePortableLinkUrl('https://user:pass@other.example/path', origin)).toBeNull()
    expect(resolvePortableLinkUrl('//other.example/path', origin)).toBeNull()
    expect(resolvePortableLinkUrl('java\nscript:alert(1)', origin)).toBeNull()
    expect(resolvePortableLinkUrl('https:\\other.example\\obfuscated', origin)).toBeNull()

    expect(resolvePortableAssetUrl('/assets/image/raw', origin)).toBe('https://press.example.com/assets/image/raw')
    expect(resolvePortableAssetUrl('https://press.example.com/assets/image/raw', origin)).toBe('https://press.example.com/assets/image/raw')
    expect(resolvePortableAssetUrl('https://other.example/image.png', origin)).toBeNull()
    expect(resolvePortableAssetUrl('https://user:pass@press.example.com/image.png', origin)).toBeNull()
    expect(resolvePortableAssetUrl('//other.example/image.png', origin)).toBeNull()
    expect(resolvePortableAssetUrl('data:image/png;base64,AAAA', origin)).toBeNull()
    expect(resolvePortableAssetUrl('mailto:image@example.com', origin)).toBeNull()
    expect(resolvePortableAssetUrl('https:\\press.example.com\\assets\\image\\raw', origin)).toBeNull()

    expect(resolvePortablePageAssetUrl('/assets/image/raw', origin)).toBe('https://press.example.com/assets/image/raw')
    expect(resolvePortablePageAssetUrl('https://press.example.com/api/private/image', origin)).toBeNull()

    const historicalPrivateMedia = renderPortablePageDocument({
      type: 'doc',
      content: [{
        type: 'pageBlock',
        attrs: { component: 'pageHero', props: { title: 'Legacy' }, media: { url: '/api/private/image' } }
      }]
    }, { origin })
    expect(historicalPrivateMedia).toContain('data-halo-block="hero"')
    expect(historicalPrivateMedia).toContain('Media unavailable')
    expect(historicalPrivateMedia).not.toContain('src="https://press.example.com/api/private/image"')
  })

  it('keeps retired and malformed raw blocks but renders deterministic visible fallbacks', () => {
    const raw = {
      type: 'doc',
      customDocumentKey: { preserve: true },
      content: [
        { type: 'pageBlock', attrs: { component: 'RetiredBlock', props: { legacy: true }, custom: 'preserve' } },
        { type: 'pageBlock', attrs: { component: 'pageCard', props: { title: 'Unsafe', to: 'javascript:alert(1)' } } },
        { type: 'unsupportedNode', attrs: { class: 'fixed' } }
      ]
    }
    const before = structuredClone(raw)
    const html = renderPortablePageDocument(raw, { origin })

    expect(raw).toEqual(before)
    expect(html.match(/class="halo-block halo-block-fallback"/g)).toHaveLength(2)
    expect(html).toContain('data-halo-block-status="unknown"')
    expect(html).toContain('data-halo-block-status="malformed"')
    expect(html).toContain('<p class="halo-content-fallback" role="status">Unsupported content</p>')
  })

  it('renders deterministic fallbacks for non-object Page block attributes', () => {
    const malformedAttrs = [null, [], 'attrs', 42]
    for (const attrs of malformedAttrs) {
      expect(resolvePageBlockForDelivery(attrs)).toEqual({
        status: 'unknown',
        key: '',
        reason: 'Unsupported page block'
      })
    }

    const html = renderPortablePageDocument({
      type: 'doc',
      content: malformedAttrs.map(attrs => ({ type: 'pageBlock', attrs }))
    }, { origin })
    expect(html.match(/data-halo-block-status="unknown"/g)).toHaveLength(malformedAttrs.length)
  })

  it('bounds recursive depth, node count, and serialized output', () => {
    let nested: any = { type: 'text', text: 'deep' }
    for (let index = 0; index < 40; index += 1) nested = { type: 'blockquote', content: [nested] }
    const deep = { type: 'doc', content: [nested] }
    const many = { type: 'doc', content: Array.from({ length: 10 }, () => ({ type: 'paragraph' })) }
    const large = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(2_000) }] }] }

    expect(renderPortableRichText(deep, { origin, limits: { maxDepth: 8 } })).toContain('Content exceeds portable rendering limits')
    expect(renderPortableRichText(many, { origin, limits: { maxNodes: 5 } })).toContain('Content exceeds portable rendering limits')
    expect(renderPortableRichText(large, { origin, limits: { maxOutputLength: 512 } })).toContain('Content exceeds portable rendering limits')
    expect(renderPortableRichText(large, { origin, limits: { maxOutputLength: 1 } }).length).toBeLessThanOrEqual(1)
  })

  it('bounds page-block collections before schema parsing', () => {
    const links = Array.from({ length: 100_000 }, () => ({ label: 'x', to: '#x' }))
    const html = renderPortablePageDocument({
      type: 'doc',
      content: [{ type: 'pageBlock', attrs: { component: 'pageHero', props: { title: 'Hostile', links } } }]
    }, { origin, limits: { maxNodes: 2 } })

    expect(html).toContain('data-halo-block-status="malformed"')
    expect(html.length).toBeLessThan(1_000)
  })

  it('charges hostile mark arrays before allocating nested wrappers', () => {
    const unknownMarks = Array.from({ length: 10_000 }, (_, index) => ({ type: `unknown-${index}` }))
    const supportedMarks = Array.from({ length: 10_000 }, () => ({ type: 'bold' }))
    const document = (marks: unknown[]) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bounded', marks }] }]
    })

    expect(renderPortableRichText(document(unknownMarks), { origin, limits: { maxMarks: 32 } }))
      .toContain('Content exceeds portable rendering limits')
    expect(renderPortableRichText(document(supportedMarks), { origin, limits: { maxMarks: 32 } }))
      .toContain('Content exceeds portable rendering limits')
  })

  it('projects only schema-declared rich-text fields while preserving the structured JSON', () => {
    const content = {
      title: 'Raw title',
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<portable>' }] }] },
      legacyBody: '<b>plain legacy text</b>'
    }
    const before = structuredClone(content)
    const rendering = createPortableStructuredContentRendering(content, [
      { fieldId: 'title-id', key: 'title', kind: 'string' },
      { fieldId: 'body-id', key: 'body', kind: 'richtext' },
      { fieldId: 'legacy-id', key: 'legacyBody', kind: 'richtext' }
    ], { origin })

    expect(content).toEqual(before)
    expect(Object.keys(rendering.fields)).toEqual(['body', 'legacyBody'])
    expect(rendering.fields.body).toMatchObject({ fieldId: 'body-id', fieldKey: 'body' })
    expect(rendering.fields.body!.html).toContain('&lt;portable&gt;')
    expect(rendering.fields.legacyBody!.html).toContain('&lt;b&gt;plain legacy text&lt;/b&gt;')
    expect(rendering.fields.legacyBody!.html).not.toContain('<b>')
    expect(rendering).not.toHaveProperty('html')
  })

  it('shares field, node, mark, and output budgets across a structured projection', () => {
    const manyFields = Array.from({ length: 300 }, (_, index) => ({
      fieldId: `field-${index}`,
      key: `body${index}`,
      kind: 'richtext'
    }))
    const content = Object.fromEntries(manyFields.map(field => [field.key, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(200) }] }]
    }]))
    const rendering = createPortableStructuredContentRendering(content, manyFields, {
      origin,
      limits: { maxFields: 20, maxNodes: 30, maxOutputLength: 2_000 }
    })

    expect(rendering.truncated).toBe(true)
    expect(Object.keys(rendering.fields).length).toBeLessThanOrEqual(20)
    expect(JSON.stringify(rendering).length).toBeLessThan(4_000)
  })

  it('marks a structured projection truncated when its shared budget cannot fit the fallback', () => {
    const rendering = createPortableStructuredContentRendering({
      b: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bounded' }] }] }
    }, [
      { fieldId: 'f', key: 'b', kind: 'richtext' }
    ], {
      origin,
      limits: { maxOutputLength: 200 }
    })

    expect(rendering.fields.b).toMatchObject({ fieldId: 'f', fieldKey: 'b', html: '' })
    expect(rendering.truncated).toBe(true)
  })

  it('counts projected rich-text fields separately from the bounded schema scan', () => {
    const scalarFields = Array.from({ length: 256 }, (_, index) => ({
      fieldId: `scalar-${index}`,
      key: `scalar${index}`,
      kind: 'string'
    }))
    const body = { fieldId: 'body-id', key: 'body', kind: 'richtext' }
    const content = {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Projected body' }] }] }
    }

    const rendering = createPortableStructuredContentRendering(content, [...scalarFields, body], {
      origin,
      limits: { maxFields: 1, maxSchemaFields: 300 }
    })
    expect(rendering.fields.body?.html).toContain('Projected body')
    expect(rendering.truncated).toBeUndefined()

    const scanLimited = createPortableStructuredContentRendering(content, [...scalarFields, body], {
      origin,
      limits: { maxFields: 1, maxSchemaFields: 256 }
    })
    expect(scanLimited.fields.body).toBeUndefined()
    expect(scanLimited.truncated).toBe(true)
  })

  it('skips malformed runtime schema entries without dereferencing or rendering them', () => {
    const content = {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safe body' }] }] }
    }
    const malformedFields = [
      null,
      [],
      42,
      { fieldId: '', key: 'body', kind: 'richtext' },
      { fieldId: 'field-id', key: '__proto__', kind: 'richtext' },
      { fieldId: 'x'.repeat(257), key: 'body', kind: 'richtext' },
      { fieldId: 'field-id', key: 'body', kind: 'R'.repeat(65) },
      { fieldId: 'body-id', key: 'body', kind: 'richtext' }
    ]

    const rendering = createPortableStructuredContentRendering(
      content,
      malformedFields as any,
      { origin }
    )
    expect(Object.keys(rendering.fields)).toEqual(['body'])
    expect(rendering.fields.body?.html).toContain('Safe body')
    expect(rendering.truncated).toBe(true)

    const invalidRegistry = createPortableStructuredContentRendering(content, null as any, { origin })
    expect(Object.keys(invalidRegistry.fields)).toEqual([])
    expect(invalidRegistry.truncated).toBe(true)
  })

  it('preserves block order, feature orientation, and CTA defaults without invented copy', () => {
    const html = renderPortablePageDocument({
      type: 'doc',
      content: [
        {
          type: 'pageBlock',
          attrs: {
            component: 'pageCard',
            props: { title: 'Linked card', to: '#card', reverse: true },
            media: { url: '/assets/card/raw', alt: 'Card' }
          }
        },
        {
          type: 'pageBlock',
          attrs: {
            component: 'pageSection',
            props: { title: 'Features', features: [{ title: 'Horizontal by default' }, { title: 'Vertical', orientation: 'vertical' }] }
          }
        },
        { type: 'pageBlock', attrs: { component: 'pageCTA', props: { title: 'Default CTA' } } }
      ]
    }, { origin })

    expect(html).toContain('<a class="halo-card-anchor" href="#card">')
    expect(html).not.toContain('Learn more')
    expect(html.indexOf('halo-block-content')).toBeLessThan(html.indexOf('src="https://press.example.com/assets/card/raw"'))
    expect(html).toContain('class="halo-feature" data-halo-orientation="horizontal"')
    expect(html).toContain('class="halo-feature" data-halo-orientation="vertical"')
    expect(html).toContain('class="halo-block halo-cta" data-halo-block="cta" data-halo-orientation="vertical" data-halo-variant="outline"')
  })

  it('builds a scriptless standalone document from only the envelope and stylesheet', () => {
    const rendering = createPortablePageRendering(portableContentFixture, { origin })
    const standalone = createPortableStandaloneDocument(rendering, { colorMode: 'dark' })

    expect(standalone).toMatch(/^<!doctype html>/)
    expect(standalone).toContain(`<link rel="stylesheet" href="https://press.example.com${PORTABLE_CONTENT_STYLESHEET_PATH}">`)
    expect(standalone).toContain('data-halo-color-mode="dark"')
    expect(standalone).not.toContain('<script')
    expect(standalone).not.toContain('_nuxt')
    expect(standalone).not.toContain('tailwind')
  })

  it('preserves the exact ordered Theme artifact and stored color mode across raw and standalone rendering', () => {
    const artifact = buildSiteThemeArtifact({ ...defaultSiteTheme(), colorMode: 'dark' })
    const theme = {
      revision: artifact.revision,
      stylesheetRevision: artifact.stylesheetRevision,
      stylesheetUrl: `${origin}${artifact.stylesheetPath}`,
      colorMode: 'dark' as const
    }
    const rendering = createPortablePageRendering(portableContentFixture, { origin, theme })
    expect(rendering.stylesheets).toEqual([
      `${origin}${PORTABLE_CONTENT_STYLESHEET_PATH}`,
      theme.stylesheetUrl
    ])
    expect(rendering.themeRevision).toBe(theme.revision)
    expect(rendering.themeColorMode).toBe('dark')
    expect(rendering.html).toContain('data-halo-color-mode="dark"')
    const standalone = createPortableStandaloneDocument(rendering)
    expect(standalone.indexOf(rendering.stylesheets[0]!)).toBeLessThan(standalone.indexOf(rendering.stylesheets[1]!))
    expect(standalone).toContain('data-halo-color-mode="dark"')

    const olderEnvelope = { ...rendering, themeColorMode: undefined }
    expect(createPortableStandaloneDocument(olderEnvelope)).toContain('data-halo-color-mode="default"')
  })

  it('fails invalid Theme descriptors back to the documented v1 base rendering', () => {
    const artifact = buildSiteThemeArtifact(defaultSiteTheme())
    const rendering = createPortablePageRendering(portableContentFixture, {
      origin,
      theme: {
        revision: artifact.revision,
        stylesheetRevision: artifact.stylesheetRevision,
        stylesheetUrl: `https://evil.example${artifact.stylesheetPath}`,
        colorMode: 'system'
      }
    })
    expect(rendering).toMatchObject({
      themeRevision: 'default',
      themeColorMode: 'system',
      stylesheets: [`${origin}${PORTABLE_CONTENT_STYLESHEET_PATH}`]
    })
  })
})
