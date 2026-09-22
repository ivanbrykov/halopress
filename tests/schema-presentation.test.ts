import { describe, expect, it } from 'vitest'
import { compileSchemaAst } from '../server/cms/compiler'
import { coerceValue } from '../server/cms/migrate'
import { schemaAstSchema } from '../server/cms/zod'
import type { SchemaAst } from '../server/cms/types'

const fields: SchemaAst['fields'] = [
  { id: 'title-id', key: 'title', kind: 'string', title: 'Title' },
  { id: 'body-id', key: 'body', kind: 'richtext', title: 'Body' },
  { id: 'gallery-id', key: 'gallery', kind: 'asset_list', title: 'Gallery', required: true, assetList: { minItems: 2, maxItems: 5 } },
  { id: 'price-id', key: 'price', kind: 'number', title: 'Price' }
]

describe('versioned schema presentation', () => {
  it('compiles Article bindings by stable field ID into version-specific field keys', () => {
    const ast: SchemaAst = {
      schemaKey: 'article',
      title: 'Article',
      fields,
      presentation: {
        contractVersion: 1,
        preset: 'article',
        collectionTemplate: 'cards',
        detailTemplate: 'article',
        slugFieldId: 'title-id',
        structuredDataType: 'NewsArticle',
        slots: { title: 'title-id', body: 'body-id', gallery: 'gallery-id' }
      }
    }
    const compiled = compileSchemaAst(ast, 7)
    expect(compiled.registry.presentation).toMatchObject({
      contractVersion: 1,
      schemaVersion: 7,
      preset: 'article',
      collectionTemplate: 'cards',
      detailTemplate: 'article',
      slugFieldId: 'title-id',
      slugField: { fieldId: 'title-id', fieldKey: 'title' },
      structuredDataType: 'NewsArticle',
      slots: {
        title: { fieldId: 'title-id', fieldKey: 'title' },
        body: { fieldId: 'body-id', fieldKey: 'body' },
        gallery: { fieldId: 'gallery-id', fieldKey: 'gallery' }
      }
    })
    expect(compiled.registry.presentation?.fields.find(field => field.fieldId === 'gallery-id'))
      .toMatchObject({ renderer: 'asset_gallery', kind: 'asset_list' })
  })

  it('provides a deterministic generic fallback for existing schemas', () => {
    const compiled = compileSchemaAst({ schemaKey: 'legacy', title: 'Legacy', fields }, 1)
    expect(compiled.registry.presentation).toMatchObject({
      preset: 'generic',
      collectionTemplate: 'list',
      detailTemplate: 'document',
      slots: {
        title: { fieldId: 'title-id', fieldKey: 'title' },
        body: { fieldId: 'body-id', fieldKey: 'body' },
        gallery: { fieldId: 'gallery-id', fieldKey: 'gallery' },
        price: { fieldId: 'price-id', fieldKey: 'price' }
      }
    })
    expect(compiled.registry.presentation?.slots.description).toBeUndefined()
    expect(compiled.registry.presentation?.slots.image).toBeUndefined()
    expect(new Set(Object.values(compiled.registry.presentation!.slots).map(binding => binding.fieldId)).size)
      .toBe(Object.keys(compiled.registry.presentation!.slots).length)
  })

  it('rejects stale and incompatible field bindings before publication', () => {
    const base: SchemaAst = {
      schemaKey: 'catalog',
      title: 'Catalog',
      fields,
      presentation: {
        contractVersion: 1,
        preset: 'catalog',
        collectionTemplate: 'catalog-grid',
        detailTemplate: 'catalog',
        slots: { title: 'missing' }
      }
    }
    expect(() => compileSchemaAst(base, 1)).toThrow('missing field')
    expect(() => compileSchemaAst({
      ...base,
      presentation: { ...base.presentation!, slots: { gallery: 'price-id' } }
    }, 1)).toThrow('does not support number')
    expect(() => compileSchemaAst({
      ...base,
      presentation: { ...base.presentation!, slugFieldId: 'missing', slots: {} }
    }, 1)).toThrow('slug binding references a missing field')
    expect(() => compileSchemaAst({
      ...base,
      presentation: { ...base.presentation!, slugFieldId: 'price-id', slots: {} }
    }, 1)).toThrow('slug binding does not support number')
  })

  it('keeps template and renderer names allowlisted by strict Zod parsing', () => {
    expect(schemaAstSchema.safeParse({
      schemaKey: 'unsafe',
      title: 'Unsafe',
      fields,
      presentation: {
        contractVersion: 1,
        preset: 'generic',
        collectionTemplate: '<script>',
        detailTemplate: 'document'
      }
    }).success).toBe(false)
  })
})

describe('asset_list contract', () => {
  it('compiles ordered accessible items, constraints, relation, and widget metadata', () => {
    const compiled = compileSchemaAst({ schemaKey: 'gallery', title: 'Gallery', fields }, 1)
    expect(compiled.jsonSchema.properties.gallery).toMatchObject({
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['assetId'],
        additionalProperties: false,
        properties: { assetId: { type: 'string', minLength: 1 }, alt: { type: 'string' }, caption: { type: 'string' } }
      },
      'x-rel': { kind: 'asset_ref', target: 'system:Asset', cardinality: 'many' },
      'x-ui': { widget: 'assetListPicker' }
    })
    expect(compiled.registry.relations).toContainEqual({
      fieldId: 'gallery-id', fieldKey: 'gallery', targetKind: 'asset', targetSchemaKey: undefined, kind: 'asset_ref'
    })
  })

  it('defines explicit singular/list coercion while preserving IDs and metadata', () => {
    expect(coerceValue('asset-1', fields[2]!)).toEqual([{ assetId: 'asset-1' }])
    expect(coerceValue([{ assetId: 'asset-1', alt: 'Front', caption: 'Hero' }, { assetId: 'asset-2' }], {
      id: 'cover-id', key: 'cover', kind: 'asset'
    })).toBe('asset-1')
  })
})
