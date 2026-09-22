import { describe, expect, it } from 'vitest'
import { buildListingProjection, inferListingSelection } from '../server/cms/listing'
import type { SchemaRegistry } from '../server/cms/types'

function createRegistry(fields: SchemaRegistry['fields']): SchemaRegistry {
  return {
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    fields,
    relations: []
  }
}

describe('inferListingSelection', () => {
  it('prefers conventional keys before falling back by kind', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'headline', kind: 'string' },
      { fieldId: '2', key: 'summary', kind: 'text' },
      { fieldId: '3', key: 'cover', kind: 'asset' },
      { fieldId: '4', key: 'title', kind: 'string' }
    ])

    expect(inferListingSelection(registry)).toEqual({
      titleFieldKey: 'title',
      descriptionFieldKey: 'summary',
      imageFieldKey: 'cover'
    })
  })

  it('falls back to the first compatible field when exact keys are absent', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'headline', kind: 'string' },
      { fieldId: '2', key: 'body', kind: 'richtext' },
      { fieldId: '3', key: 'heroAsset', kind: 'asset' }
    ])

    expect(inferListingSelection(registry)).toEqual({
      titleFieldKey: 'headline',
      descriptionFieldKey: 'body',
      imageFieldKey: 'heroAsset'
    })
  })
})

describe('buildListingProjection', () => {
  it('derives title, description, and image from selected fields', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'title', kind: 'string' },
      { fieldId: '2', key: 'summary', kind: 'text' },
      { fieldId: '3', key: 'cover', kind: 'asset' }
    ])

    expect(buildListingProjection({
      registry,
      content: {
        title: ' Hello world ',
        summary: 'Line one\nLine two',
        cover: 'asset_123'
      }
    })).toMatchObject({
      title: 'Hello world',
      description: 'Line one Line two',
      image: '/assets/asset_123/raw'
    })
  })

  it('extracts plain text from richtext and truncates long descriptions', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'title', kind: 'string' },
      { fieldId: '2', key: 'body', kind: 'richtext' }
    ])

    const longText = 'a'.repeat(220)
    const projection = buildListingProjection({
      registry,
      content: {
        title: 'Post',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: longText }]
            }
          ]
        }
      }
    })

    expect(projection.title).toBe('Post')
    expect(projection.description).toBe(`${'a'.repeat(200)}...`)
    expect(projection.image).toBeNull()
  })

  it('uses explicit registry listing mappings instead of inferred defaults', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'title', kind: 'string' },
      { fieldId: '2', key: 'headline', kind: 'string' },
      { fieldId: '3', key: 'summary', kind: 'text' }
    ])
    registry.listing = {
      titleFieldKey: 'headline',
      descriptionFieldKey: 'summary',
      imageFieldKey: null
    }

    expect(buildListingProjection({
      registry,
      content: {
        title: 'Default title',
        headline: 'Mapped title',
        summary: 'Mapped summary'
      }
    })).toMatchObject({
      title: 'Mapped title',
      description: 'Mapped summary',
      image: null,
      titleFieldKey: 'headline',
      descriptionFieldKey: 'summary',
      imageFieldKey: null
    })
  })

  it('preserves explicit null listing mappings instead of falling back', () => {
    const registry = createRegistry([
      { fieldId: '1', key: 'title', kind: 'string' },
      { fieldId: '2', key: 'summary', kind: 'text' }
    ])
    registry.listing = {
      titleFieldKey: null,
      descriptionFieldKey: null,
      imageFieldKey: null
    }

    expect(buildListingProjection({
      registry,
      content: {
        title: 'Default title',
        summary: 'Default summary'
      }
    })).toMatchObject({
      title: null,
      description: null,
      image: null,
      titleFieldKey: null,
      descriptionFieldKey: null,
      imageFieldKey: null
    })
  })
})
