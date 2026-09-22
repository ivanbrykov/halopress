import { z } from 'zod'

export const pageBlockKeys = [
  'pageHero',
  'pageCard',
  'pageSection',
  'pageTestimonial',
  'pageLogos',
  'pageFAQ',
  'pageCTA'
] as const
export type PageBlockComponentKey = typeof pageBlockKeys[number]

export type StoredPageBlockAttrs = {
  component?: unknown
  props?: unknown
  advanced?: unknown
  media?: unknown
}

export type PageBlockValidationIssue = {
  index: number
  key: string
  kind: 'unknown' | 'malformed'
  message: string
}

export const pageBlockIconKeys = [
  'i-lucide-arrow-right',
  'i-lucide-badge-check',
  'i-lucide-book-open',
  'i-lucide-circle-help',
  'i-lucide-external-link',
  'i-lucide-heart',
  'i-lucide-sparkles',
  'i-lucide-star'
] as const

export const pageBlockVariants = ['solid', 'outline', 'soft', 'subtle', 'ghost', 'naked'] as const
export const pageBlockColors = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const

export function hasUnsafePortableUrlCharacters(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (character === '\\' || code < 0x20 || code === 0x7F) return true
  }
  return false
}

export function isSafePageUrl(value: string) {
  if (!value) return true
  if (value.trim() !== value || value.startsWith('//') || hasUnsafePortableUrlCharacters(value)) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (value.startsWith('#')) return true
  try {
    const parsed = new URL(value)
    return !parsed.username
      && !parsed.password
      && ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

export function isPortablePageAssetPath(value: string) {
  if (!value) return true
  if (value.trim() !== value || !value.startsWith('/') || value.startsWith('//') || hasUnsafePortableUrlCharacters(value)) return false
  try {
    const parsed = new URL(value, 'https://portable.invalid')
    return parsed.origin === 'https://portable.invalid'
      && /^\/assets\/[A-Za-z0-9_-]+\/raw$/.test(parsed.pathname)
  } catch {
    return false
  }
}

const safeUrl = z.string().max(2048).refine(isSafePageUrl, 'Unsafe URL')

const text = z.string().max(500)
const description = z.string().max(5000)
const orientation = z.enum(['vertical', 'horizontal'])
const target = z.enum(['_self', '_blank'])
const variant = z.enum(pageBlockVariants)
const color = z.enum(pageBlockColors)
const icon = z.enum(pageBlockIconKeys)

const link = z.object({
  label: text,
  to: safeUrl,
  target: target.optional(),
  icon: icon.optional(),
  color: color.optional(),
  variant: variant.optional()
})

const heroProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  links: z.array(link).max(12).optional()
})

const feature = z.object({
  title: text,
  description: description.optional(),
  icon: icon.optional(),
  orientation: orientation.optional(),
  to: safeUrl.optional(),
  target: target.optional()
})

const sectionProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  icon: icon.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  features: z.array(feature).max(6).optional(),
  links: z.array(link).max(12).optional()
})

const testimonialProps = z.object({
  quote: description.optional(),
  author: text.optional(),
  role: text.optional(),
  company: text.optional()
})

const logoItem = z.object({
  name: text,
  src: safeUrl.optional(),
  alt: text.optional()
})

const logosProps = z.object({
  title: text.optional(),
  items: z.array(logoItem).max(12).optional()
})

const faqItem = z.object({
  question: text,
  answer: description
})

const faqProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  items: z.array(faqItem).max(12).optional()
})

const heroPatternProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  links: z.array(link.strict()).max(12).optional()
}).strict()

const sectionPatternProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  icon: icon.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  features: z.array(feature.strict()).max(6).optional(),
  links: z.array(link.strict()).max(12).optional()
}).strict()

const logosPatternProps = z.object({
  title: text.optional(),
  items: z.array(logoItem.strict()).max(12).optional()
}).strict()

const faqPatternProps = z.object({
  headline: text.optional(),
  title: text.optional(),
  description: description.optional(),
  items: z.array(faqItem.strict()).max(12).optional()
}).strict()

const ctaPatternProps = z.object({
  title: text.optional(),
  description: description.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  variant: variant.optional(),
  links: z.array(link.strict()).max(12).optional()
}).strict()

const cardProps = z.object({
  icon: icon.optional(),
  title: text.optional(),
  description: description.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  variant: variant.optional(),
  highlight: z.boolean().optional(),
  highlightColor: color.optional(),
  spotlight: z.boolean().optional(),
  spotlightColor: color.optional(),
  to: safeUrl.optional(),
  target: target.optional()
})

