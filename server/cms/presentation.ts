import type {
  CompiledSchemaPresentation,
  FieldKind,
  FieldRendererKey,
  PresentationSlot,
  SchemaAst
} from './types'

export const DEFAULT_RENDERER_BY_KIND: Record<FieldKind, FieldRendererKey> = {
  string: 'text',
  text: 'long_text',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  url: 'link',
  enum: 'badge',
  richtext: 'rich_text',
  reference: 'reference',
  asset: 'asset',
  asset_list: 'asset_gallery'
}

const ALLOWED_RENDERERS: Record<FieldKind, FieldRendererKey[]> = {
  string: ['text', 'long_text', 'badge', 'link'],
  text: ['text', 'long_text'],
  number: ['number', 'text'],
  integer: ['number', 'text'],
  boolean: ['boolean', 'badge', 'text'],
  date: ['date', 'text'],
  datetime: ['datetime', 'date', 'text'],
  url: ['link', 'text'],
  enum: ['badge', 'text'],
  richtext: ['rich_text', 'long_text'],
  reference: ['reference', 'reference_list'],
  asset: ['asset'],
  asset_list: ['asset_gallery']
}

const SLOT_KINDS: Record<PresentationSlot, FieldKind[]> = {
  title: ['string', 'text'],
  description: ['string', 'text', 'richtext'],
  image: ['asset', 'asset_list'],
  body: ['text', 'richtext'],
  gallery: ['asset_list', 'asset'],
  price: ['number', 'integer', 'string']
}

function inferredSlots(ast: SchemaAst) {
  const definitions: Array<[PresentationSlot, string[]]> = [
    ['title', ['title', 'name']],
    ['description', ['description', 'summary', 'excerpt']],
    ['image', ['image', 'cover', 'thumbnail']],
    ['body', ['body', 'content']],
    ['gallery', ['gallery', 'images', 'media']],
    ['price', ['price', 'amount']]
  ]
  const fields = ast.fields.filter(field => !field.system)
  const used = new Set<string>()
  const inferred: Partial<Record<PresentationSlot, string>> = {}

  // Preserve strongly named fields before applying kind-based fallback so a
  // body/gallery field cannot be consumed by an earlier optional slot.
  for (const [slot, keys] of definitions) {
    const field = fields.find(field => !used.has(field.id) && keys.includes(field.key) && SLOT_KINDS[slot].includes(field.kind))
    if (!field) continue
    inferred[slot] = field.id
    used.add(field.id)
  }

  for (const [slot] of definitions) {
    if (inferred[slot]) continue
    const field = fields.find(field => !used.has(field.id) && SLOT_KINDS[slot].includes(field.kind))
    if (!field) continue
    inferred[slot] = field.id
    used.add(field.id)
  }

  return inferred
}

export function compileSchemaPresentation(ast: SchemaAst, schemaVersion: number): CompiledSchemaPresentation {
  const config = ast.presentation ?? {
    contractVersion: 1 as const,
    preset: 'generic' as const,
    collectionTemplate: 'list' as const,
    detailTemplate: 'document' as const
  }
  const fieldsById = new Map(ast.fields.filter(field => !field.system).map(field => [field.id, field]))
  const slugField = config.slugFieldId ? fieldsById.get(config.slugFieldId) : undefined
  if (config.slugFieldId && !slugField) throw new Error('Presentation slug binding references a missing field')
  if (slugField && !['string', 'text'].includes(slugField.kind)) {
    throw new Error(`Presentation slug binding does not support ${slugField.kind}`)
  }
  const slots = { ...inferredSlots(ast), ...config.slots }
  const compiledSlots: CompiledSchemaPresentation['slots'] = {}

  for (const [slot, fieldId] of Object.entries(slots) as Array<[PresentationSlot, string]>) {
    const field = fieldsById.get(fieldId)
    if (!field) throw new Error(`Presentation ${slot} binding references a missing field`)
    if (!SLOT_KINDS[slot].includes(field.kind)) {
      throw new Error(`Presentation ${slot} binding does not support ${field.kind}`)
    }
    compiledSlots[slot] = { fieldId, fieldKey: field.key }
  }

  const overrides = new Map(config.renderers?.map(item => [item.fieldId, item.renderer]))
  for (const fieldId of overrides.keys()) {
    if (!fieldsById.has(fieldId)) throw new Error('Presentation renderer references a missing field')
  }

  const fields = [...fieldsById.values()].map((field) => {
    const renderer = overrides.get(field.id) ?? DEFAULT_RENDERER_BY_KIND[field.kind]
    if (!ALLOWED_RENDERERS[field.kind].includes(renderer)) {
      throw new Error(`Presentation renderer ${renderer} does not support ${field.kind}`)
    }
    return {
      fieldId: field.id,
      fieldKey: field.key,
      kind: field.kind,
      renderer,
      title: field.title
    }
  })

  return {
    contractVersion: 1,
    schemaVersion,
    preset: config.preset,
    collectionTemplate: config.collectionTemplate,
    detailTemplate: config.detailTemplate,
    layoutId: config.layoutId,
    slugFieldId: config.slugFieldId,
    slugField: slugField ? { fieldId: slugField.id, fieldKey: slugField.key } : undefined,
    structuredDataType: config.structuredDataType ?? (config.preset === 'article' ? 'Article' : config.preset === 'catalog' ? 'Product' : 'WebPage'),
    slots: compiledSlots,
    fields
  }
}
