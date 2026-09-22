import {
  hasUnsafePortableUrlCharacters,
  isPortablePageAssetPath,
  resolvePageBlockForDelivery,
  type pageBlockIconKeys,
  type StoredPageBlockAttrs
} from './page-blocks'
import {
  authoredFieldHeadingPrefix,
  extractAuthoredOutline,
  normalizeAuthoredDocument
} from './authored-document'

export const PORTABLE_CONTENT_CONTRACT_VERSION = 1 as const
export const PORTABLE_CONTENT_STYLESHEET_REVISION = 'dfea71d319d9c7d0a48d19346c115d3bd32a51e0b88f30e4c344cb454b9ea3f1'
export const PORTABLE_CONTENT_STYLESHEET_PATH = `/_halo/content/v1/${PORTABLE_CONTENT_STYLESHEET_REVISION}.css`
export const PORTABLE_CONTENT_THEME_REVISION = 'default'

export type PortableThemeArtifact = {
  revision: string
  stylesheetRevision: string
  stylesheetUrl: string
  colorMode: 'system' | 'light' | 'dark'
}

export type PortableRenderingBase = {
  contractVersion: typeof PORTABLE_CONTENT_CONTRACT_VERSION
  stylesheets: string[]
  themeRevision: string
  themeColorMode?: 'system' | 'light' | 'dark'
}

export type PortableDocumentRendering = PortableRenderingBase & {
  html: string
  outline: PortableOutlineEntry[]
}

export type PortableRichTextFieldRendering = {
  fieldId: string
  fieldKey: string
  html: string
  outline: PortableOutlineEntry[]
}

export type PortableStructuredContentRendering = PortableRenderingBase & {
  fields: Record<string, PortableRichTextFieldRendering>
  outline: PortableOutlineEntry[]
  truncated?: true
}

export type PortableOutlineEntry = {
  id: string
  level: 1 | 2 | 3 | 4
  text: string
}

export type PortableRenderLimits = {
  maxDepth: number
  maxNodes: number
  maxMarks: number
  maxFields: number
  maxSchemaFields: number
  maxOutputLength: number
}

export type PortableRenderOptions = {
  origin: string
  limits?: Partial<PortableRenderLimits>
  theme?: PortableThemeArtifact
  headingIdPrefix?: string
}

export type PortableSchemaField = {
  fieldId: string
  key: string
  kind: string
}

const defaultLimits: PortableRenderLimits = {
  maxDepth: 32,
  maxNodes: 2_000,
  maxMarks: 4_096,
  maxFields: 256,
  maxSchemaFields: 4_096,
  maxOutputLength: 512 * 1024
}

const PORTABLE_OUTLINE_LIMIT = 128

function normalizedHeadingPrefix(value: unknown) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)
    ? value
    : 'halo-heading'
}

function portableHeadingSlug(value: string) {
  const slug = value.normalize('NFKD').toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '')
  return slug || 'section'
}

function portableHeadingFieldDiscriminator(fieldId: string, fieldKey: string) {
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

function portablePlainText(value: unknown, limit = 200): string {
  let text = ''
  const stack: Array<{ candidate: unknown, depth: number }> = [{ candidate: value, depth: 0 }]
  const visited = new WeakSet<object>()
  let nodes = 0
  while (stack.length && text.length < limit && nodes < 256) {
    const entry = stack.pop()!
    const candidate = entry.candidate
    if (entry.depth > 32 || !candidate || typeof candidate !== 'object') continue
    if (visited.has(candidate)) continue
    visited.add(candidate)
    nodes += 1
    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push({ candidate: candidate[index], depth: entry.depth + 1 })
      }
      continue
    }
    const node = candidate as Record<string, unknown>
    if (typeof node.text === 'string') text += node.text.slice(0, limit - text.length)
    if (Array.isArray(node.content)) {
      stack.push({ candidate: node.content, depth: entry.depth + 1 })
    }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

class PortableHeadingRegistry {
  private readonly counts = new Map<string, number>()
  readonly outline: PortableOutlineEntry[] = []

  constructor(private readonly prefix: string) {}

  add(level: number, value: unknown) {
    const text = (typeof value === 'string' ? value : portablePlainText(value)).replace(/\s+/g, ' ').trim().slice(0, 200)
    const base = portableHeadingSlug(text)
    const count = (this.counts.get(base) ?? 0) + 1
    this.counts.set(base, count)
    const suffix = count === 1 ? '' : `-${count}`
    const id = `${this.prefix}-${base.slice(0, Math.max(1, 127 - this.prefix.length - suffix.length))}${suffix}`
    if (text && this.outline.length < PORTABLE_OUTLINE_LIMIT && [1, 2, 3, 4].includes(level)) {
      this.outline.push({ id, level: level as PortableOutlineEntry['level'], text })
    }
    return id
  }

  reset() {
    this.counts.clear()
    this.outline.splice(0)
  }
}

const plainMarkTags: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 's',
  code: 'code',
  underline: 'u'
}

const supportedAlignments = new Set(['left', 'center', 'right', 'justify'])

