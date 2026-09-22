import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatPresentationDate,
  isRichTextPresentationField,
  reservedPresentationFieldIds,
  safePresentationLink
} from '../app/utils/schema-presentation'
import { normalizeAuthoredDocument } from '../shared/authored-document'

const root = resolve(import.meta.dirname, '..')

describe('public presentation UI contracts', () => {
  it('does not expose diagnostic pre output and shares the renderer with preview', async () => {
    const [detail, preview] = await Promise.all([
      readFile(resolve(root, 'app/pages/[schema]/[id].vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/_preview/content/[schemaKey]/[id].vue'), 'utf8')
    ])
    expect(detail).toContain('PublicContentDetailRenderer')
    expect(preview).toContain('PublicContentDetailRenderer')
    expect(detail).not.toContain('<pre')
    expect(preview).not.toContain('<pre')
  })

  it('guards public data loading after alias redirects', async () => {
    const sources = await Promise.all([
      readFile(resolve(root, 'app/pages/[...path].vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/[schema]/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/pages/[schema]/[id].vue'), 'utf8')
    ])
    for (const source of sources) {
      expect(source).toMatch(/const isAlias = [^\n]+routeKind === 'alias'/)
      expect(source).toMatch(/if \(isAlias\) {[\s\S]*?await navigateTo\(/)
      expect(source).toMatch(/if \(!isAlias(?: &&|\))[\s\S]*?useFetch/)
    }
  })

  it('renders zero, one, and many galleries with keyboard, live status, SSR figures, and reduced motion', async () => {
    const gallery = await readFile(resolve(root, 'app/components/public/AssetGallery.vue'), 'utf8')
    expect(gallery).toContain('items.length === 0')
    expect(gallery).toContain('items.length === 1')
    expect(gallery).toContain('<figure')
    expect(gallery).toContain('event.key === \'ArrowLeft\'')
    expect(gallery).toContain('event.key === \'ArrowRight\'')
    expect(gallery).toContain('aria-live="polite"')
    expect(gallery).toContain('prefers-reduced-motion: reduce')
    expect(gallery).not.toContain('autoplay')
  })

  it('provides accessible ordered authoring and per-item metadata', async () => {
    const picker = await readFile(resolve(root, 'app/components/cms/AssetListPicker.vue'), 'utf8')
    expect(picker).toContain('<ol')
    expect(picker).toContain('Move asset ${index + 1} up')
    expect(picker).toContain('Move asset ${index + 1} down')
    expect(picker).toContain('Remove asset ${index + 1}')
    expect(picker).toContain('Alt text for asset')
    expect(picker).toContain('Caption for asset')
  })

  it('keeps SSR formatting deterministic and allows only safe absolute or relative links', () => {
    expect(formatPresentationDate('2026-07-14T05:00:00.000Z', false, 'en')).toBe('Jul 14, 2026')
    expect(formatPresentationDate('2026-07-14', false, 'en')).toBe('Jul 14, 2026')
    expect(formatPresentationDate('2026-07-14T00:30', true, 'en')).toBe('Jul 14, 2026, 12:30 AM')
    expect(safePresentationLink('/about')).toBe('/about')
    expect(safePresentationLink('#contact')).toBe('#contact')
    expect(safePresentationLink('?page=2')).toBe('?page=2')
    expect(safePresentationLink('https://example.com/path')).toBe('https://example.com/path')
    expect(safePresentationLink('javascript:alert(1)')).toBeNull()
  })

  it('deduplicates legacy fallback slots before schemas are republished', async () => {
    const { resolveSchemaPresentation } = await import('../app/utils/schema-presentation')
    const presentation = resolveSchemaPresentation({
      fields: [
        { fieldId: 'title-id', key: 'title', kind: 'string' },
        { fieldId: 'cover-id', key: 'cover', kind: 'asset' }
      ]
    })
    expect(presentation.slots.title).toEqual({ fieldId: 'title-id', fieldKey: 'title' })
    expect(presentation.slots.description).toBeUndefined()
    expect(presentation.slots.image).toEqual({ fieldId: 'cover-id', fieldKey: 'cover' })
    expect(presentation.slots.gallery).toBeUndefined()
  })

  it('leaves price fields available to non-catalog detail templates', () => {
    const slots = { price: { fieldId: 'price-id', fieldKey: 'price' } }
    expect(reservedPresentationFieldIds({ detailTemplate: 'document', slots })).not.toContain('price-id')
    expect(reservedPresentationFieldIds({ detailTemplate: 'article', slots })).not.toContain('price-id')
    expect(reservedPresentationFieldIds({ detailTemplate: 'catalog', slots })).toContain('price-id')
  })

  it('routes rich-text description slots through the native renderer with marks and media intact', async () => {
    const field = {
      fieldId: 'summary-id',
      fieldKey: 'summary',
      kind: 'richtext',
      renderer: 'long_text'
    }
    const content = {
      summary: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Portable summary', marks: [{ type: 'bold' }] },
            { type: 'image', attrs: { src: '/assets/summary-image/raw', alt: 'Summary media' } }
          ]
        }]
      }
    }
    const normalized = normalizeAuthoredDocument(content.summary)
    const [component, fieldRenderer] = await Promise.all([
      readFile(resolve(root, 'app/components/public/ContentDetailRenderer.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/public/FieldRenderer.vue'), 'utf8')
    ])

    expect(isRichTextPresentationField(field)).toBe(true)
    expect(normalized.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Portable summary', marks: [{ type: 'bold' }] },
        { type: 'image', src: '/assets/summary-image/raw', alt: 'Summary media' }
      ]
    })
    expect(component).toContain('v-if="richTextDescription && descriptionField')
    expect(component).toContain('renderer: \'rich_text\'')
    expect(component).toContain('<PublicFieldRenderer')
    expect(fieldRenderer).toContain('import SiteRichTextRenderer from \'~/components/site-document/SiteRichTextRenderer.vue\'')
    expect(fieldRenderer).toContain('<SiteRichTextRenderer')
    expect(fieldRenderer).not.toContain('portable-content')
  })

  it('clears dynamic gallery refs when Vue unmounts a slide', async () => {
    const gallery = await readFile(resolve(root, 'app/components/public/AssetGallery.vue'), 'utf8')
    expect(gallery).toContain('Array<HTMLElement | undefined>')
    expect(gallery).toContain(': undefined')
  })
})