const ctaProps = z.object({
  title: text.optional(),
  description: description.optional(),
  orientation: orientation.optional(),
  reverse: z.boolean().optional(),
  variant: variant.optional(),
  links: z.array(link).max(12).optional()
})

const media = z.object({
  url: safeUrl.optional(),
  alt: z.string().max(500).optional(),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  requiredAction: z.string().max(500).optional()
})

function hasPortableAssetPaths(
  key: PageBlockComponentKey,
  props: Record<string, unknown>,
  blockMedia: z.infer<typeof media>
) {
  if (blockMedia.url && !isPortablePageAssetPath(blockMedia.url)) return false
  if (key !== 'pageLogos') return true
  return (Array.isArray(props.items) ? props.items : []).every((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const src = (candidate as Record<string, unknown>).src
    return typeof src !== 'string' || isPortablePageAssetPath(src)
  })
}

const definitions = {
  pageHero: {
    defaultProps: { title: 'New Hero', description: '' },
    propsSchema: heroProps,
    patternPropsSchema: heroPatternProps
  },
  pageCard: {
    defaultProps: { title: 'New Card', description: '' },
    propsSchema: cardProps,
    patternPropsSchema: cardProps.strict()
  },
  pageSection: {
    defaultProps: { title: 'New Section', description: '' },
    propsSchema: sectionProps,
    patternPropsSchema: sectionPatternProps
  },
  pageTestimonial: {
    defaultProps: { quote: '[Add a customer quote]', author: '[Add the customer name]' },
    propsSchema: testimonialProps,
    patternPropsSchema: testimonialProps.strict()
  },
  pageLogos: {
    defaultProps: { title: 'Trusted by teams like yours', items: [] },
    propsSchema: logosProps,
    patternPropsSchema: logosPatternProps
  },
  pageFAQ: {
    defaultProps: { title: 'Frequently asked questions', items: [] },
    propsSchema: faqProps,
    patternPropsSchema: faqPatternProps
  },
  pageCTA: {
    defaultProps: { title: 'New CTA', description: '', variant: 'outline' },
    propsSchema: ctaProps,
    patternPropsSchema: ctaPatternProps
  }
} as const

export const pageBlockDefinitions = definitions

export type ResolvedPageBlock =
  | {
      status: 'known'
      key: PageBlockComponentKey
      props: Record<string, unknown>
      media: z.infer<typeof media>
    }
    | {
      status: 'unknown' | 'malformed'
      key: string
      reason: string
    }

export function isPageBlockComponentKey(value: unknown): value is PageBlockComponentKey {
  return typeof value === 'string' && Object.hasOwn(definitions, value)
}

const portablePropKeys = [
  'headline',
  'title',
  'description',
  'orientation',
  'reverse',
  'links',
  'icon',
  'features',
  'quote',
  'author',
  'role',
  'company',
  'items',
  'variant',
  'highlight',
  'highlightColor',
  'spotlight',
  'spotlightColor',
  'to',
  'target'
] as const
const portableLinkKeys = ['label', 'to', 'target', 'icon', 'color', 'variant'] as const
const portableFeatureKeys = ['title', 'description', 'icon', 'orientation', 'to', 'target'] as const
const portableItemKeys = ['name', 'src', 'alt', 'question', 'answer'] as const
const portableMediaKeys = ['url', 'alt', 'width', 'height', 'requiredAction'] as const

function selectPortableKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
) {
  const selected: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    if (Object.hasOwn(value, key)) selected[key] = value[key]
  }
  return selected
}

function normalizedBlockInput(attrs: unknown, tolerateLegacyIcons: boolean) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    return { status: 'unknown', key: '', reason: 'Unsupported page block' }
  }
  const blockAttrs = attrs as StoredPageBlockAttrs
  const key = typeof blockAttrs.component === 'string' ? blockAttrs.component : ''
  if (!isPageBlockComponentKey(key)) {
    return { status: 'unknown', key, reason: 'Unsupported page block' }
  }

  const definition = definitions[key]
  const rawProps = blockAttrs.props && typeof blockAttrs.props === 'object' && !Array.isArray(blockAttrs.props)
    ? blockAttrs.props as Record<string, unknown>
    : {}
  const boundedCollections = [rawProps.links, rawProps.items]
  if (key === 'pageSection') boundedCollections.push(rawProps.features)
  if (boundedCollections.some(value => Array.isArray(value) && value.length > 12)) {
    return { status: 'malformed', key, reason: 'Invalid page block properties' }
  }

  const props = tolerateLegacyIcons ? normalizeLegacyProps(rawProps) : rawProps
  const parsedProps = definition.propsSchema.safeParse({ ...definition.defaultProps, ...props })
  const rawMedia = blockAttrs.media && typeof blockAttrs.media === 'object' && !Array.isArray(blockAttrs.media)
    ? blockAttrs.media as Record<string, unknown>
    : {}
  const parsedMedia = media.safeParse(
    tolerateLegacyIcons ? selectPortableKeys(rawMedia, portableMediaKeys) : rawMedia
  )
  if (!parsedProps.success || !parsedMedia.success) {
    return { status: 'malformed', key, reason: 'Invalid page block properties' }
  }

  return {
    status: 'known',
    key,
    props: parsedProps.data,
    media: parsedMedia.data
  }
}