const portableIconSvg = {
  'i-lucide-arrow-right': '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
  'i-lucide-badge-check': '<path d="M7.2 3.5 12 2l4.8 1.5 2.7 4.2-.2 5-3.1 3.9L12 19l-4.2-2.4-3.1-3.9-.2-5z"></path><path d="m8.5 11.5 2.2 2.2 4.8-5"></path>',
  'i-lucide-book-open': '<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H10a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H4.5A2.5 2.5 0 0 0 2 20.5z"></path><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H14a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h5.5a2.5 2.5 0 0 1 2.5 2.5z"></path>',
  'i-lucide-circle-help': '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.8.4-1.2.9-1.2 1.8"></path><path d="M12 17h.01"></path>',
  'i-lucide-external-link': '<path d="M15 3h6v6"></path><path d="m10 14 11-11"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  'i-lucide-heart': '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"></path>',
  'i-lucide-sparkles': '<path d="m12 3-1.2 3.3L7.5 7.5l3.3 1.2L12 12l1.2-3.3 3.3-1.2-3.3-1.2z"></path><path d="m5 13-.8 2.2L2 16l2.2.8L5 19l.8-2.2L8 16l-2.2-.8z"></path><path d="m18 14-1 2.7-2.7 1L17 18.8l1 2.7 1-2.7 2.7-1-2.7-1z"></path>',
  'i-lucide-star': '<path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"></path>'
} satisfies Record<typeof pageBlockIconKeys[number], string>

class PortableRenderBudgetError extends Error {}

class PortableBudget {
  private outputLength = 0
  private nodes = 0
  private marks = 0
  private fields = 0
  exceeded = false

  constructor(private readonly limits: PortableRenderLimits) {}

  claimNode(depth: number) {
    this.nodes += 1
    if (depth > this.limits.maxDepth || this.nodes > this.limits.maxNodes) {
      this.exceeded = true
      throw new PortableRenderBudgetError('Portable rendering budget exceeded')
    }
  }

  claimMark() {
    this.marks += 1
    if (this.marks > this.limits.maxMarks) {
      this.exceeded = true
      throw new PortableRenderBudgetError('Portable rendering budget exceeded')
    }
  }

  claimField(fieldId: string, fieldKey: string) {
    this.fields += 1
    if (this.fields > this.limits.maxFields) {
      this.exceeded = true
      throw new PortableRenderBudgetError('Portable rendering budget exceeded')
    }
    this.charge(fieldId.length + fieldKey.length + 64)
  }

  charge(length: number) {
    this.outputLength += length
    if (this.outputLength > this.limits.maxOutputLength) {
      this.exceeded = true
      throw new PortableRenderBudgetError('Portable rendering budget exceeded')
    }
  }

  remainingOutput() {
    return this.limits.maxOutputLength - this.outputLength
  }

  checkpoint() {
    return {
      outputLength: this.outputLength,
      nodes: this.nodes,
      marks: this.marks,
      fields: this.fields
    }
  }

  recover(checkpoint: ReturnType<PortableBudget['checkpoint']>) {
    this.outputLength = checkpoint.outputLength
    this.nodes = checkpoint.nodes
    this.marks = checkpoint.marks
    this.fields = checkpoint.fields
    this.exceeded = true
  }

  markExceeded() {
    this.exceeded = true
  }

  reject(): never {
    this.exceeded = true
    throw new PortableRenderBudgetError('Portable rendering budget exceeded')
  }
}

class PortableWriter {
  private readonly parts: string[] = []

  constructor(private readonly budget: PortableBudget, private readonly headings: PortableHeadingRegistry) {}

  claimNode(depth: number) {
    this.budget.claimNode(depth)
  }

  claimMark() {
    this.budget.claimMark()
  }

  push(value: string) {
    this.budget.charge(value.length)
    this.parts.push(value)
  }

  escaped(value: unknown) {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (text.length > this.budget.remainingOutput()) {
      this.budget.reject()
    }
    this.push(escapePortableHtml(text))
  }

  attribute(name: string, value: string | number | undefined) {
    if (value === undefined) return
    this.push(` ${name}="`)
    this.escaped(value)
    this.push('"')
  }

  headingId(level: number, value: unknown) {
    return this.headings.add(level, value)
  }

  toString() {
    return this.parts.join('')
  }
}

function renderingLimits(limits: PortableRenderOptions['limits']): PortableRenderLimits {
  const normalized = { ...defaultLimits, ...limits }
  for (const key of Object.keys(defaultLimits) as Array<keyof PortableRenderLimits>) {
    if (!Number.isSafeInteger(normalized[key]) || normalized[key] < 1) {
      throw new TypeError(`Invalid portable rendering limit: ${key}`)
    }
  }
  return normalized
}

export function escapePortableHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  })[character]!)
}

export function normalizePortableOrigin(value: string) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new TypeError('Portable rendering requires a trusted HTTP(S) origin')
  }
  return parsed.origin
}

export function resolvePortableLinkUrl(value: unknown, origin: string) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate
    || candidate.length > 2_048
    || candidate.startsWith('//')
    || hasUnsafePortableUrlCharacters(candidate)) return null
  if (candidate.startsWith('#')) return candidate
  try {
    const parsed = new URL(candidate, normalizePortableOrigin(origin))
    if (parsed.username || parsed.password) return null
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return null
    return parsed.href
  } catch {
    return null
  }
}

