import type { SchemaAst, SchemaRegistry } from './types'
import { inferListingSelection } from './listing'
import { compileSchemaPresentation } from './presentation'

function resolveListingFieldKey(
  listing: SchemaAst['listing'],
  key: 'titleFieldKey' | 'descriptionFieldKey' | 'imageFieldKey',
  fallback: string | null
) {
  if (listing && Object.prototype.hasOwnProperty.call(listing, key)) {
    return listing[key] ?? null
  }

  return fallback
}

function relTargetToKind(target: string): { kind: 'content' | 'user' | 'asset'; schemaKey?: string } {
  if (target.startsWith('system:User')) return { kind: 'user' }
  if (target.startsWith('system:Asset')) return { kind: 'asset' }
  if (target.startsWith('content:')) return { kind: 'content', schemaKey: target.slice('content:'.length) }
  // fallback
  return { kind: 'content' }
}

function fieldToJsonSchema(field: SchemaAst['fields'][number]) {
  const base: Record<string, unknown> = {
    title: field.title,
    description: field.description
  }

  const widget = field.ui?.widget

  switch (field.kind) {
    case 'string':
      return { ...base, type: 'string', 'x-ui': field.ui, 'x-search': field.search }
    case 'text':
      return { ...base, type: 'string', 'x-ui': { ...field.ui, widget: widget ?? 'textarea' }, 'x-search': field.search }
    case 'number':
      return { ...base, type: 'number', 'x-ui': field.ui, 'x-search': field.search }
    case 'integer':
      return { ...base, type: 'integer', 'x-ui': field.ui, 'x-search': field.search }
    case 'boolean':
      return { ...base, type: 'boolean', 'x-ui': { ...field.ui, widget: widget ?? 'toggle' }, 'x-search': field.search }
    case 'date':
      return { ...base, type: 'string', format: 'date', 'x-ui': { ...field.ui, widget: widget ?? 'date' }, 'x-search': field.search }
    case 'datetime':
      return { ...base, type: 'string', format: 'date-time', 'x-ui': { ...field.ui, widget: widget ?? 'datetime' }, 'x-search': field.search }
    case 'url':
      return { ...base, type: 'string', format: 'uri', 'x-ui': { ...field.ui, widget: widget ?? 'url' }, 'x-search': field.search }
    case 'enum':
      return {
        ...base,
        type: 'string',
        enum: (field.enumValues ?? []).map(v => v.value),
        'x-ui': { ...field.ui, widget: widget ?? 'select' },
        'x-search': field.search
      }
    case 'richtext':
      return {
        ...base,
        type: ['object', 'array', 'string', 'null'],
        'x-ui': { ...field.ui, widget: widget ?? 'u-editor' },
        'x-search': field.search
      }
    case 'asset':
      return {
        ...base,
        type: ['string', 'null'],
        'x-rel': field.rel ?? { kind: 'asset_ref', target: 'system:Asset', cardinality: 'one' },
        'x-ui': { ...field.ui, widget: widget ?? 'assetPicker' }
      }
    case 'asset_list':
      return {
        ...base,
        type: 'array',
        items: {
          type: 'object',
          properties: {
            assetId: { type: 'string', minLength: 1 },
            alt: { type: 'string' },
            caption: { type: 'string' }
          },
          required: ['assetId'],
          additionalProperties: false
        },
        minItems: Math.max(field.required ? 1 : 0, field.assetList?.minItems ?? 0) || undefined,
        maxItems: field.assetList?.maxItems,
        'x-rel': field.rel ?? { kind: 'asset_ref', target: 'system:Asset', cardinality: 'many' },
        'x-ui': { ...field.ui, widget: widget ?? 'assetListPicker' }
      }
    case 'reference':
      return {
        ...base,
        type: field.rel?.cardinality === 'many' ? 'array' : ['string', 'null'],
        ...(field.rel?.cardinality === 'many' ? { items: { type: 'string' } } : {}),
        'x-rel': field.rel,
        'x-ui': { ...field.ui, widget: widget ?? 'relationEditor' }
      }
    default:
      return { ...base }
  }
}

export function compileSchemaAst(ast: SchemaAst, version: number) {
  const required = ast.fields.filter(f => f.required && !f.system).map(f => f.key)

  const properties: Record<string, unknown> = {}
  for (const field of ast.fields) {
    if (field.system) continue
    properties[field.key] = fieldToJsonSchema(field)
  }

  const jsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: ast.title,
    description: ast.description,
    properties,
    required: required.length ? required : undefined,
    additionalProperties: false
  }

  const relations: SchemaRegistry['relations'] = []
  for (const f of ast.fields) {
    if (f.kind !== 'reference' && f.kind !== 'asset' && f.kind !== 'asset_list') continue
    const rel = f.rel
    if (!rel) {
      relations.push({
        fieldId: f.id,
        fieldKey: f.key,
        targetKind: f.kind === 'asset' || f.kind === 'asset_list' ? 'asset' : 'content',
        targetSchemaKey: undefined,
        kind: f.kind === 'asset' || f.kind === 'asset_list' ? 'asset_ref' : 'ref'
      })
      continue
    }

    const { kind, schemaKey } = relTargetToKind(rel.target)
    relations.push({
      fieldId: f.id,
      fieldKey: f.key,
      targetKind: kind,
      targetSchemaKey: schemaKey,
      kind: rel.kind
    })
  }

  const listingDefaults = inferListingSelection({
    schemaKey: ast.schemaKey,
    version,
    title: ast.title,
    fields: ast.fields.map(f => ({
      fieldId: f.id,
      key: f.key,
      kind: f.kind,
      title: f.title,
      description: f.description,
      required: f.required,
      enumValues: f.enumValues,
      ui: f.ui,
      search: f.search,
      rel: f.rel,
      assetList: f.assetList,
      system: f.system
    })),
    relations
  })

  const registry: SchemaRegistry = {
    schemaKey: ast.schemaKey,
    version,
    title: ast.title,
    listing: {
      titleFieldKey: resolveListingFieldKey(ast.listing, 'titleFieldKey', listingDefaults.titleFieldKey),
      descriptionFieldKey: resolveListingFieldKey(ast.listing, 'descriptionFieldKey', listingDefaults.descriptionFieldKey),
      imageFieldKey: resolveListingFieldKey(ast.listing, 'imageFieldKey', listingDefaults.imageFieldKey)
    },
    presentation: compileSchemaPresentation(ast, version),
    fields: ast.fields.map(f => ({
      fieldId: f.id,
      key: f.key,
      kind: f.kind,
      title: f.title,
      description: f.description,
      required: f.required,
      enumValues: f.enumValues,
      ui: f.ui,
      search: f.search,
      rel: f.rel,
      assetList: f.assetList,
      system: f.system
    })),
    relations
  }

  const uiSchema = {
    // Nuxt UI form renderer consumes x-ui in each field. Keep root for future.
    'x-ui': {
      schemaKey: ast.schemaKey
    }
  }

  return { jsonSchema, uiSchema, registry }
}
