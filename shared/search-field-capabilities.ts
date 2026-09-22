export const SCHEMA_FIELD_KINDS = [
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'url',
  'enum',
  'richtext',
  'reference',
  'asset',
  'asset_list'
] as const

export type SchemaFieldKind = typeof SCHEMA_FIELD_KINDS[number]
export type SchemaSearchMode = 'off' | 'exact' | 'range' | 'exact_set'

export const SEARCH_MODES_BY_FIELD_KIND: Record<SchemaFieldKind, readonly SchemaSearchMode[]> = {
  string: ['off', 'exact', 'exact_set'],
  text: ['off', 'exact', 'exact_set'],
  richtext: ['off'],
  url: ['off', 'exact', 'exact_set'],
  enum: ['off', 'exact', 'exact_set'],
  boolean: ['off', 'exact', 'exact_set'],
  number: ['off', 'exact', 'range'],
  integer: ['off', 'exact', 'range'],
  date: ['off', 'exact', 'range'],
  datetime: ['off', 'exact', 'range'],
  reference: ['off'],
  asset: ['off'],
  asset_list: ['off']
}

export const FILTERABLE_FIELD_KINDS = new Set<SchemaFieldKind>([
  'string',
  'text',
  'url',
  'enum',
  'boolean',
  'number',
  'integer',
  'date',
  'datetime'
])

export const SORTABLE_FIELD_KINDS = new Set<SchemaFieldKind>([
  'string',
  'url',
  'enum',
  'boolean',
  'number',
  'integer',
  'date',
  'datetime'
])

export const FULL_TEXT_FIELD_KINDS = new Set<SchemaFieldKind>([
  'string',
  'text',
  'richtext'
])

export function isSchemaFieldKind(kind: string): kind is SchemaFieldKind {
  return (SCHEMA_FIELD_KINDS as readonly string[]).includes(kind)
}

export function searchModesForFieldKind(kind: string): readonly SchemaSearchMode[] {
  return isSchemaFieldKind(kind) ? SEARCH_MODES_BY_FIELD_KIND[kind] : ['off']
}

export function isFilterableFieldKind(kind: string): kind is SchemaFieldKind {
  return isSchemaFieldKind(kind) && FILTERABLE_FIELD_KINDS.has(kind)
}

export function isSortableFieldKind(kind: string): kind is SchemaFieldKind {
  return isSchemaFieldKind(kind) && SORTABLE_FIELD_KINDS.has(kind)
}

export function isFullTextFieldKind(kind: string): kind is SchemaFieldKind {
  return isSchemaFieldKind(kind) && FULL_TEXT_FIELD_KINDS.has(kind)
}

export function defaultSearchModeForFieldKind(kind: string): SchemaSearchMode {
  return kind === 'number' || kind === 'integer' || kind === 'date' || kind === 'datetime'
    ? 'range'
    : 'exact'
}

export function normalizeSearchModeForFieldKind(kind: string, mode?: SchemaSearchMode): SchemaSearchMode {
  const allowed = searchModesForFieldKind(kind)
  return mode && allowed.includes(mode) ? mode : 'off'
}