export function resolvePortableAssetUrl(value: unknown, origin: string) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate
    || candidate.length > 2_048
    || candidate.startsWith('//')
    || hasUnsafePortableUrlCharacters(candidate)) return null
  try {
    const trustedOrigin = normalizePortableOrigin(origin)
    const parsed = new URL(candidate, trustedOrigin)
    if (parsed.username || parsed.password) return null
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== trustedOrigin) return null
    return parsed.href
  } catch {
    return null
  }
}

export function resolvePortablePageAssetUrl(value: unknown, origin: string) {
  const resolved = resolvePortableAssetUrl(value, origin)
  if (!resolved) return null
  const parsed = new URL(resolved)
  return isPortablePageAssetPath(`${parsed.pathname}${parsed.search}${parsed.hash}`) ? resolved : null
}

export function portableStylesheetUrl(origin: string) {
  return new URL(PORTABLE_CONTENT_STYLESHEET_PATH, normalizePortableOrigin(origin)).href
}

function normalizePortableThemeArtifact(theme: PortableThemeArtifact | undefined, origin: string) {
  if (!theme
    || !/^[0-9a-f]{64}$/.test(theme.revision)
    || !/^[0-9a-f]{64}$/.test(theme.stylesheetRevision)) return null
  try {
    const trustedOrigin = normalizePortableOrigin(origin)
    const url = new URL(theme.stylesheetUrl)
    if (url.origin !== trustedOrigin
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== `/_halo/theme/v1/${theme.stylesheetRevision}.css`) return null
    if (!['system', 'light', 'dark'].includes(theme.colorMode)) return null
    return {
      revision: theme.revision,
      stylesheetRevision: theme.stylesheetRevision,
      stylesheetUrl: url.href,
      colorMode: theme.colorMode
    }
  } catch {
    return null
  }
}

