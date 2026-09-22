import { describe, expect, it } from 'vitest'

import {
  derivePublicSeoTitle,
  PUBLIC_SEO_TITLE_MAX_LENGTH,
  SAFE_STRUCTURED_DATA_TYPES,
  normalizePublicSeoOverrides,
  parsePublicSeoJson
} from '../shared/public-seo'

describe('public SEO overrides', () => {
  it('derives a safe SEO title from the visible page title', () => {
    expect(derivePublicSeoTitle('  Visible page title  ')).toBe('Visible page title')
    expect(derivePublicSeoTitle('   ')).toBeUndefined()
    expect(derivePublicSeoTitle('t'.repeat(PUBLIC_SEO_TITLE_MAX_LENGTH + 20)))
      .toBe('t'.repeat(PUBLIC_SEO_TITLE_MAX_LENGTH))
  })

  it('exposes only the structured-data types supported by public rendering', () => {
    expect(SAFE_STRUCTURED_DATA_TYPES).toEqual([
      'WebPage',
      'Article',
      'BlogPosting',
      'NewsArticle',
      'Product'
    ])

    for (const structuredDataType of SAFE_STRUCTURED_DATA_TYPES) {
      expect(normalizePublicSeoOverrides({ structuredDataType })).toEqual({ structuredDataType })
    }

    expect(() => normalizePublicSeoOverrides({ structuredDataType: 'Event' })).toThrow()
    expect(() => normalizePublicSeoOverrides({ structuredDataType: 'script' })).toThrow()
  })

  it('trims supported fields and collapses blank text overrides', () => {
    expect(normalizePublicSeoOverrides({
      title: '  Canonical title  ',
      description: '  Canonical description  ',
      imageAssetId: '  asset-1  '
    })).toEqual({
      title: 'Canonical title',
      description: 'Canonical description',
      imageAssetId: 'asset-1'
    })

    expect(normalizePublicSeoOverrides({
      title: '   ',
      description: '\n\t'
    })).toBeNull()
    expect(normalizePublicSeoOverrides(null)).toBeNull()
    expect(normalizePublicSeoOverrides(undefined)).toBeNull()
  })

  it('enforces metadata length limits after trimming', () => {
    expect(normalizePublicSeoOverrides({
      title: ` ${'t'.repeat(120)} `,
      description: ` ${'d'.repeat(320)} `,
      imageAssetId: ` ${'a'.repeat(128)} `
    })).toEqual({
      title: 't'.repeat(120),
      description: 'd'.repeat(320),
      imageAssetId: 'a'.repeat(128)
    })

    expect(() => normalizePublicSeoOverrides({ title: 't'.repeat(121) })).toThrow()
    expect(() => normalizePublicSeoOverrides({ description: 'd'.repeat(321) })).toThrow()
    expect(() => normalizePublicSeoOverrides({ imageAssetId: 'a'.repeat(129) })).toThrow()
  })

  it('rejects malformed or unknown write-time override fields', () => {
    expect(() => normalizePublicSeoOverrides('not-an-object')).toThrow()
    expect(() => normalizePublicSeoOverrides({ title: 42 })).toThrow()
    expect(() => normalizePublicSeoOverrides({ canonical: 'https://example.com/unsafe' })).toThrow()
    expect(() => normalizePublicSeoOverrides({ arbitraryJsonLd: { '@type': 'Event' } })).toThrow()
  })

  it('fails closed when persisted SEO JSON is missing, malformed, or unsafe', () => {
    expect(parsePublicSeoJson(null)).toBeNull()
    expect(parsePublicSeoJson('')).toBeNull()
    expect(parsePublicSeoJson('{not-json')).toBeNull()
    expect(parsePublicSeoJson(JSON.stringify({ structuredDataType: 'Event' }))).toBeNull()
    expect(parsePublicSeoJson(JSON.stringify({ title: 'Allowed', extra: true }))).toBeNull()
  })

  it('returns valid persisted overrides without inventing fallback values', () => {
    expect(parsePublicSeoJson(JSON.stringify({
      title: 'Published title',
      description: 'Published description',
      imageAssetId: null,
      structuredDataType: 'Article'
    }))).toEqual({
      title: 'Published title',
      description: 'Published description',
      imageAssetId: null,
      structuredDataType: 'Article'
    })

    expect(parsePublicSeoJson('{}')).toEqual({})
  })
})
