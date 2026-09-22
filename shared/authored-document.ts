import {
  isPortablePageAssetPath,
  isSafePageUrl,
  resolvePageBlockForDelivery,
  type StoredPageBlockAttrs
} from './page-blocks'

export const AUTHORED_DOCUMENT_MAX_DEPTH = 32
export const AUTHORED_DOCUMENT_MAX_NODES = 2_000
export const AUTHORED_DOCUMENT_MAX_MARKS = 4_096
export const AUTHORED_DOCUMENT_MAX_OUTLINE_ENTRIES = 128
export const AUTHORED_DOCUMENT_MAX_TEXT_LENGTH = 512 * 1024

export type AuthoredOutlineEntry = {
  id: string
  level: 1 | 2 | 3 | 4
  text: string
}

export type AuthoredDocumentMark =
  | { type: 'bold' | 'italic' | 'strike' | 'code' | 'underline' }
  | { type: 'link', href: string, target?: '_blank' }

export type AuthoredTextNode = {
  type: 'text'
  text: string
  marks: AuthoredDocumentMark[]
}

export type AuthoredContainerNode = {
  type: 'paragraph' | 'blockquote' | 'bulletList' | 'listItem' | 'codeBlock'
  content: AuthoredDocumentNode[]
  textAlign?: 'left' | 'center' | 'right' | 'justify'
}

export type AuthoredOrderedListNode = {
  type: 'orderedList'
  content: AuthoredDocumentNode[]
  start?: number
}

export type AuthoredHeadingNode = {
  type: 'heading'
  content: AuthoredDocumentNode[]
  level: 1 | 2 | 3 | 4
  id: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
}

export type AuthoredImageNode = {
  type: 'image'
  src: string
  alt: string
  title?: string
  width?: number
  height?: number
}

export type AuthoredMentionNode = {
  type: 'mention'
  label: string
}

export type AuthoredPageBlockNode = {
  type: 'pageBlock'
  attrs: StoredPageBlockAttrs
  anchorId?: string
}

export type AuthoredPageHeroNode = {
  type: 'pageHero'
  orientation: 'vertical' | 'horizontal'
  reverse: boolean
  content: AuthoredDocumentNode[]
}

export type AuthoredDocumentNode =
  | AuthoredTextNode
  | AuthoredContainerNode
  | AuthoredOrderedListNode
  | AuthoredHeadingNode
  | AuthoredImageNode
  | AuthoredMentionNode
  | AuthoredPageBlockNode
  | AuthoredPageHeroNode
  | { type: 'fallback', message: string }
  | { type: 'hardBreak' | 'horizontalRule' }

export type NormalizedAuthoredDocument = {
  type: 'doc'
  content: AuthoredDocumentNode[]
  outline: AuthoredOutlineEntry[]
  truncated: boolean
}

export type AuthoredSchemaField = {
  fieldId: string
  key: string
  kind: string
}

type NormalizeOptions = {
  allowPageBlocks?: boolean
  allowPageHero?: boolean
  headingIdPrefix?: string
}

const plainMarkTypes = new Set(['bold', 'italic', 'strike', 'code', 'underline'])
const containerTypes = new Set(['paragraph', 'blockquote', 'bulletList', 'listItem', 'codeBlock'])
const alignments = new Set(['left', 'center', 'right', 'justify'])
const inlineNodeTypes = new Set(['text', 'hardBreak', 'image', 'mention'])

type AuthoredNodeContext = 'block' | 'inline' | 'list' | 'code'

class AuthoredNormalizationBudgetError extends Error {}

class AuthoredNormalizationBudget {
  nodes = 0
  marks = 0
  textLength = 0

  claimNode(depth: number) {
    this.nodes += 1
    if (depth > AUTHORED_DOCUMENT_MAX_DEPTH || this.nodes > AUTHORED_DOCUMENT_MAX_NODES) {
      throw new AuthoredNormalizationBudgetError('Authored document normalization budget exceeded')
    }
  }

  claimMark() {
    this.marks += 1
    if (this.marks > AUTHORED_DOCUMENT_MAX_MARKS) {
      throw new AuthoredNormalizationBudgetError('Authored document normalization budget exceeded')
    }
  }

  claimText(value: string) {
    this.textLength += value.length
    if (this.textLength > AUTHORED_DOCUMENT_MAX_TEXT_LENGTH) {
      throw new AuthoredNormalizationBudgetError('Authored document normalization budget exceeded')
    }
  }
}

class AuthoredHeadingRegistry {
  private readonly counts = new Map<string, number>()
  readonly outline: AuthoredOutlineEntry[] = []

  constructor(private readonly prefix: string) {}