function renderingBase(options: PortableRenderOptions): PortableRenderingBase {
  const theme = normalizePortableThemeArtifact(options.theme, options.origin)
  return {
    contractVersion: PORTABLE_CONTENT_CONTRACT_VERSION,
    stylesheets: [
      portableStylesheetUrl(options.origin),
      ...(theme ? [theme.stylesheetUrl] : [])
    ],
    themeRevision: theme?.revision ?? PORTABLE_CONTENT_THEME_REVISION,
    themeColorMode: theme?.colorMode ?? 'system'
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function booleanValue(value: unknown) {
  return value === true
}

function writeText(writer: PortableWriter, value: unknown) {
  writer.escaped(typeof value === 'string' ? value : '')
}

function writePortableIcon(writer: PortableWriter, value: unknown) {
  if (typeof value !== 'string' || !Object.hasOwn(portableIconSvg, value)) return false
  writer.push('<svg class="halo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">')
  writer.push(portableIconSvg[value as keyof typeof portableIconSvg])
  writer.push('</svg>')
  return true
}

function writeSafeLinkAttributes(
  writer: PortableWriter,
  href: unknown,
  target: unknown,
  origin: string
) {
  const resolved = resolvePortableLinkUrl(href, origin)
  if (!resolved) return false
  writer.attribute('href', resolved)
  if (target === '_blank') {
    writer.attribute('target', '_blank')
    writer.attribute('rel', 'noopener noreferrer')
  }
  return true
}

function writeRichTextMarks(
  writer: PortableWriter,
  text: string,
  marks: unknown,
  origin: string
) {
  const openings: string[] = []
  const closings: string[] = []
  let hasLink = false
  for (const candidate of Array.isArray(marks) ? marks : []) {
    writer.claimMark()
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const mark = candidate as Record<string, any>
    const tag = typeof mark.type === 'string' ? plainMarkTags[mark.type] : undefined
    if (tag) {
      openings.push(`<${tag}>`)
      closings.unshift(`</${tag}>`)
      continue
    }
    if (mark.type !== 'link' || hasLink) continue
    const href = resolvePortableLinkUrl(mark.attrs?.href, origin)
    if (!href) continue
    const target = mark.attrs?.target === '_blank' ? '_blank' : undefined
    let opening = `<a class="halo-link" href="${escapePortableHtml(href)}"`
    if (target) opening += ' target="_blank" rel="noopener noreferrer"'
    opening += '>'
    openings.push(opening)
    closings.unshift('</a>')
    hasLink = true
  }
  for (const opening of openings) writer.push(opening)
  writer.escaped(text)
  for (const closing of closings) writer.push(closing)
}

type PortableNodeContext = 'block' | 'inline' | 'list' | 'code'

type RichTextWriteOptions = {
  standaloneV2: boolean
  context: PortableNodeContext
}

const portableInlineNodeTypes = new Set(['text', 'hardBreak', 'image', 'mention'])

function writeRichTextChildren(
  writer: PortableWriter,
  node: Record<string, any>,
  origin: string,
  depth: number,
  options: RichTextWriteOptions,
  context: PortableNodeContext
) {
  if (!Array.isArray(node.content)) return
  for (const child of node.content) {
    writeRichTextNode(writer, child, origin, depth + 1, { ...options, context })
  }
}

function writeRichTextFallback(writer: PortableWriter, context: PortableNodeContext = 'block') {
  if (context === 'inline') {
    writer.push('<span class="halo-content-fallback" role="status">Unsupported content</span>')
    return
  }
  if (context === 'list') {
    writer.push('<li><p class="halo-content-fallback" role="status">Unsupported content</p></li>')
    return
  }
  if (context === 'code') {
    writer.push('Unsupported content')
    return
  }
  writer.push('<p class="halo-content-fallback" role="status">Unsupported content</p>')
}

function resolveRichTextAssetUrl(value: unknown, origin: string, standaloneV2: boolean) {
  if (standaloneV2 && (typeof value !== 'string' || !isPortablePageAssetPath(value))) return null
  return resolvePortableAssetUrl(value, origin)
}

function writeRichTextNode(
  writer: PortableWriter,
  value: unknown,
  origin: string,
  depth: number,
  options: RichTextWriteOptions = { standaloneV2: false, context: 'block' }
) {
  writer.claimNode(depth)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    writeRichTextFallback(writer, options.standaloneV2 ? options.context : 'block')
    return
  }
  const node = value as Record<string, any>
  const type = typeof node.type === 'string' ? node.type : ''
  if (options.standaloneV2) {
    const allowed = options.context === 'inline'
      ? portableInlineNodeTypes.has(type)
      : options.context === 'list'
        ? type === 'listItem'
        : options.context === 'code'
          ? type === 'text' || type === 'hardBreak'
          : type !== 'listItem'
    if (!allowed) {
      writeRichTextFallback(writer, options.context)
      return
    }
  }

  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text : ''
    if (options.standaloneV2 && options.context === 'code') writer.escaped(text)
    else writeRichTextMarks(writer, text, node.marks, origin)
    return
  }
  if (type === 'hardBreak') {
    writer.push('<br>')
    return
  }
  if (type === 'horizontalRule') {
    writer.push('<hr class="halo-divider">')
    return
  }
  if (type === 'image') {
    const src = resolveRichTextAssetUrl(node.attrs?.src, origin, options.standaloneV2)
    if (!src) {
      writer.push('<span class="halo-media-fallback" role="img" aria-label="Image unavailable">Image unavailable</span>')
      return
    }
    writer.push('<img class="halo-richtext-image"')
    writer.attribute('src', src)
    writer.attribute('alt', typeof node.attrs?.alt === 'string' ? node.attrs.alt.slice(0, 500) : '')
    writer.attribute('title', typeof node.attrs?.title === 'string' ? node.attrs.title.slice(0, 500) : undefined)
    const width = Number.isSafeInteger(node.attrs?.width) && node.attrs.width > 0 && node.attrs.width <= 10_000
      ? node.attrs.width
      : undefined
    const height = Number.isSafeInteger(node.attrs?.height) && node.attrs.height > 0 && node.attrs.height <= 10_000
      ? node.attrs.height
      : undefined
    writer.attribute('width', width)
    writer.attribute('height', height)
    writer.attribute('loading', 'lazy')
    writer.attribute('decoding', 'async')
    writer.push('>')
    return
  }
  if (type === 'mention') {
    writer.push('<span class="halo-mention">@')
    const label = typeof node.attrs?.label === 'string'
      ? node.attrs.label
      : typeof node.attrs?.id === 'string' ? node.attrs.id : 'mention'
    writer.escaped(label.slice(0, 200))
    writer.push('</span>')
    return
  }

  const alignment = ['heading', 'paragraph'].includes(type) && supportedAlignments.has(node.attrs?.textAlign)
    ? String(node.attrs.textAlign)
    : undefined
  if (type === 'paragraph') {
    writer.push('<p')
    writer.attribute('data-halo-align', alignment)
    writer.push('>')
    writeRichTextChildren(writer, node, origin, depth, options, 'inline')
    writer.push('</p>')
    return
  }
  if (type === 'heading') {
    const level = [1, 2, 3, 4].includes(node.attrs?.level) ? Number(node.attrs.level) : 2
    writer.push(`<h${level}`)
    // Stored author IDs are deliberately ignored. Only this deterministic,
    // code-owned allocator can create SSR anchors for portable content.
    writer.attribute('id', writer.headingId(level, node.content))
    writer.attribute('data-halo-align', alignment)
    writer.push('>')
    writeRichTextChildren(writer, node, origin, depth, options, 'inline')
    writer.push(`</h${level}>`)
    return
  }
  if (type === 'blockquote') {
    writer.push('<blockquote class="halo-blockquote">')
    writeRichTextChildren(writer, node, origin, depth, options, 'block')
    writer.push('</blockquote>')
    return
  }
  if (type === 'bulletList' || type === 'orderedList') {
    const tag = type === 'orderedList' ? 'ol' : 'ul'
    writer.push(`<${tag} class="halo-list"`)
    const start = type === 'orderedList' && Number.isSafeInteger(node.attrs?.start)
      && node.attrs.start > 0 && node.attrs.start <= 100_000
      ? node.attrs.start
      : undefined
    writer.attribute('start', start)
    writer.push('>')
    writeRichTextChildren(writer, node, origin, depth, options, 'list')
    writer.push(`</${tag}>`)
    return
  }
  if (type === 'listItem') {
    writer.push('<li>')
    writeRichTextChildren(writer, node, origin, depth, options, 'block')
    writer.push('</li>')
    return
  }
  if (type === 'codeBlock') {
    writer.push('<pre class="halo-code-block"><code>')
    writeRichTextChildren(writer, node, origin, depth, options, 'code')
    writer.push('</code></pre>')
    return
  }

  writeRichTextFallback(writer, options.standaloneV2 ? options.context : 'block')
}

