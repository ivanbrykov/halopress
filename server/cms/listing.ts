import type { SchemaRegistry } from './types'

const DESCRIPTION_LIMIT = 200

export type ListingSelection = {
  titleFieldKey: string | null
  descriptionFieldKey: string | null
  imageFieldKey: string | null
}

function hasOwn<T extends object, K extends keyof T>(value: T | null | undefined, key: K): value is T & Required<Pick<T, K>> {
  return !!value && Object.prototype.hasOwnProperty.call(value, key)
}

export function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function extractText(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (Array.isArray(node.content)) return node.content.map(extractText).join(' ')
  return ''
}

export function extractRichText(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).join(' ')
  if (typeof value === 'object') return extractText(value)
  return ''
}

function findByExactKey(
  fields: Array<{ key: string; kind: string }>,
  keys: string[],
  allowedKinds: string[]
) {
  for (const key of keys) {
    const match = fields.find(field => field.key === key && allowedKinds.includes(field.kind))
    if (match) return match.key
  }
  return null
}

function findFirstByKind(fields: Array<{ key: string; kind: string }>, allowedKinds: string[]) {
  const match = fields.find(field => allowedKinds.includes(field.kind))
  return match?.key ?? null
}

export function inferListingSelection(registry: SchemaRegistry | null): ListingSelection {
  const fields = registry?.fields ?? []

  const titleFieldKey = findByExactKey(fields, ['title'], ['string', 'text'])
    ?? findFirstByKind(fields, ['string'])
    ?? findFirstByKind(fields, ['text'])

  const descriptionFieldKey = findByExactKey(fields, ['description', 'summary', 'excerpt'], ['text', 'richtext'])
    ?? findFirstByKind(fields, ['text'])
    ?? findFirstByKind(fields, ['richtext'])

  const imageFieldKey = findByExactKey(fields, ['image', 'thumbnail', 'cover', 'gallery'], ['asset', 'asset_list'])
    ?? findFirstByKind(fields, ['asset', 'asset_list'])

  return {
    titleFieldKey,
    descriptionFieldKey,
    imageFieldKey
  }
}

export function buildListingProjection(args: {
  registry: SchemaRegistry | null
  content: Record<string, unknown>
  titleFieldKey?: string | null
  descriptionFieldKey?: string | null
  imageFieldKey?: string | null
}) {
  const inferred = inferListingSelection(args.registry)
  const configured = args.registry?.listing
  const titleFieldKey = args.titleFieldKey !== undefined
    ? args.titleFieldKey
    : hasOwn(configured, 'titleFieldKey')
      ? (configured.titleFieldKey ?? null)
      : inferred.titleFieldKey
  const descriptionFieldKey = args.descriptionFieldKey !== undefined
    ? args.descriptionFieldKey
    : hasOwn(configured, 'descriptionFieldKey')
      ? (configured.descriptionFieldKey ?? null)
      : inferred.descriptionFieldKey
  const imageFieldKey = args.imageFieldKey !== undefined
    ? args.imageFieldKey
    : hasOwn(configured, 'imageFieldKey')
      ? (configured.imageFieldKey ?? null)
      : inferred.imageFieldKey

  const rawTitle = titleFieldKey ? args.content[titleFieldKey] : null
  const title = typeof rawTitle === 'string' && rawTitle.trim().length
    ? rawTitle.trim()
    : null

  const rawDescription = descriptionFieldKey ? args.content[descriptionFieldKey] : null
  const descriptionText = normalizeText(extractRichText(rawDescription))
  const description = descriptionText
    ? (descriptionText.length > DESCRIPTION_LIMIT ? `${descriptionText.slice(0, DESCRIPTION_LIMIT)}...` : descriptionText)
    : null

  const rawImage = imageFieldKey ? args.content[imageFieldKey] : null
  const firstAssetId = typeof rawImage === 'string'
    ? rawImage
    : Array.isArray(rawImage)
      ? rawImage.map((item) => typeof item === 'string'
        ? item
        : (item && typeof item === 'object' && typeof (item as any).assetId === 'string' ? (item as any).assetId : null))
          .find(Boolean)
      : null
  const image = firstAssetId ? `/assets/${firstAssetId}/raw` : null

  return {
    title,
    description,
    image,
    titleFieldKey,
    descriptionFieldKey,
    imageFieldKey
  }
}
