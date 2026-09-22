import {
  defaultSearchModeForFieldKind,
  isFilterableFieldKind,
  isFullTextFieldKind,
  normalizeSearchModeForFieldKind
} from '~~/shared/search-field-capabilities'

export type SchemaSearchField = {
  id: string
  key: string
  kind: string
  title?: string
  system?: boolean
  search?: {
    mode?: 'off' | 'exact' | 'range' | 'exact_set'
    filterable?: boolean
    sortable?: boolean
    fullText?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

function copySearch(field: SchemaSearchField) {
  return { ...(field.search ?? {}) }
}

export function fullTextFieldIds(fields: SchemaSearchField[]) {
  return fields
    .filter(field => !field.system && isFullTextFieldKind(field.kind) && field.search?.fullText === true)
    .map(field => field.id)
}

export function applyFullTextFieldIds(fields: SchemaSearchField[], selectedIds: string[]) {
  const selected = new Set(selectedIds)
  return fields.map((field) => {
    if (field.system || !isFullTextFieldKind(field.kind)) return field
    return {
      ...field,
      search: {
        ...copySearch(field),
        fullText: selected.has(field.id)
      }
    }
  })
}

export function setFieldFilterable(fields: SchemaSearchField[], fieldId: string, enabled: boolean) {
  return fields.map((field) => {
    if (field.id !== fieldId || field.system || !isFilterableFieldKind(field.kind)) return field
    const search = copySearch(field)
    const currentMode = normalizeSearchModeForFieldKind(field.kind, search.mode)
    return {
      ...field,
      search: {
        ...search,
        mode: enabled && currentMode === 'off'
          ? defaultSearchModeForFieldKind(field.kind)
          : currentMode,
        filterable: enabled
      }
    }
  })
}