function writeMedia(
  writer: PortableWriter,
  media: Record<string, unknown>,
  origin: string
) {
  const src = resolvePortablePageAssetUrl(media.url, origin)
  if (!src) {
    if ((typeof media.url === 'string' && media.url.trim()) || typeof media.requiredAction === 'string') {
      writer.push('<div class="halo-media halo-media-fallback" role="img" aria-label="Media unavailable"><span>Media unavailable</span></div>')
    }
    return
  }
  writer.push('<figure class="halo-media"><img')
  writer.attribute('src', src)
  writer.attribute('alt', typeof media.alt === 'string' ? media.alt : '')
  writer.attribute('width', typeof media.width === 'number' ? media.width : undefined)
  writer.attribute('height', typeof media.height === 'number' ? media.height : undefined)
  writer.attribute('loading', 'lazy')
  writer.attribute('decoding', 'async')
  writer.push('></figure>')
}

function writeActions(
  writer: PortableWriter,
  links: unknown,
  origin: string
) {
  if (!Array.isArray(links) || !links.length) return
  const safeLinks = links.filter(link => link && typeof link === 'object' && !Array.isArray(link)) as Array<Record<string, unknown>>
  if (!safeLinks.some(link => resolvePortableLinkUrl(link.to, origin))) return
  writer.push('<nav class="halo-actions" aria-label="Actions">')
  for (const link of safeLinks) {
    const href = resolvePortableLinkUrl(link.to, origin)
    if (!href) continue
    writer.push('<a class="halo-action"')
    writeSafeLinkAttributes(writer, href, link.target, origin)
    writer.attribute('data-halo-variant', stringValue(link.variant) || 'solid')
    writer.attribute('data-halo-color', stringValue(link.color) || 'primary')
    writer.push('>')
    writePortableIcon(writer, link.icon)
    writeText(writer, link.label)
    writer.push('</a>')
  }
  writer.push('</nav>')
}

function writeBlockHeader(
  writer: PortableWriter,
  props: Record<string, unknown>,
  headingLevel = 2
) {
  const headline = stringValue(props.headline)
  const title = stringValue(props.title)
  const description = stringValue(props.description)
  if (!headline && !title && !description) return
  writer.push('<header class="halo-block-header">')
  if (headline) {
    writer.push('<p class="halo-eyebrow">')
    writer.escaped(headline)
    writer.push('</p>')
  }
  if (title) {
    writer.push(`<h${headingLevel} class="halo-block-title"`)
    writer.attribute('id', writer.headingId(headingLevel, title))
    writer.push('>')
    writer.escaped(title)
    writer.push(`</h${headingLevel}>`)
  }
  if (description) {
    writer.push('<p class="halo-block-description">')
    writer.escaped(description)
    writer.push('</p>')
  }
  writer.push('</header>')
}

function writeBlockShellStart(
  writer: PortableWriter,
  element: 'article' | 'aside' | 'figure' | 'section',
  className: string,
  block: string,
  props: Record<string, unknown>,
  standaloneV2 = false
) {
  writer.push(`<${element} class="halo-block ${className}"`)
  writer.attribute('data-halo-block', block)
  if (standaloneV2) writer.attribute('data-halo-legacy-block', 'true')
  const orientation = props.orientation === 'horizontal' ? 'horizontal' : 'vertical'
  writer.attribute('data-halo-orientation', orientation)
  if (booleanValue(props.reverse)) writer.attribute('data-halo-reverse', 'true')
  if (typeof props.variant === 'string') writer.attribute('data-halo-variant', props.variant)
  if (className === 'halo-card') {
    if (booleanValue(props.highlight)) {
      writer.attribute('data-halo-highlight', 'true')
      const highlightColor = stringValue(props.highlightColor)
      if (highlightColor) writer.attribute('data-halo-highlight-color', highlightColor)
    }
    if (booleanValue(props.spotlight)) {
      writer.attribute('data-halo-spotlight', 'true')
      const spotlightColor = stringValue(props.spotlightColor)
      if (spotlightColor) writer.attribute('data-halo-spotlight-color', spotlightColor)
    }
  }
  writer.push('>')
}

function writeFeatures(writer: PortableWriter, features: unknown, origin: string) {
  if (!Array.isArray(features) || !features.length) return
  writer.push('<ul class="halo-features">')
  for (const candidate of features) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const feature = candidate as Record<string, unknown>
    const href = resolvePortableLinkUrl(feature.to, origin)
    writer.push('<li class="halo-feature"')
    writer.attribute('data-halo-orientation', feature.orientation === 'vertical' ? 'vertical' : 'horizontal')
    writer.push('>')
    if (href) {
      writer.push('<a class="halo-feature-link"')
      writeSafeLinkAttributes(writer, href, feature.target, origin)
      writer.push('>')
    } else {
      writer.push('<div class="halo-feature-content">')
    }
    writePortableIcon(writer, feature.icon)
    writer.push('<div class="halo-feature-body">')
    writer.push('<h3 class="halo-feature-title"')
    writer.attribute('id', writer.headingId(3, feature.title))
    writer.push('>')
    writeText(writer, feature.title)
    writer.push('</h3>')
    if (typeof feature.description === 'string' && feature.description) {
      writer.push('<p class="halo-feature-description">')
      writer.escaped(feature.description)
      writer.push('</p>')
    }
    writer.push('</div>')
    writer.push(href ? '</a>' : '</div>')
    writer.push('</li>')
  }
  writer.push('</ul>')
}