  add(level: 1 | 2 | 3 | 4, content: AuthoredDocumentNode[], includeOutline = true) {
    return this.addText(level, authoredNodeText(content), includeOutline)
  }

  addText(level: 1 | 2 | 3 | 4, value: string, includeOutline = true) {
    const text = value.replace(/\s+/g, ' ').trim().slice(0, 200)
    const base = authoredHeadingSlug(text)
    const count = (this.counts.get(base) ?? 0) + 1
    this.counts.set(base, count)
    const suffix = count === 1 ? '' : `-${count}`
    const id = `${this.prefix}-${base.slice(0, Math.max(1, 127 - this.prefix.length - suffix.length))}${suffix}`
    if (includeOutline && text && this.outline.length < AUTHORED_DOCUMENT_MAX_OUTLINE_ENTRIES) {
      this.outline.push({ id, level, text })
    }
    return id
  }
}

function authoredHeadingSlug(value: string) {
  const slug = value.normalize('NFKD').toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '')
  return slug || 'section'
}

export function normalizeAuthoredHeadingPrefix(value: unknown) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)
    ? value
    : 'halo-heading'
}

function authoredHeadingFieldDiscriminator(fieldId: string, fieldKey: string) {
  const value = `${fieldId}\u0000${fieldKey}`
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function authoredFieldHeadingPrefix(fieldId: string, fieldKey: string, prefix?: string) {
  return [
    normalizeAuthoredHeadingPrefix(prefix).slice(0, 16),
    authoredHeadingSlug(fieldKey).slice(0, 12),
    authoredHeadingFieldDiscriminator(fieldId, fieldKey)
  ].join('-').slice(0, 48)
}

function authoredNodeText(value: AuthoredDocumentNode[], limit = 200) {
  let text = ''
  const stack = [...value].reverse()
  while (stack.length && text.length < limit) {
    const node = stack.pop()!
    if (node.type === 'text') {
      text += node.text.slice(0, limit - text.length)
      continue
    }
    if ('content' in node) {
      for (let index = node.content.length - 1; index >= 0; index -= 1) stack.push(node.content[index]!)
    }
  }
  return text
}

function fallbackNode(type: string): Extract<AuthoredDocumentNode, { type: 'fallback' }> {
  return { type: 'fallback', message: `[Unsupported content: ${type || 'unknown'}]` }
}

function contextualFallbackNode(type: string, nodeContext: AuthoredNodeContext): AuthoredDocumentNode {
  const text = `[Unsupported content: ${type || 'unknown'}]`
  if (nodeContext === 'inline' || nodeContext === 'code') return { type: 'text', text, marks: [] }
  if (nodeContext === 'list') {
    return {
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [] }] }]
    }
  }
  return fallbackNode(type)
}

function safeStoredUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048 || !isSafePageUrl(value)) return null
  return value
}

function safeStoredAssetUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 2_048 || !isPortablePageAssetPath(value)) return null
  return value
}

function normalizeMarks(value: unknown, budget: AuthoredNormalizationBudget): AuthoredDocumentMark[] {
  if (!Array.isArray(value)) return []
  const marks: AuthoredDocumentMark[] = []
  const plainMarks = new Set<string>()
  let hasLink = false
  for (const candidate of value) {
    budget.claimMark()
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const mark = candidate as Record<string, any>
    if (plainMarkTypes.has(mark.type)) {
      if (plainMarks.has(mark.type)) continue
      plainMarks.add(mark.type)
      marks.push({ type: mark.type as 'bold' | 'italic' | 'strike' | 'code' | 'underline' })
      continue
    }
    if (mark.type !== 'link' || hasLink) continue
    const href = safeStoredUrl(mark.attrs?.href)
    if (!href) continue
    marks.push({ type: 'link', href, ...(mark.attrs?.target === '_blank' ? { target: '_blank' as const } : {}) })
    hasLink = true
  }
  return marks
}

function normalizeImage(node: Record<string, any>): AuthoredImageNode | Extract<AuthoredDocumentNode, { type: 'fallback' }> {
  const src = safeStoredAssetUrl(node.attrs?.src)
  if (!src) return fallbackNode('image')
  const width = Number.isSafeInteger(node.attrs?.width) && node.attrs.width > 0 && node.attrs.width <= 10_000
    ? node.attrs.width
    : undefined
  const height = Number.isSafeInteger(node.attrs?.height) && node.attrs.height > 0 && node.attrs.height <= 10_000
    ? node.attrs.height
    : undefined
  return {
    type: 'image',
    src,
    alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt.slice(0, 500) : '',
    ...(typeof node.attrs?.title === 'string' && node.attrs.title
      ? { title: node.attrs.title.slice(0, 500) }
      : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {})
  }
}

