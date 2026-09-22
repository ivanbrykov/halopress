import {
  KEYWORD_SEARCH_MAX_FILTERS,
  type KeywordSearchFilter
} from './keyword-search'

type CollectionKeywordSearchField = {
  fieldId: string
  key: string
  kind: string
  enumValues?: Array<{ value: string }>
  search?: {
    mode?: 'off' | 'exact' | 'range' | 'exact_set'
    filterable?: boolean
  }
}

function queryValues(value: unknown) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value]
  return source
    .flatMap(entry => String(entry).split(','))
    .map(entry => entry.trim())
    .filter(Boolean)
}

function scalarValue(field: CollectionKeywordSearchField, value: string): string | number | null {
  if (field.kind === 'boolean') {
    const normalized = value.toLowerCase()
    if (normalized === 'true' || normalized === '1') return 1
    if (normalized === 'false' || normalized === '0') return 0
    return null
  }
  if (field.kind === 'number' || field.kind === 'integer') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return field.kind === 'integer' ? Math.trunc(parsed) : parsed
  }
  if (field.kind === 'date' || field.kind === 'datetime') {
    const numeric = Number(value)
    const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }
  if (field.kind === 'enum' && field.enumValues?.length) {
    return field.enumValues.some(option => option.value === value) ? value : null
  }
  return value
}

function exactFilter(field: CollectionKeywordSearchField, values: string[]): KeywordSearchFilter | null {
  const value = values.length ? scalarValue(field, values[0]!) : null
  return value == null ? null : { fieldId: field.fieldId, op: 'exact', value }
}

function exactSetFilter(field: CollectionKeywordSearchField, values: string[]): KeywordSearchFilter | null {
  const parsed = [...new Set(values
    .map(value => scalarValue(field, value))
    .filter((value): value is string | number => value != null))]
    .slice(0, 10)
  return parsed.length ? { fieldId: field.fieldId, op: 'exact_set', values: parsed } : null
}

function rangeFilter(field: CollectionKeywordSearchField, values: string[]): KeywordSearchFilter | null {
  if (!values.length) return null
  const [rawMin, rawMax] = values[0]!.includes('..')
    ? values[0]!.split('..', 2)
    : [values[0], values[0]]
  const min = rawMin ? scalarValue(field, rawMin) : null
  const max = rawMax ? scalarValue(field, rawMax) : null
  if ((min != null && typeof min !== 'number') || (max != null && typeof max !== 'number')) {
    return null
  }
  if (min == null && max == null) return null
  if (min != null && max != null && min > max) return null
  return {
    fieldId: field.fieldId,
    op: 'range',
    ...(min == null ? {} : { min }),
    ...(max == null ? {} : { max })
  }
}

export function collectionKeywordFilterFields(fields: CollectionKeywordSearchField[]) {
  return fields.filter(field =>
    Boolean(field.fieldId)
    && Boolean(field.key)
    && field.search?.filterable === true
    && ['exact', 'exact_set', 'range'].includes(String(field.search.mode))
  )
}

export function collectionKeywordFilters(
  fields: CollectionKeywordSearchField[],
  query: Record<string, unknown>
) {
  const filters: KeywordSearchFilter[] = []
  for (const field of collectionKeywordFilterFields(fields)) {
    if (filters.length >= KEYWORD_SEARCH_MAX_FILTERS) break
    const values = queryValues(query[field.key])
    if (!values.length) continue
    const filter = field.search?.mode === 'range'
      ? rangeFilter(field, values)
      : field.search?.mode === 'exact_set'
        ? exactSetFilter(field, values)
        : exactFilter(field, values)
    if (filter) filters.push(filter)
  }
  return filters
}