function writePageBlock(
  writer: PortableWriter,
  attrs: StoredPageBlockAttrs,
  origin: string,
  depth: number,
  standaloneV2 = false
) {
  writer.claimNode(depth)
  const resolved = resolvePageBlockForDelivery(attrs)
  if (resolved.status !== 'known') {
    writer.push('<section class="halo-block halo-block-fallback"')
    writer.attribute('data-halo-block-status', resolved.status)
    writer.push('><p>Content block unavailable</p></section>')
    return
  }

  const props = resolved.props as Record<string, unknown>
  const media = resolved.media as Record<string, unknown>
  if (resolved.key === 'pageHero') {
    writeBlockShellStart(writer, 'section', 'halo-hero', 'hero', props, standaloneV2)
    writer.push('<div class="halo-block-content">')
    writeBlockHeader(writer, props, 1)
    writeActions(writer, props.links, origin)
    writer.push('</div>')
    writeMedia(writer, media, origin)
    writer.push('</section>')
    return
  }
  if (resolved.key === 'pageCard') {
    writeBlockShellStart(writer, 'article', 'halo-card', 'card', props, standaloneV2)
    const href = resolvePortableLinkUrl(props.to, origin)
    if (href) {
      writer.push('<a class="halo-card-anchor"')
      writeSafeLinkAttributes(writer, href, props.target, origin)
      writer.push('>')
    }
    writer.push('<div class="halo-block-content">')
    writePortableIcon(writer, props.icon)
    writeBlockHeader(writer, props)
    writer.push('</div>')
    writeMedia(writer, media, origin)
    if (href) writer.push('</a>')
    writer.push('</article>')
    return
  }
  if (resolved.key === 'pageSection') {
    writeBlockShellStart(writer, 'section', 'halo-section', 'section', props, standaloneV2)
    writer.push('<div class="halo-block-content">')
    writePortableIcon(writer, props.icon)
    writeBlockHeader(writer, props)
    writeFeatures(writer, props.features, origin)
    writeActions(writer, props.links, origin)
    writer.push('</div>')
    writeMedia(writer, media, origin)
    writer.push('</section>')
    return
  }
  if (resolved.key === 'pageTestimonial') {
    writeBlockShellStart(writer, 'figure', 'halo-testimonial', 'testimonial', props, standaloneV2)
    writeMedia(writer, media, origin)
    writer.push('<div class="halo-block-content"><blockquote class="halo-testimonial-quote"><p>')
    writeText(writer, props.quote)
    writer.push('</p></blockquote>')
    const author = stringValue(props.author)
    const role = stringValue(props.role)
    const company = stringValue(props.company)
    if (author || role || company) {
      writer.push('<figcaption class="halo-testimonial-attribution">')
      if (author) writer.escaped(author)
      if (role || company) {
        writer.push('<span>')
        writer.escaped([role, company].filter(Boolean).join(', '))
        writer.push('</span>')
      }
      writer.push('</figcaption>')
    }
    writer.push('</div></figure>')
    return
  }
  if (resolved.key === 'pageLogos') {
    writeBlockShellStart(writer, 'section', 'halo-logos', 'logos', props, standaloneV2)
    writeBlockHeader(writer, props)
    writer.push('<ul class="halo-logo-list">')
    for (const candidate of Array.isArray(props.items) ? props.items : []) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const item = candidate as Record<string, unknown>
      const src = resolvePortablePageAssetUrl(item.src, origin)
      writer.push('<li class="halo-logo-item">')
      if (src) {
        writer.push('<img class="halo-logo-image"')
        writer.attribute('src', src)
        writer.attribute('alt', stringValue(item.alt) || stringValue(item.name))
        writer.attribute('loading', 'lazy')
        writer.attribute('decoding', 'async')
        writer.push('>')
      } else {
        writer.push('<span class="halo-logo-name"')
        if (typeof item.src === 'string' && item.src) writer.attribute('data-halo-asset-status', 'unavailable')
        writer.push('>')
        writeText(writer, item.name)
        writer.push('</span>')
      }
      writer.push('</li>')
    }
    writer.push('</ul></section>')
    return
  }
  if (resolved.key === 'pageFAQ') {
    writeBlockShellStart(writer, 'section', 'halo-faq', 'faq', props, standaloneV2)
    writeBlockHeader(writer, props)
    writer.push('<div class="halo-faq-list">')
    for (const candidate of Array.isArray(props.items) ? props.items : []) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const item = candidate as Record<string, unknown>
      writer.push('<details class="halo-faq-item"><summary class="halo-faq-question">')
      writeText(writer, item.question)
      writer.push('</summary><div class="halo-faq-answer"><p>')
      writeText(writer, item.answer)
      writer.push('</p></div></details>')
    }
    writer.push('</div></section>')
    return
  }

  writeBlockShellStart(writer, 'aside', 'halo-cta', 'cta', props, standaloneV2)
  writer.push('<div class="halo-block-content">')
  writeBlockHeader(writer, props)
  writeActions(writer, props.links, origin)
  writer.push('</div>')
  writeMedia(writer, media, origin)
  writer.push('</aside>')
}

