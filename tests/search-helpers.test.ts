import { describe, expect, it } from 'vitest'
import {
  buildSearchDataRecord,
  coerceSearchValue,
  normalizeSearchConfig,
  normalizeSearchMode,
  searchDataTypeForKind
} from '../server/cms/search-helpers'

describe('searchDataTypeForKind', () => {
  it('maps field kinds to supported query data types', () => {
    expect(searchDataTypeForKind('string')).toBe('text')
    expect(searchDataTypeForKind('integer')).toBe('integer')
    expect(searchDataTypeForKind('number')).toBe('float')
    expect(searchDataTypeForKind('date')).toBe('date')
    expect(searchDataTypeForKind('asset')).toBeNull()
  })
})

describe('normalizeSearchMode', () => {
  it('drops unsupported modes for a field kind', () => {
    expect(normalizeSearchMode('number', 'exact')).toBe('exact')
    expect(normalizeSearchMode('number', 'exact_set')).toBe('off')
    expect(normalizeSearchMode('richtext', 'exact')).toBe('off')
  })
})

describe('normalizeSearchConfig', () => {
  it('enables filterable and sortable only when the field kind and mode allow it', () => {
    expect(normalizeSearchConfig({
      fieldId: '1',
      key: 'price',
      kind: 'number',
      search: { mode: 'range', filterable: true, sortable: true }
    })).toEqual({
      mode: 'range',
      filterable: true,
      sortable: true,
      fullText: false
    })

    expect(normalizeSearchConfig({
      fieldId: '2',
      key: 'cover',
      kind: 'asset',
      search: { mode: 'exact', filterable: true, sortable: true }
    })).toEqual({
      mode: 'off',
      filterable: false,
      sortable: false,
      fullText: false
    })

    expect(normalizeSearchConfig({
      fieldId: '3',
      key: 'body',
      kind: 'richtext',
      search: { mode: 'off', fullText: true }
    })).toEqual({
      mode: 'off',
      filterable: false,
      sortable: false,
      fullText: true
    })
  })
})

describe('coerceSearchValue', () => {
  it('coerces primitive values into queryable shapes', () => {
    expect(coerceSearchValue({ kind: 'number' }, '12.5')).toBe(12.5)
    expect(coerceSearchValue({ kind: 'integer' }, '12.9')).toBe(12)
    expect(coerceSearchValue({ kind: 'boolean' }, true)).toBe(1)
    expect(coerceSearchValue({ kind: 'date' }, '2025-01-01')).toBeTypeOf('number')
    expect(coerceSearchValue({ kind: 'datetime' }, 1735689600000)).toBe(1735689600000)
    expect(coerceSearchValue({ kind: 'datetime' }, '1735689600000')).toBe(1735689600000)
  })

  it('accepts only configured enum values', () => {
    expect(coerceSearchValue({
      kind: 'enum',
      enumValues: [{ label: 'Draft', value: 'draft' }]
    }, 'draft')).toBe('draft')

    expect(coerceSearchValue({
      kind: 'enum',
      enumValues: [{ label: 'Draft', value: 'draft' }]
    }, 'published')).toBeNull()
  })

  it('renders the aligned server-side Tiptap extension cohort', () => {
    const html = coerceSearchValue({ kind: 'richtext' }, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'mention', attrs: { id: 'editor', label: 'Editor' } }
          ]
        },
        { type: 'horizontalRule' },
        {
          type: 'image',
          attrs: {
            src: '/assets/cover.png',
            alt: 'Cover',
            title: null
          }
        }
      ]
    })

    expect(html).toContain('text-align: center')
    expect(html).toContain('data-type="mention"')
    expect(html).toContain('data-id="editor"')
    expect(html).toContain('<hr>')
    expect(html).toContain('src="/assets/cover.png"')
  })
})

describe('buildSearchDataRecord', () => {
  it('coerces stored content values into search response values', () => {
    expect(buildSearchDataRecord([
      { key: 'featured', kind: 'boolean' },
      { key: 'publishedAt', kind: 'datetime' },
      { key: 'headline', kind: 'string' }
    ], {
      featured: true,
      publishedAt: '2025-01-01T00:00:00.000Z',
      headline: 'Hello'
    })).toEqual({
      featured: 1,
      publishedAt: 1735689600000,
      headline: 'Hello'
    })
  })
})
