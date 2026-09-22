import { describe, expect, it } from 'vitest'
import { buildContentSearchIndexValues } from '../server/cms/search-index'
import type { SchemaRegistry } from '../server/cms/types'

function registry(fields: SchemaRegistry['fields']): SchemaRegistry {
  return {
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    fields,
    relations: []
  }
}

describe('buildContentSearchIndexValues', () => {
  it('materializes enabled fields with stable field ids', () => {
    const values = buildContentSearchIndexValues({
      registry: registry([
        { fieldId: 'f_title', key: 'title', kind: 'string', search: { mode: 'exact', filterable: true, sortable: true } },
        { fieldId: 'f_score', key: 'score', kind: 'number', search: { mode: 'range', filterable: true, sortable: true } },
        { fieldId: 'f_body', key: 'body', kind: 'richtext', search: { mode: 'exact', filterable: true } }
      ]),
      content: {
        title: 'Hello',
        score: '12.5',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ignored' }] }] }
      }
    })

    expect(values).toEqual([
      { fieldId: 'f_title', fieldKey: 'title', dataType: 'text', value: 'Hello' },
      { fieldId: 'f_score', fieldKey: 'score', dataType: 'float', value: 12.5 }
    ])
  })

  it('removes blank or unsupported values from the materialized set', () => {
    const values = buildContentSearchIndexValues({
      registry: registry([
        { fieldId: 'f_title', key: 'title', kind: 'string', search: { mode: 'exact', filterable: true } },
        { fieldId: 'f_cover', key: 'cover', kind: 'asset', search: { mode: 'exact', filterable: true } }
      ]),
      content: {
        title: ' ',
        cover: 'asset_1'
      }
    })

    expect(values).toEqual([])
  })
})