function writeRichTextDocumentContent(
  writer: PortableWriter,
  value: unknown,
  origin: string,
  options: { allowPageBlocks: boolean, allowPageHero?: boolean, standaloneV2?: boolean }
) {
  if (typeof value === 'string') {
    writer.push('<p>')
    writer.escaped(value)
    writer.push('</p>')
    return
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    writeRichTextFallback(writer)
    return
  }
  const document = value as Record<string, any>
  if (document.type !== 'doc' || !Array.isArray(document.content)) {
    writeRichTextFallback(writer)
    return
  }
  const normalizedDocument = options.allowPageHero
    ? normalizeAuthoredDocument(document, { allowPageHero: true })
    : null
  if (normalizedDocument?.truncated) {
    throw new PortableRenderBudgetError('Portable rendering budget exceeded')
  }
  for (let index = 0; index < document.content.length; index += 1) {
    const candidate = document.content[index]
    if (options.allowPageHero && candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).type === 'pageHero') {
      writer.claimNode(1)
      const hero = normalizedDocument?.content[index]
      if (hero?.type !== 'pageHero') {
        writeRichTextFallback(writer)
        continue
      }
      writer.push('<section class="halo-block halo-hero" data-halo-block="hero"')
      writer.attribute('data-halo-orientation', hero.orientation)
      if (hero.reverse) writer.attribute('data-halo-reverse', 'true')
      writer.push('><div class="halo-block-content">')
      for (const child of (candidate as Record<string, any>).content) {
        writeRichTextNode(writer, child, origin, 2, { standaloneV2: true, context: 'block' })
      }
      writer.push('</div></section>')
      continue
    }
    if (options.allowPageBlocks && candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).type === 'pageBlock') {
      const attrs = (candidate as Record<string, any>).attrs
      writePageBlock(
        writer,
        attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {},
        origin,
        1,
        options.allowPageHero === true
      )
    } else {
      writeRichTextNode(writer, candidate, origin, 1, {
        standaloneV2: options.standaloneV2 === true,
        context: 'block'
      })
    }
  }
}

function renderWithFallback(
  options: PortableRenderOptions,
  root: { className: string, contentKind: string },
  render: (writer: PortableWriter, origin: string) => void,
  sharedBudget?: PortableBudget,
  headingPrefix = normalizedHeadingPrefix(options.headingIdPrefix)
) {
  const origin = normalizePortableOrigin(options.origin)
  const limits = renderingLimits(options.limits)
  const theme = normalizePortableThemeArtifact(options.theme, options.origin)
  const colorMode = theme?.colorMode === 'light' || theme?.colorMode === 'dark'
    ? theme.colorMode
    : 'default'
  const rootStart = `<article class="halo-content ${root.className}" data-halo-contract-version="1" data-halo-content="${root.contentKind}" data-halo-color-mode="${colorMode}">`
  const rootEnd = '</article>'
  const fallback = `${rootStart}<p class="halo-content-fallback" role="status">Content exceeds portable rendering limits</p>${rootEnd}`
  const budget = sharedBudget ?? new PortableBudget(limits)
  const headings = new PortableHeadingRegistry(normalizedHeadingPrefix(headingPrefix))
  if (fallback.length > limits.maxOutputLength) {
    budget.markExceeded()
    return { html: '', outline: headings.outline, truncated: true }
  }
  const checkpoint = budget.checkpoint()
  try {
    const writer = new PortableWriter(budget, headings)
    writer.push(rootStart)
    render(writer, origin)
    writer.push(rootEnd)
    return { html: writer.toString(), outline: headings.outline, truncated: false }
  } catch (error) {
    if (!(error instanceof PortableRenderBudgetError)) throw error
    budget.recover(checkpoint)
    headings.reset()
    if (fallback.length > budget.remainingOutput()) return { html: '', outline: headings.outline, truncated: true }
    budget.charge(fallback.length)
    return { html: fallback, outline: headings.outline, truncated: true }
  }
}

export function renderPortableRichText(value: unknown, options: PortableRenderOptions) {
  return renderWithFallback(options, { className: 'halo-richtext', contentKind: 'richtext' }, (writer, origin) => {
    writeRichTextDocumentContent(writer, value, origin, { allowPageBlocks: false })
  }).html
}

export function renderPortablePageDocument(value: unknown, options: PortableRenderOptions) {
  return renderWithFallback(options, { className: 'halo-page', contentKind: 'page' }, (writer, origin) => {
    writeRichTextDocumentContent(writer, value, origin, { allowPageBlocks: true })
  }).html
}

export function createPortablePageRendering(
  document: unknown,
  options: PortableRenderOptions
): PortableDocumentRendering {
  const rendered = renderWithFallback(options, { className: 'halo-page', contentKind: 'page' }, (writer, origin) => {
    writeRichTextDocumentContent(writer, document, origin, { allowPageBlocks: true })
  })
  return {
    ...renderingBase(options),
    html: rendered.html,
    outline: rendered.outline
  }
}

/**
 * Internal bridge for the server-owned standalone v2 projection. The public v1
 * entry points above intentionally retain their original behavior and bytes.
 */