function hasPortableIcon(value: unknown) {
  return typeof value === 'string' && (pageBlockIconKeys as readonly string[]).includes(value)
}

function normalizeLegacyProps(rawProps: Record<string, unknown>) {
  const props = selectPortableKeys(rawProps, portablePropKeys)
  if (props.icon !== undefined && !hasPortableIcon(props.icon)) delete props.icon
  for (const key of ['links', 'features'] as const) {
    if (!Array.isArray(props[key])) continue
    props[key] = props[key].map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
      const item = selectPortableKeys(
        candidate as Record<string, unknown>,
        key === 'links' ? portableLinkKeys : portableFeatureKeys
      )
      if (item.icon !== undefined && !hasPortableIcon(item.icon)) delete item.icon
      return item
    })
  }
  if (Array.isArray(props.items)) {
    props.items = props.items.map(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? selectPortableKeys(candidate as Record<string, unknown>, portableItemKeys)
      : candidate)
  }
  return props
}

export function resolvePageBlock(attrs: unknown): ResolvedPageBlock {
  return normalizedBlockInput(attrs, false) as ResolvedPageBlock
}

export function resolvePageBlockForDelivery(attrs: unknown): ResolvedPageBlock {
  return normalizedBlockInput(attrs, true) as ResolvedPageBlock
}

export function isValidCuratedPageBlockAttrs(attrs: StoredPageBlockAttrs) {
  const allowedAttrs = new Set(['component', 'props', 'advanced', 'media'])
  if (Object.keys(attrs).some(key => !allowedAttrs.has(key))) return false
  const key = typeof attrs.component === 'string' ? attrs.component : ''
  if (!isPageBlockComponentKey(key)) return false
  if (!attrs.props || typeof attrs.props !== 'object' || Array.isArray(attrs.props)) return false
  if (attrs.advanced !== undefined) {
    if (!attrs.advanced || typeof attrs.advanced !== 'object' || Array.isArray(attrs.advanced)) return false
    if (Object.keys(attrs.advanced as Record<string, unknown>).length) return false
  }
  const rawMedia = attrs.media ?? {}
  if (!rawMedia || typeof rawMedia !== 'object' || Array.isArray(rawMedia)) return false
  const parsedProps = definitions[key].patternPropsSchema.safeParse(attrs.props)
  const parsedMedia = media.strict().safeParse(rawMedia)
  return parsedProps.success
    && parsedMedia.success
    && hasPortableAssetPaths(key, parsedProps.data as Record<string, unknown>, parsedMedia.data)
}

export function validatePageDocumentBlocks(
  value: unknown,
  options: { allowUnknown?: boolean } = {}
): PageBlockValidationIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const content = (value as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  const issues: PageBlockValidationIssue[] = []
  content.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
    const node = candidate as Record<string, unknown>
    if (node.type !== 'pageBlock') return
    const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
      ? node.attrs as StoredPageBlockAttrs
      : {}
    const resolved = resolvePageBlock(attrs)
    if (resolved.status === 'known') {
      if (hasPortableAssetPaths(resolved.key, resolved.props, resolved.media)) return
      issues.push({
        index,
        key: resolved.key,
        kind: 'malformed',
        message: `Block ${index + 1} (${resolved.key}) must use site-owned /assets/:id/raw media paths.`
      })
      return
    }
    if (resolved.status === 'unknown' && options.allowUnknown) return
    issues.push({
      index,
      key: resolved.key,
      kind: resolved.status,
      message: resolved.status === 'unknown'
        ? `Block ${index + 1} uses an unsupported component${resolved.key ? ` (${resolved.key})` : ''}.`
        : `Block ${index + 1}${resolved.key ? ` (${resolved.key})` : ''} has invalid properties.`
    })
  })
  return issues
}
