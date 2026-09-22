export type SchemaPresentation = {
  contractVersion: 1
  preset: 'generic' | 'article' | 'catalog'
  collectionTemplate: 'list' | 'cards' | 'catalog-grid'
  detailTemplate: 'document' | 'article' | 'catalog'
  layoutId?: string
  slugFieldId?: string
  structuredDataType?: 'WebPage' | 'Article' | 'BlogPosting' | 'NewsArticle' | 'Product'
  slots: Partial<Record<'title' | 'description' | 'image' | 'body' | 'gallery' | 'price', string>>
  [key: string]: unknown
}

export type SchemaPresentationField = {
  id: string
  key: string
  kind: string
  title?: string
  system?: boolean
}

type StoredSchemaPresentation = Omit<SchemaPresentation, 'slots'> & {
  slots?: SchemaPresentation['slots']
}

export function schemaPresentationForEditor(
  value: StoredSchemaPresentation | null | undefined
): SchemaPresentation {
  if (value?.slots !== undefined) return value as SchemaPresentation
  return {
    contractVersion: 1,
    preset: 'generic',
    collectionTemplate: 'list',
    detailTemplate: 'document',
    ...value,
    slots: {}
  }
}

export function schemaPresentationFromEditor(
  value: SchemaPresentation,
  stored: StoredSchemaPresentation | null | undefined
): StoredSchemaPresentation {
  if (stored && stored.slots === undefined && Object.keys(value.slots).length === 0) {
    const { slots: _syntheticSlots, ...withoutSyntheticSlots } = value
    return withoutSyntheticSlots
  }
  return value
}

const SLOT_KINDS = {
  title: ['string', 'text'],
  description: ['string', 'text', 'richtext'],
  image: ['asset', 'asset_list'],
  body: ['text', 'richtext'],
  gallery: ['asset_list', 'asset'],
  price: ['number', 'integer', 'string']
} as const

const SLOT_KEYS = {
  title: ['title', 'name'],
  description: ['description', 'summary', 'excerpt'],
  image: ['image', 'cover', 'thumbnail', 'gallery'],
  body: ['body', 'content'],
  gallery: ['gallery', 'images', 'media'],
  price: ['price', 'amount']
} as const

export function buildSchemaPresentationPreset(
  preset: SchemaPresentation['preset'],
  fields: SchemaPresentationField[],
  current: SchemaPresentation
): SchemaPresentation {
  const contentFields = fields.filter(field => !field.system)
  const slots: SchemaPresentation['slots'] = {}
  for (const slot of Object.keys(SLOT_KINDS) as Array<keyof typeof SLOT_KINDS>) {
    const compatible = contentFields.filter(field => (SLOT_KINDS[slot] as readonly string[]).includes(field.kind))
    const selected = compatible.find(field => (SLOT_KEYS[slot] as readonly string[]).includes(field.key)) ?? compatible[0]
    if (selected) slots[slot] = selected.id
  }
  return {
    ...current,
    contractVersion: 1,
    preset,
    collectionTemplate: preset === 'generic' ? 'list' : preset === 'article' ? 'cards' : 'catalog-grid',
    detailTemplate: preset === 'generic' ? 'document' : preset,
    structuredDataType: current.structuredDataType
      ?? (preset === 'article' ? 'Article' : preset === 'catalog' ? 'Product' : 'WebPage'),
    slots
  }
}

export function schemaPresentationPresetReplacements(
  current: SchemaPresentation,
  fields: SchemaPresentationField[]
) {
  const baseline = buildSchemaPresentationPreset(current.preset, fields, current)
  const replacements: string[] = []
  if (current.collectionTemplate !== baseline.collectionTemplate) replacements.push('collection template')
  if (current.detailTemplate !== baseline.detailTemplate) replacements.push('detail template')
  const changedSlots = (Object.keys(SLOT_KINDS) as Array<keyof typeof SLOT_KINDS>)
    .filter(slot => current.slots[slot] !== baseline.slots[slot])
  if (changedSlots.length) replacements.push(`field roles (${changedSlots.join(', ')})`)
  return replacements
}

export function presentationFieldLabel(fields: SchemaPresentationField[], fieldId?: string) {
  if (!fieldId) return 'Automatic fallback'
  const field = fields.find(candidate => candidate.id === fieldId)
  return field ? `${field.title || field.key} (${field.key})` : 'Missing field'
}