export function createPortablePageRenderingForStandaloneV2(
  document: unknown,
  options: PortableRenderOptions
): PortableDocumentRendering {
  const rendered = renderWithFallback(options, { className: 'halo-page', contentKind: 'page' }, (writer, origin) => {
    writeRichTextDocumentContent(writer, document, origin, {
      allowPageBlocks: true,
      allowPageHero: true,
      standaloneV2: true
    })
  })
  return {
    ...renderingBase(options),
    html: rendered.html,
    outline: rendered.truncated
      ? []
      : extractAuthoredOutline(document, { allowPageBlocks: true, allowPageHero: true })
  }
}

export function createPortableRichTextRendering(
  document: unknown,
  options: PortableRenderOptions
): PortableDocumentRendering {
  const rendered = renderWithFallback(options, { className: 'halo-richtext', contentKind: 'richtext' }, (writer, origin) => {
    writeRichTextDocumentContent(writer, document, origin, { allowPageBlocks: false })
  })
  return {
    ...renderingBase(options),
    html: rendered.html,
    outline: rendered.outline
  }
}

function createPortableStructuredContentRenderingInternal(
  content: Record<string, unknown>,
  schemaFields: PortableSchemaField[],
  options: PortableRenderOptions,
  standaloneV2: boolean
): PortableStructuredContentRendering {
  const fields: Record<string, PortableRichTextFieldRendering> = Object.create(null)
  const outline: PortableOutlineEntry[] = []
  const limits = renderingLimits(options.limits)
  const budget = new PortableBudget(limits)
  const runtimeFields: unknown[] = Array.isArray(schemaFields) ? schemaFields : []
  const scanLimit = Math.min(runtimeFields.length, limits.maxSchemaFields)
  let truncated = !Array.isArray(schemaFields) || runtimeFields.length > scanLimit
  for (let index = 0; index < scanLimit; index += 1) {
    const candidate = runtimeFields[index]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      truncated = true
      continue
    }
    const field = candidate as Record<string, unknown>
    const fieldId = field.fieldId
    const fieldKey = field.key
    const fieldKind = field.kind
    if (typeof fieldId !== 'string' || !fieldId || fieldId.length > 256
      || typeof fieldKey !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,255}$/.test(fieldKey)
      || typeof fieldKind !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(fieldKind)) {
      truncated = true
      continue
    }
    if (fieldKind !== 'richtext') continue
    try {
      budget.claimField(fieldId, fieldKey)
    } catch (error) {
      if (!(error instanceof PortableRenderBudgetError)) throw error
      truncated = true
      break
    }
    const fieldHeadingPrefix = standaloneV2
      ? authoredFieldHeadingPrefix(fieldId, fieldKey, options.headingIdPrefix)
      : [
          normalizedHeadingPrefix(options.headingIdPrefix).slice(0, 16),
          portableHeadingSlug(fieldKey).slice(0, 12),
          portableHeadingFieldDiscriminator(fieldId, fieldKey)
        ].join('-').slice(0, 48)
    const rendered = renderWithFallback(
      options,
      { className: 'halo-richtext', contentKind: 'richtext' },
      (writer, origin) => writeRichTextDocumentContent(writer, content[fieldKey], origin, {
        allowPageBlocks: false,
        standaloneV2
      }),
      budget,
      fieldHeadingPrefix
    )
    const fieldOutline = standaloneV2 && !rendered.truncated
      ? normalizeAuthoredDocument(content[fieldKey], { headingIdPrefix: fieldHeadingPrefix }).outline
      : rendered.outline
    fields[fieldKey] = {
      fieldId,
      fieldKey,
      html: rendered.html,
      outline: fieldOutline
    }
    outline.push(...fieldOutline.slice(0, Math.max(0, PORTABLE_OUTLINE_LIMIT - outline.length)))
    if (budget.exceeded) {
      truncated = true
      break
    }
  }
  return {
    ...renderingBase(options),
    fields,
    outline,
    ...(truncated ? { truncated: true as const } : {})
  }
}

export function createPortableStructuredContentRendering(
  content: Record<string, unknown>,
  schemaFields: PortableSchemaField[],
  options: PortableRenderOptions
): PortableStructuredContentRendering {
  return createPortableStructuredContentRenderingInternal(content, schemaFields, options, false)
}

/** Server-only v2 bridge; the public v1 structured writer remains byte-stable. */
export function createPortableStructuredContentRenderingForStandaloneV2(
  content: Record<string, unknown>,
  schemaFields: PortableSchemaField[],
  options: PortableRenderOptions
): PortableStructuredContentRendering {
  return createPortableStructuredContentRenderingInternal(content, schemaFields, options, true)
}

export function createPortableStandaloneDocument(
  rendering: PortableDocumentRendering,
  options: { title?: string, colorMode?: 'default' | 'light' | 'dark' } = {}
) {
  const title = escapePortableHtml(options.title || 'HaloPress portable content')
  const storedColorMode = rendering.themeColorMode === 'light' || rendering.themeColorMode === 'dark'
    ? rendering.themeColorMode
    : 'default'
  const colorMode = options.colorMode ?? storedColorMode
  const stylesheets = rendering.stylesheets
    .map(href => `<link rel="stylesheet" href="${escapePortableHtml(href)}">`)
    .join('')
  const html = rendering.html.replace(
    /data-halo-color-mode="(?:default|light|dark)"/,
    `data-halo-color-mode="${colorMode}"`
  )
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${stylesheets}</head><body>${html}</body></html>`
}
