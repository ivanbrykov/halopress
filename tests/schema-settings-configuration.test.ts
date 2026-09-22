import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultSearchModeForFieldKind,
  isFilterableFieldKind,
  isFullTextFieldKind,
  searchModesForFieldKind
} from '../shared/search-field-capabilities'
import {
  applyFullTextFieldIds,
  fullTextFieldIds,
  setFieldFilterable,
  type SchemaSearchField
} from '../app/utils/schema-search-configuration'
import {
  buildSchemaPresentationPreset,
  schemaPresentationFromEditor,
  schemaPresentationForEditor,
  schemaPresentationPresetReplacements
} from '../app/utils/schema-presentation-settings'

const projectRoot = join(import.meta.dirname, '..')

async function source(path: string) {
  return await readFile(join(projectRoot, path), 'utf8')
}

describe('Schema Settings configuration contracts', () => {
  it('shares field eligibility and default search modes without runtime search dependencies', () => {
    expect(searchModesForFieldKind('richtext')).toEqual(['off'])
    expect(isFullTextFieldKind('richtext')).toBe(true)
    expect(isFullTextFieldKind('asset')).toBe(false)
    expect(isFilterableFieldKind('url')).toBe(true)
    expect(isFilterableFieldKind('richtext')).toBe(false)
    expect(defaultSearchModeForFieldKind('number')).toBe('range')
    expect(defaultSearchModeForFieldKind('date')).toBe('range')
    expect(defaultSearchModeForFieldKind('string')).toBe('exact')
  })

  it('patches full-text state by stable field ID while preserving the complete field values', () => {
    const fields: SchemaSearchField[] = [
      {
        id: 'title-id',
        key: 'renamed_title',
        kind: 'string',
        title: 'Renamed title',
        required: true,
        custom: { retained: true },
        search: { mode: 'exact_set', filterable: true, sortable: true, fullText: false }
      },
      {
        id: 'body-id',
        key: 'body',
        kind: 'richtext',
        search: { fullText: true }
      },
      {
        id: 'asset-id',
        key: 'cover',
        kind: 'asset',
        search: { fullText: true }
      }
    ]

    const next = applyFullTextFieldIds(fields, ['title-id'])
    expect(fullTextFieldIds(next)).toEqual(['title-id'])
    expect(next.map(field => field.id)).toEqual(['title-id', 'body-id', 'asset-id'])
    expect(next[0]).toMatchObject({
      key: 'renamed_title',
      required: true,
      custom: { retained: true },
      search: { mode: 'exact_set', filterable: true, sortable: true, fullText: true }
    })
    expect(next[2]).toBe(fields[2])
  })

  it('uses compatible defaults when enabling filtering and clears no other search option when disabling', () => {
    const fields: SchemaSearchField[] = [
      {
        id: 'amount-id',
        key: 'amount',
        kind: 'number',
        search: { mode: 'off', sortable: true, fullText: false }
      },
      {
        id: 'status-id',
        key: 'status',
        kind: 'enum',
        search: { mode: 'exact_set', filterable: true, sortable: true }
      }
    ]

    const enabled = setFieldFilterable(fields, 'amount-id', true)
    expect(enabled[0]?.search).toEqual({
      mode: 'range',
      filterable: true,
      sortable: true,
      fullText: false
    })

    const disabled = setFieldFilterable(enabled, 'status-id', false)
    expect(disabled[1]?.search).toEqual({
      mode: 'exact_set',
      filterable: false,
      sortable: true
    })
  })

  it('applies presentation presets loss-aware while preserving Layout, slug, and metadata choices', () => {
    const fields = [
      { id: 'title-id', key: 'title', kind: 'string' },
      { id: 'body-id', key: 'body', kind: 'richtext' },
      { id: 'price-id', key: 'price', kind: 'number' }
    ]
    const current = {
      contractVersion: 1 as const,
      preset: 'article' as const,
      collectionTemplate: 'list' as const,
      detailTemplate: 'document' as const,
      layoutId: 'layout-a',
      slugFieldId: 'title-id',
      structuredDataType: 'NewsArticle' as const,
      slots: { title: 'body-id' },
      extensionContract: { retained: true }
    }

    expect(schemaPresentationPresetReplacements(current, fields)).toEqual([
      'collection template',
      'detail template',
      'field roles (title, description, body, price)'
    ])

    const catalog = buildSchemaPresentationPreset('catalog', fields, current)
    expect(catalog).toMatchObject({
      preset: 'catalog',
      collectionTemplate: 'catalog-grid',
      detailTemplate: 'catalog',
      layoutId: 'layout-a',
      slugFieldId: 'title-id',
      structuredDataType: 'NewsArticle',
      slots: { title: 'title-id', body: 'body-id', price: 'price-id' },
      extensionContract: { retained: true }
    })
  })

  it('supplies missing presentation slots without mutating or replacing complete stored values', () => {
    const complete = {
      contractVersion: 1 as const,
      preset: 'generic' as const,
      collectionTemplate: 'list' as const,
      detailTemplate: 'document' as const,
      slots: { title: 'title-id' },
      extensionContract: { retained: true }
    }
    expect(schemaPresentationForEditor(complete)).toBe(complete)

    const legacy = {
      contractVersion: 1 as const,
      preset: 'generic' as const,
      collectionTemplate: 'list' as const,
      detailTemplate: 'document' as const,
      layoutId: 'layout-a',
      extensionContract: { retained: true }
    }
    const normalized = schemaPresentationForEditor(legacy)
    expect(normalized).not.toBe(legacy)
    expect(normalized).toEqual({
      ...legacy,
      slots: {}
    })
    expect(legacy).not.toHaveProperty('slots')
  })

  it('drops only synthetic empty slots when legacy presentation edits return to stored values', () => {
    const legacy = {
      contractVersion: 1 as const,
      preset: 'generic' as const,
      collectionTemplate: 'list' as const,
      detailTemplate: 'document' as const,
      extensionContract: { retained: true }
    }
    const changed = schemaPresentationFromEditor({
      ...schemaPresentationForEditor(legacy),
      collectionTemplate: 'cards'
    }, legacy)
    expect(changed).toEqual({
      ...legacy,
      collectionTemplate: 'cards'
    })

    const reverted = schemaPresentationFromEditor({
      ...schemaPresentationForEditor(changed),
      collectionTemplate: 'list'
    }, changed)
    expect(reverted).toEqual(legacy)

    const explicitlyEmpty = { ...legacy, slots: {} }
    expect(schemaPresentationFromEditor(
      schemaPresentationForEditor(explicitlyEmpty),
      explicitlyEmpty
    )).toBe(explicitlyEmpty)

    const mapped = { ...legacy, slots: { title: 'title-id' } }
    const cleared = { ...mapped, slots: {} }
    expect(schemaPresentationFromEditor(cleared, mapped)).toBe(cleared)
    expect(cleared).toHaveProperty('slots', {})
  })

  it('uses one revision-aware AST for presentation and search while keeping Permissions immediate', async () => {
    const [settings, context, inventory, schemaEditor, shared] = await Promise.all([
      source('app/pages/_desk/schemas/[schemaKey]/settings.vue'),
      source('app/composables/useSchemaSettingsDraft.ts'),
      source('app/pages/_desk/schemas/index.vue'),
      source('app/pages/_desk/schemas/[schemaKey]/index.vue'),
      source('shared/search-field-capabilities.ts')
    ])

    expect(settings).toContain('await useSchemaSettingsDraft(schemaKey')
    expect(settings).toContain('<CmsSchemaPresentationEditor')
    expect(settings).toContain('<CmsSchemaSearchConfigurationEditor')
    expect(settings).toContain('Permissions apply immediately and are not included in the Schema draft save state above.')
    expect(settings).not.toContain('/lifecycle')
    expect(settings).not.toContain('Schema lifecycle')

    expect(context).toContain('revision: revision.value')
    expect(context).toContain('ast: localAst')
    expect(context).toContain('conflict.value')
    expect(context).toContain('await Promise.all([draftRequest, publishedRequest])')
    expect(context).not.toMatch(/\.\.\.draftRequest/)
    expect(context).not.toContain('then:')
    expect(context).not.toContain('catch:')
    expect(context).not.toContain('finally:')

    expect(inventory.indexOf('openLifecycleAction')).toBeLessThan(inventory.indexOf('/lifecycle`'))
    expect(inventory).toContain('await $fetch<LifecycleImpact>(`/api/schema/${schema.schemaKey}/lifecycle`)')
    expect(inventory).toContain(':aria-label="`Lifecycle actions for ${schema.title || schema.schemaKey}`"')
    expect(inventory).toMatch(/<\/UPageCard>\s*[\s\S]*<UDropdownMenu/)

    expect(schemaEditor).not.toContain('<CmsSchemaPresentationEditor')
    expect(schemaEditor).toContain('Public presentation is configured in Settings')
    expect(schemaEditor).toContain('useUnsavedNavigationGuard(isDirty')
    expect(schemaEditor).toContain('for (const key of Object.keys(state.presentation)) delete')
    expect(shared).not.toContain('analyzer')
    expect(shared).not.toContain('indexer')
    expect(shared).not.toContain('FTS')
  })
})
