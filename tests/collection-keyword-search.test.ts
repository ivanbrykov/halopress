import { describe, expect, it } from 'vitest'

import {
  collectionKeywordFilterFields,
  collectionKeywordFilters
} from '../shared/collection-keyword-search'

const fields = [
  {
    fieldId: 'field-category',
    key: 'category',
    kind: 'enum',
    enumValues: [{ value: 'news' }, { value: 'guide' }],
    search: { mode: 'exact_set' as const, filterable: true }
  },
  {
    fieldId: 'field-year',
    key: 'year',
    kind: 'integer',
    search: { mode: 'range' as const, filterable: true }
  },
  {
    fieldId: 'field-featured',
    key: 'featured',
    kind: 'boolean',
    search: { mode: 'exact' as const, filterable: true }
  },
  {
    fieldId: 'field-hidden',
    key: 'hidden',
    kind: 'string',
    search: { mode: 'exact' as const, filterable: false }
  }
]

describe('collection keyword URL filters', () => {
  it('maps only published filterable field keys to stable field IDs', () => {
    expect(collectionKeywordFilterFields(fields).map(field => field.key))
      .toEqual(['category', 'year', 'featured'])
    expect(collectionKeywordFilters(fields, {
      q: '학교',
      category: 'news,guide',
      year: '2024..2026',
      featured: 'true',
      hidden: 'secret',
      unknown: 'ignored'
    })).toEqual([
      { fieldId: 'field-category', op: 'exact_set', values: ['news', 'guide'] },
      { fieldId: 'field-year', op: 'range', min: 2024, max: 2026 },
      { fieldId: 'field-featured', op: 'exact', value: 1 }
    ])
  })

  it('treats one range value as an exact bound and drops invalid values', () => {
    expect(collectionKeywordFilters(fields, {
      category: 'not-allowed',
      year: '2026',
      featured: 'maybe'
    })).toEqual([
      { fieldId: 'field-year', op: 'range', min: 2026, max: 2026 }
    ])
  })
})