function normalizePageBlockProps(key: string, props: Record<string, unknown>) {
  if (key !== 'pageLogos' || !Array.isArray(props.items)) return props
  return {
    ...props,
    items: props.items.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
      const item = candidate as Record<string, unknown>
      if (typeof item.src !== 'string' || isPortablePageAssetPath(item.src)) return item
      const safeItem = { ...item }
      delete safeItem.src
      return safeItem
    })
  }
}

function normalizePageBlockMedia(media: Record<string, unknown>) {
  if (typeof media.url !== 'string' || isPortablePageAssetPath(media.url)) return media
  const safeMedia = { ...media }
  delete safeMedia.url
  return safeMedia
}

function isPageHeroSequence(content: AuthoredDocumentNode[]) {
  let index = 0
  if (content[index]?.type === 'paragraph') index += 1
  if (content[index]?.type !== 'heading') return false
  index += 1
  let paragraphs = 0
  while (content[index]?.type === 'paragraph') {
    paragraphs += 1
    index += 1
  }
  if (!paragraphs) return false
  if (content[index]?.type === 'image') index += 1
  return index === content.length
}

function normalizeNode(
  value: unknown,
  context: {
    budget: AuthoredNormalizationBudget
    headings: AuthoredHeadingRegistry
    visiting: WeakSet<object>
    options: NormalizeOptions
  },
  depth: number,
  topLevel: boolean,
  nodeContext: AuthoredNodeContext
): AuthoredDocumentNode {
  context.budget.claimNode(depth)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return contextualFallbackNode('unknown', nodeContext)
  if (context.visiting.has(value)) throw new AuthoredNormalizationBudgetError('Cyclic authored document')
  context.visiting.add(value)
  try {
    const node = value as Record<string, any>
    const type = typeof node.type === 'string' ? node.type : ''
    if (nodeContext === 'inline' && !inlineNodeTypes.has(type)) return contextualFallbackNode(type, nodeContext)
    if (nodeContext === 'list' && type !== 'listItem') return contextualFallbackNode(type, nodeContext)
    if (nodeContext === 'block' && type === 'listItem') return contextualFallbackNode(type, nodeContext)
    if (nodeContext === 'code' && type !== 'text' && type !== 'hardBreak') {
      return contextualFallbackNode(type, nodeContext)
    }
    if (type === 'text') {
      const text = typeof node.text === 'string' ? node.text : ''
      context.budget.claimText(text)
      return {
        type: 'text',
        text,
        marks: nodeContext === 'code' ? [] : normalizeMarks(node.marks, context.budget)
      }
    }
    if (type === 'hardBreak' || type === 'horizontalRule') return { type }
    if (type === 'image') return normalizeImage(node)
    if (type === 'mention') {
      const label = typeof node.attrs?.label === 'string'
        ? node.attrs.label
        : typeof node.attrs?.id === 'string' ? node.attrs.id : 'mention'
      return { type: 'mention', label: label.slice(0, 200) }
    }
    if (type === 'pageBlock') {
      if (!topLevel || !context.options.allowPageBlocks) return fallbackNode(type)
      const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
        ? node.attrs as StoredPageBlockAttrs
        : {}
      const resolved = resolvePageBlockForDelivery(attrs)
      if (resolved.status !== 'known') return { type: 'pageBlock', attrs }
      const deliveryAttrs: StoredPageBlockAttrs = {
        component: resolved.key,
        props: normalizePageBlockProps(resolved.key, resolved.props),
        advanced: {},
        media: normalizePageBlockMedia(resolved.media)
      }
      const title = typeof resolved.props.title === 'string' ? resolved.props.title : ''
      const headingLevel = resolved.key === 'pageHero' ? 1 : 2
      const anchorId = title ? context.headings.addText(headingLevel, title) : undefined
      if (resolved.key === 'pageSection' && Array.isArray(resolved.props.features)) {
        for (const feature of resolved.props.features) {
          const featureTitle = feature && typeof feature === 'object' && !Array.isArray(feature)
            && typeof (feature as Record<string, unknown>).title === 'string'
            ? (feature as Record<string, string>).title ?? ''
            : ''
          context.headings.addText(3, featureTitle, false)
        }
      }
      return { type: 'pageBlock', attrs: deliveryAttrs, ...(anchorId ? { anchorId } : {}) }
    }
    if (type === 'pageHero') {
      if (!topLevel || !context.options.allowPageHero || !Array.isArray(node.content)) return fallbackNode(type)
      if (node.content.some((child: unknown) => child && typeof child === 'object' && !Array.isArray(child)
        && (child as Record<string, unknown>).type === 'imageUpload')) return fallbackNode(type)
      const content = node.content.map((child: unknown) => normalizeNode(child, context, depth + 1, false, 'block'))
      if (!isPageHeroSequence(content)) return fallbackNode(type)
      return {
        type: 'pageHero',
        orientation: node.attrs?.orientation === 'horizontal' ? 'horizontal' : 'vertical',
        reverse: node.attrs?.reverse === true,
        content
      }
    }
    if (type !== 'heading' && type !== 'orderedList' && !containerTypes.has(type)) {
      return contextualFallbackNode(type, nodeContext)
    }

    const childContext: AuthoredNodeContext = type === 'paragraph' || type === 'heading'
      ? 'inline'
      : type === 'bulletList' || type === 'orderedList'
        ? 'list'
        : type === 'codeBlock'
          ? 'code'
          : 'block'
    const children = Array.isArray(node.content)
      ? node.content.map((child: unknown) => normalizeNode(child, context, depth + 1, false, childContext))
      : []
    const textAlign = ['paragraph', 'heading'].includes(type) && alignments.has(node.attrs?.textAlign)
      ? node.attrs.textAlign as AuthoredContainerNode['textAlign']
      : undefined
    if (type === 'heading') {
      const level = [1, 2, 3, 4].includes(node.attrs?.level) ? node.attrs.level as 1 | 2 | 3 | 4 : 2
      return {
        type: 'heading',
        content: children,
        level,
        id: context.headings.add(level, children),
        ...(textAlign ? { textAlign } : {})
      }
    }
    if (type === 'orderedList') {
      const start = Number.isSafeInteger(node.attrs?.start) && node.attrs.start > 0 && node.attrs.start <= 100_000
        ? node.attrs.start
        : undefined
      return { type: 'orderedList', content: children, ...(start ? { start } : {}) }
    }
    if (containerTypes.has(type)) {
      return {
        type: type as AuthoredContainerNode['type'],
        content: children,
        ...(textAlign ? { textAlign } : {})
      }
    }
    return fallbackNode(type)
  } finally {
    context.visiting.delete(value)
  }
}

