import type { FieldKind, SearchConfig, SchemaRegistry } from './types'
import { Node, generateText, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import { generateHTML } from '@tiptap/html/server'
import {
  FILTERABLE_FIELD_KINDS,
  FULL_TEXT_FIELD_KINDS,
  normalizeSearchModeForFieldKind,
  SEARCH_MODES_BY_FIELD_KIND,
  SORTABLE_FIELD_KINDS
} from '../../shared/search-field-capabilities'

type SearchMode = NonNullable<SearchConfig['mode']>

export type SearchDataType = 'text' | 'integer' | 'float' | 'date'

export type NormalizedSearchConfig = {
  mode: SearchMode
  filterable: boolean
  sortable: boolean
  fullText: boolean
}

export const SEARCH_MODES_BY_KIND = SEARCH_MODES_BY_FIELD_KIND as Record<FieldKind, SearchMode[]>
export const FILTERABLE_KINDS = FILTERABLE_FIELD_KINDS as Set<FieldKind>
export const SORTABLE_KINDS = SORTABLE_FIELD_KINDS as Set<FieldKind>
export const FULL_TEXT_KINDS = FULL_TEXT_FIELD_KINDS as Set<FieldKind>

const ServerImageUpload = Node.create({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-upload' })]
  }
})

const richtextExtensions = [
  StarterKit.configure({
    horizontalRule: false,
    heading: { levels: [1, 2, 3, 4] },
    link: { openOnClick: false }
  }),
  HorizontalRule,
  Image,
  Mention,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ServerImageUpload
]

export function searchDataTypeForKind(kind: FieldKind): SearchDataType | null {
  if (kind === 'number') return 'float'
  if (kind === 'integer' || kind === 'boolean') return 'integer'
  if (kind === 'date' || kind === 'datetime') return 'date'
  if (kind === 'string' || kind === 'text' || kind === 'url' || kind === 'enum' || kind === 'richtext') return 'text'
  return null
}

export function normalizeSearchMode(kind: FieldKind, mode?: SearchMode): SearchMode {
  return normalizeSearchModeForFieldKind(kind, mode)
}

export function normalizeSearchConfig(field: SchemaRegistry['fields'][number]): NormalizedSearchConfig {
  const mode = normalizeSearchMode(field.kind, field.search?.mode)
  const filterable = FILTERABLE_KINDS.has(field.kind) && !!field.search?.filterable && mode !== 'off'
  const sortable = SORTABLE_KINDS.has(field.kind) && !!field.search?.sortable && mode !== 'off'
  const fullText = FULL_TEXT_KINDS.has(field.kind) && !!field.search?.fullText
  return { mode, filterable, sortable, fullText }
}

export function isSearchEnabled(config: NormalizedSearchConfig) {
  return config.mode !== 'off' || config.filterable || config.sortable
}

function toStringValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function toIntegerValue(value: unknown): number | null {
  const num = toNumberValue(value)
  if (num == null) return null
  if (!Number.isFinite(num)) return null
  return Math.trunc(num)
}

function toDateValueMs(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime()
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.getTime()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number(trimmed)
    const date = Number.isFinite(numeric)
      ? new Date(numeric)
      : new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date.getTime()
  }
  return null
}

function toEnumValue(value: unknown, options: Array<{ value: string }> | undefined): string | null {
  const candidate = toStringValue(value)
  if (!candidate) return null
  const allowed = new Set((options ?? []).map(v => v.value))
  if (!allowed.size) return candidate
  return allowed.has(candidate) ? candidate : null
}

function extractPlainText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractPlainText).filter(Boolean).join(' ')
  }
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>
    const parts: string[] = []
    if (typeof node.text === 'string') parts.push(node.text)
    const content = node.content
    if (Array.isArray(content)) parts.push(content.map(extractPlainText).filter(Boolean).join(' '))
    return parts.filter(Boolean).join(' ')
  }
  return ''
}

function toRichtextHtml(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return null
  try {
    return generateHTML(value as any, richtextExtensions)
  } catch {
    try {
      const text = generateText(value as any, richtextExtensions)
      if (typeof text === 'string') return text
    } catch {
      // ignore
    }
    return extractPlainText(value)
  }
}

export function coerceSearchValue(field: Pick<SchemaRegistry['fields'][number], 'kind' | 'enumValues'>, value: unknown) {
  switch (field.kind) {
    case 'string':
    case 'text':
    case 'url':
      return toStringValue(value)
    case 'enum':
      return toEnumValue(value, field.enumValues)
    case 'richtext':
      return toRichtextHtml(value)
    case 'boolean':
      return toIntegerValue(value)
    case 'number':
      return toNumberValue(value)
    case 'integer':
      return toIntegerValue(value)
    case 'date':
    case 'datetime':
      return toDateValueMs(value)
    default:
      return null
  }
}

export function buildSearchDataRecord(
  fields: Array<Pick<SchemaRegistry['fields'][number], 'key' | 'kind' | 'enumValues'>>,
  content: Record<string, unknown>
) {
  const record: Record<string, string | number | null> = {}

  for (const field of fields) {
    const value = coerceSearchValue(field, content[field.key])
    record[field.key] = typeof value === 'string' || typeof value === 'number' ? value : null
  }

  return record
}
