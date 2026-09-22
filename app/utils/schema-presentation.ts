type RegistryField = { fieldId: string; key: string; kind: string; title?: string; system?: boolean }

const rendererByKind: Record<string, string> = {
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

export function resolveSchemaPresentation(registry: any) {
  const fields: RegistryField[] = (registry?.fields ?? []).filter((field: RegistryField) => !field.system)
  const stored = registry?.presentation
  if (stored?.contractVersion === 1 && Array.isArray(stored.fields)) return stored

  const definitions: Array<[string, string[], string[]]> = [
    ['title', ['title', 'name'], ['string', 'text']],
    ['description', ['description', 'summary', 'excerpt'], ['string', 'text', 'richtext']],
    ['image', ['image', 'cover', 'thumbnail'], ['asset', 'asset_list']],
    ['body', ['body', 'content'], ['text', 'richtext']],
    ['gallery', ['gallery', 'images', 'media'], ['asset_list', 'asset']],
    ['price', ['price', 'amount'], ['number', 'integer', 'string']]
  ]
  const selected: Record<string, RegistryField | undefined> = {}
  const used = new Set<string>()
  for (const [name, keys, kinds] of definitions) {
    const field = fields.find(field => !used.has(field.fieldId) && keys.includes(field.key) && kinds.includes(field.kind))
    if (!field) continue
    selected[name] = field
    used.add(field.fieldId)
  }
  for (const [name, , kinds] of definitions) {
    if (selected[name]) continue
    const field = fields.find(field => !used.has(field.fieldId) && kinds.includes(field.kind))
    if (!field) continue
    selected[name] = field
    used.add(field.fieldId)
  }
  const slot = (field?: RegistryField) => field ? { fieldId: field.fieldId, fieldKey: field.key } : undefined
  return {
    contractVersion: 1,
    schemaVersion: registry?.version ?? 0,
    preset: 'generic',
    collectionTemplate: 'list',
    detailTemplate: 'document',
    slots: {
      title: slot(selected.title),
      description: slot(selected.description),
      image: slot(selected.image),
      body: slot(selected.body),
      gallery: slot(selected.gallery),
      price: slot(selected.price)
    },
    fields: fields.map(field => ({
      fieldId: field.fieldId,
      fieldKey: field.key,
      kind: field.kind,
      title: field.title,
      renderer: rendererByKind[field.kind] ?? 'text'
    }))
  }
}

export function hasRenderableValue(value: unknown) {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function presentationText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(presentationText).filter(Boolean).join(' ')
  if (value && typeof value === 'object') {
    if (typeof (value as any).text === 'string') return (value as any).text
    if (Array.isArray((value as any).content)) return presentationText((value as any).content)
  }
  return ''
}

export function isRichTextPresentationField(field: unknown) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false
  const candidate = field as Record<string, unknown>
  return candidate.kind === 'richtext' || candidate.renderer === 'rich_text'
}

export function reservedPresentationFieldIds(presentation: any) {
  const renderedSlots = new Set(['title', 'description', 'image', 'body', 'gallery'])
  if (presentation?.detailTemplate === 'catalog') renderedSlots.add('price')
  return new Set<string>(Object.entries(presentation?.slots ?? {})
    .filter(([slot]) => renderedSlots.has(slot))
    .map(([, binding]: any) => binding?.fieldId)
    .filter(Boolean))
}

export function safePresentationLink(value: unknown) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate) return null
  if (candidate.startsWith('/') || candidate.startsWith('#') || candidate.startsWith('?')) return candidate
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function formatPresentationDate(value: unknown, includeTime = false, locale = 'en') {
  if (typeof value !== 'string') return ''
  const timezoneLessDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
  const date = new Date(timezoneLessDateTime ? `${value}Z` : value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
        ...(includeTime ? { timeStyle: 'short' } : {})
      }).format(date)
}