export function normalizeAuthoredDocument(value: unknown, options: NormalizeOptions = {}): NormalizedAuthoredDocument {
  const headings = new AuthoredHeadingRegistry(normalizeAuthoredHeadingPrefix(options.headingIdPrefix))
  const context = {
    budget: new AuthoredNormalizationBudget(),
    headings,
    visiting: new WeakSet<object>(),
    options
  }
  try {
    if (typeof value === 'string') {
      context.budget.claimText(value)
      return {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: value, marks: [] }] }],
        outline: [],
        truncated: false
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { type: 'doc', content: [fallbackNode('document')], outline: [], truncated: false }
    }
    const document = value as Record<string, unknown>
    if (document.type !== 'doc' || !Array.isArray(document.content)) {
      return { type: 'doc', content: [fallbackNode('document')], outline: [], truncated: false }
    }
    const content = document.content.map(node => normalizeNode(node, context, 1, true, 'block'))
    return { type: 'doc', content, outline: headings.outline, truncated: false }
  } catch (error) {
    if (!(error instanceof AuthoredNormalizationBudgetError)) throw error
    return {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Content exceeds rendering limits', marks: [] }]
      }],
      outline: [],
      truncated: true
    }
  }
}

export function extractAuthoredOutline(value: unknown, options: NormalizeOptions = {}) {
  return normalizeAuthoredDocument(value, options).outline
}

export function extractStructuredAuthoredOutline(
  content: Record<string, unknown>,
  schemaFields: AuthoredSchemaField[]
) {
  const outline: AuthoredOutlineEntry[] = []
  const fields: unknown[] = Array.isArray(schemaFields) ? schemaFields : []
  let renderedFields = 0
  for (const candidate of fields.slice(0, 4_096)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const field = candidate as Record<string, unknown>
    if (field.kind !== 'richtext'
      || typeof field.fieldId !== 'string' || !field.fieldId || field.fieldId.length > 256
      || typeof field.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,255}$/.test(field.key)) continue
    renderedFields += 1
    if (renderedFields > 256) break
    const normalized = normalizeAuthoredDocument(content[field.key], {
      headingIdPrefix: authoredFieldHeadingPrefix(field.fieldId, field.key)
    })
    outline.push(...normalized.outline.slice(0, AUTHORED_DOCUMENT_MAX_OUTLINE_ENTRIES - outline.length))
    if (outline.length >= AUTHORED_DOCUMENT_MAX_OUTLINE_ENTRIES) break
  }
  return outline
}
