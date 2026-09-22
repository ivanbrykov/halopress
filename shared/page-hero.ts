import type { JSONContent } from '@tiptap/core'

import {
  isSafePageUrl,
  resolvePageBlock,
  type StoredPageBlockAttrs
} from './page-blocks'

export const pageHeroOrientations = ['vertical', 'horizontal'] as const
export type PageHeroOrientation = typeof pageHeroOrientations[number]

export type PageHeroAttrs = {
  orientation: PageHeroOrientation
  reverse: boolean
}

export type LegacyPageHeroConversion =
  | { status: 'ready', node: JSONContent }
  | { status: 'blocked', reason: string }

function text(value: string, marks?: JSONContent['marks']): JSONContent {
  return { type: 'text', text: value, ...(marks?.length ? { marks } : {}) }
}

function paragraph(content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content }
}

function isEmptyRecord(value: unknown) {
  return value == null
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function storedRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every(key => keys.includes(key))
}

function actionContent(value: unknown): JSONContent[] | null {
  if (!Array.isArray(value)) return []
  const content: JSONContent[] = []
  for (const candidate of value) {
    const link = storedRecord(candidate)
    if (!link || !hasOnlyKeys(link, ['label', 'to', 'target'])) return null
    const label = stringValue(link.label)
    const href = stringValue(link.to)
    if (!label || !href || !isSafePageUrl(href)) return null
    if (content.length) content.push(text('  '))
    content.push(text(label, [{
      type: 'link',
      attrs: {
        href,
        target: link.target === '_blank' ? '_blank' : '_self'
      }
    }]))
  }
  return content
}

export function normalizePageHeroAttrs(value: unknown): PageHeroAttrs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attrs = value as Record<string, unknown>
  if (Object.keys(attrs).some(key => !['orientation', 'reverse'].includes(key))) return null
  const orientation = attrs.orientation ?? 'vertical'
  const reverse = attrs.reverse ?? false
  if (!pageHeroOrientations.includes(orientation as PageHeroOrientation) || typeof reverse !== 'boolean') return null
  return { orientation: orientation as PageHeroOrientation, reverse }
}

export function convertLegacyPageHero(attrs: StoredPageBlockAttrs): LegacyPageHeroConversion {
  if (!isEmptyRecord(attrs.advanced)) {
    return {
      status: 'blocked',
      reason: 'This Hero has advanced data that cannot be represented by the editable Hero without losing information.'
    }
  }

  const storedProps = attrs.props == null ? {} : storedRecord(attrs.props)
  if (!storedProps || !hasOnlyKeys(storedProps, [
    'headline', 'title', 'description', 'orientation', 'reverse', 'links'
  ])) {
    return {
      status: 'blocked',
      reason: 'This Hero has property data that cannot be represented by the editable Hero without losing information.'
    }
  }
  const storedMedia = attrs.media == null ? {} : storedRecord(attrs.media)
  if (!storedMedia || !hasOnlyKeys(storedMedia, ['url', 'alt', 'width', 'height'])) {
    return {
      status: 'blocked',
      reason: 'This Hero has media data that cannot be represented by the editable Hero without losing information.'
    }
  }

  const resolved = resolvePageBlock(attrs)
  if (resolved.status !== 'known' || resolved.key !== 'pageHero') {
    return { status: 'blocked', reason: 'This block is not a supported legacy Hero.' }
  }

  const props = resolved.props as Record<string, unknown>
  const content: JSONContent[] = []
  const headline = stringValue(props.headline)
  const title = stringValue(props.title)
  const description = stringValue(props.description)
  const actions = actionContent(props.links)
  if (!actions) {
    return {
      status: 'blocked',
      reason: 'This Hero has action data that cannot be represented by editable text links without losing information.'
    }
  }

  if (headline) content.push(paragraph([text(headline)]))
  content.push({
    type: 'heading',
    attrs: { level: 1 },
    ...(title ? { content: [text(title)] } : {})
  })
  content.push(paragraph(description ? [text(description)] : []))
  if (actions.length) content.push(paragraph(actions))

  const media = resolved.media as Record<string, unknown>
  const src = stringValue(media.url)
  if (src) {
    content.push({
      type: 'image',
      attrs: {
        src,
        alt: stringValue(media.alt),
        title: null,
        width: Number.isSafeInteger(media.width) ? media.width : null,
        height: Number.isSafeInteger(media.height) ? media.height : null
      }
    })
  }

  return {
    status: 'ready',
    node: {
      type: 'pageHero',
      attrs: {
        orientation: props.orientation === 'horizontal' ? 'horizontal' : 'vertical',
        reverse: props.reverse === true
      },
      content
    }
  }
}
