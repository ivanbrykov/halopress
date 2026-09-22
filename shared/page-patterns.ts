import type { JSONContent } from '@tiptap/core'

import {
  isPortablePageAssetPath,
  isSafePageUrl,
  isValidCuratedPageBlockAttrs,
  type PageBlockComponentKey,
  type StoredPageBlockAttrs
} from './page-blocks'
import { normalizePageHeroAttrs } from './page-hero'

export const PAGE_PATTERN_CONTRACT_VERSION = 2
export const PAGE_BLOCK_REGISTRY_VERSION = 1

export type PageLibraryEntryModel = 'configured-block' | 'editable-unit' | 'document-pattern'

export type PagePatternDefinition = {
  key: string
  version: number
  label: string
  summary: string
  category: 'Starter' | 'Hero' | 'Content' | 'Trust' | 'FAQ' | 'Conversion'
  icon: string
  keywords: string[]
  model: PageLibraryEntryModel
  compatibility: {
    editor: 'page'
    patternContract: typeof PAGE_PATTERN_CONTRACT_VERSION
    blockRegistry: typeof PAGE_BLOCK_REGISTRY_VERSION
    requiredConfiguredBlocks: PageBlockComponentKey[]
    requiredEditableUnits: Array<'pageHero'>
  }
  content: {
    type: 'doc'
    content: JSONContent[]
  }
}

const configuredPatternBlocks = new Set<PageBlockComponentKey>(['pageFAQ', 'pageLogos'])
const MAX_PATTERN_NODES = 200
const MAX_PATTERN_DEPTH = 8
const MAX_PATTERN_TEXT = 20_000
const forbiddenStoredKeys = new Set([
  'class',
  'style',
  'ui',
  'html',
  'componentName',
  'renderer',
  'onClick',
  'onUpdate'
])

function text(value: string, marks?: JSONContent['marks']): JSONContent {
  return { type: 'text', text: value, ...(marks?.length ? { marks } : {}) }
}

function paragraph(value: string | JSONContent[], attrs?: Record<string, unknown>): JSONContent {
  return {
    type: 'paragraph',
    ...(attrs ? { attrs } : {}),
    content: typeof value === 'string' ? [text(value)] : value
  }
}

function heading(value: string, level: 1 | 2 | 3 | 4, textAlign?: 'left' | 'center'): JSONContent {
  return {
    type: 'heading',
    attrs: { level, ...(textAlign ? { textAlign } : {}) },
    content: [text(value)]
  }
}

function actionParagraph(actions: Array<{ label: string, href: string }>): JSONContent {
  const content: JSONContent[] = []
  actions.forEach((action, index) => {
    if (index) content.push(text('  '))
    content.push(text(action.label, [{ type: 'link', attrs: { href: action.href, target: '_self' } }]))
  })
  return paragraph(content)
}

function listItem(title: string, description: string): JSONContent {
  return {
    type: 'listItem',
    content: [paragraph([
      text(title, [{ type: 'bold' }]),
      text(` — ${description}`)
    ])]
  }
}

function configuredBlock(
  component: 'pageFAQ' | 'pageLogos',
  props: Record<string, unknown>
): JSONContent {
  return {
    type: 'pageBlock',
    attrs: { component, props, advanced: {}, media: {} } satisfies StoredPageBlockAttrs
  }
}

function centeredHero(): JSONContent {
  return {
    type: 'pageHero',
    attrs: { orientation: 'vertical', reverse: false },
    content: [
      heading('[Add your primary promise]', 1, 'center'),
      paragraph('[Explain who this is for and why it matters.]', { textAlign: 'center' }),
      actionParagraph([
        { label: '[Primary action]', href: '#next' },
        { label: '[Secondary action]', href: '#details' }
      ])
    ]
  }
}

function splitHero(): JSONContent {
  return {
    type: 'pageHero',
    attrs: { orientation: 'horizontal', reverse: false },
    content: [
      heading('[Add your product promise]', 1),
      paragraph('[Describe the outcome in one or two concise sentences.]'),
      actionParagraph([{ label: '[Primary action]', href: '#next' }]),
      { type: 'imageUpload' }
    ]
  }
}

function featureGrid(): JSONContent[] {
  return [
    heading('[Add the section promise]', 2),
    paragraph('[Connect these capabilities to a concrete reader outcome.]'),
    {
      type: 'bulletList',
      content: [
        listItem('[Feature one]', '[Explain the first benefit.]'),
        listItem('[Feature two]', '[Explain the second benefit.]'),
        listItem('[Feature three]', '[Explain the third benefit.]')
      ]
    }
  ]
}

function mediaContent(): JSONContent[] {
  return [
    heading('[Explain one important idea]', 2),
    paragraph('[Add supporting detail, then insert or replace an image with the normal Image tool.]'),
    actionParagraph([{ label: '[Learn more]', href: '#details' }]),
    { type: 'imageUpload' }
  ]
}

function testimonial(): JSONContent[] {
  return [
    {
      type: 'blockquote',
      content: [paragraph('[Add a specific customer outcome in their own words.]')]
    },
    paragraph('[Add the customer name] — [Add role and company]'),
    configuredBlock('pageLogos', {
      title: 'Trusted by teams like yours',
      items: [
        { name: '[Customer one]', src: '', alt: 'Add the Customer one logo' },
        { name: '[Customer two]', src: '', alt: 'Add the Customer two logo' },
        { name: '[Customer three]', src: '', alt: 'Add the Customer three logo' },
        { name: '[Customer four]', src: '', alt: 'Add the Customer four logo' }
      ]
    })
  ]
}

function faq(): JSONContent {
  return configuredBlock('pageFAQ', {
    headline: 'Questions',
    title: 'Frequently asked questions',
    description: 'A concise introduction to common questions.',
    items: [
      { question: '[Add the first question]', answer: '[Add a direct, useful answer.]' },
      { question: '[Add the second question]', answer: '[Add a direct, useful answer.]' },
      { question: '[Add the third question]', answer: '[Add a direct, useful answer.]' }
    ]
  })
}

function closingCta(): JSONContent[] {
  return [
    heading('[Restate the desired outcome]', 2, 'center'),
    paragraph('[Remove the last uncertainty and invite the next step.]', { textAlign: 'center' }),
    actionParagraph([
      { label: '[Primary action]', href: '#start' },
      { label: '[Secondary action]', href: '#contact' }
    ])
  ]
}

function pattern(
  definition: Omit<PagePatternDefinition, 'version' | 'compatibility'>
    & { requiredConfiguredBlocks?: PageBlockComponentKey[], requiredEditableUnits?: Array<'pageHero'> }
): PagePatternDefinition {
  const {
    requiredConfiguredBlocks = [],
    requiredEditableUnits = [],
    ...metadata
  } = definition
  return {
    ...metadata,
    version: 2,
    compatibility: {
      editor: 'page',
      patternContract: PAGE_PATTERN_CONTRACT_VERSION,
      blockRegistry: PAGE_BLOCK_REGISTRY_VERSION,
      requiredConfiguredBlocks,
      requiredEditableUnits
    }
  }
}

export const pagePatternKeys = [
  'centered-hero',
  'split-hero',
  'feature-grid',
  'media-content',
  'testimonial-social-proof',
  'faq',
  'closing-cta',
  'starter-page'
] as const
export type PagePatternKey = typeof pagePatternKeys[number]

export const pagePatternDefinitions: PagePatternDefinition[] = [
  pattern({
    key: 'centered-hero',
    label: 'Centered hero',
    summary: 'Editable headline, supporting copy, and links in a grouped Hero.',
    category: 'Hero',
    icon: 'i-lucide-align-center',
    keywords: ['banner', 'headline', 'introduction', 'landing'],
    model: 'editable-unit',
    requiredEditableUnits: ['pageHero'],
    content: { type: 'doc', content: [centeredHero()] }
  }),
  pattern({
    key: 'split-hero',
    label: 'Split hero',
    summary: 'An editable Hero ready for media through the normal Image tool.',
    category: 'Hero',
    icon: 'i-lucide-columns-2',
    keywords: ['banner', 'image', 'media', 'product'],
    model: 'editable-unit',
    requiredEditableUnits: ['pageHero'],
    content: { type: 'doc', content: [splitHero()] }
  }),
  pattern({
    key: 'feature-grid',
    label: 'Feature list',
    summary: 'Ordinary editable headings, copy, and feature list items.',
    category: 'Content',
    icon: 'i-lucide-list-checks',
    keywords: ['benefits', 'capabilities', 'features', 'list'],
    model: 'document-pattern',
    content: { type: 'doc', content: featureGrid() }
  }),
  pattern({
    key: 'media-content',
    label: 'Media and content',
    summary: 'Editable copy with a prompt to add media through the normal Image tool.',
    category: 'Content',
    icon: 'i-lucide-panel-left',
    keywords: ['image', 'media', 'product', 'story'],
    model: 'document-pattern',
    content: { type: 'doc', content: mediaContent() }
  }),
  pattern({
    key: 'testimonial-social-proof',
    label: 'Testimonial and social proof',
    summary: 'Editable testimonial copy plus a configured logo collection.',
    category: 'Trust',
    icon: 'i-lucide-message-square-quote',
    keywords: ['customer', 'logos', 'proof', 'quote', 'testimonial'],
    model: 'document-pattern',
    requiredConfiguredBlocks: ['pageLogos'],
    content: { type: 'doc', content: testimonial() }
  }),
  pattern({
    key: 'faq',
    label: 'Frequently asked questions',
    summary: 'A configured keyboard-accessible accordion with a finite item list.',
    category: 'FAQ',
    icon: 'i-lucide-circle-help',
    keywords: ['accordion', 'answers', 'questions', 'support'],
    model: 'configured-block',
    requiredConfiguredBlocks: ['pageFAQ'],
    content: { type: 'doc', content: [faq()] }
  }),
  pattern({
    key: 'closing-cta',
    label: 'Closing call to action',
    summary: 'Ordinary editable closing copy and safe links.',
    category: 'Conversion',
    icon: 'i-lucide-megaphone',
    keywords: ['action', 'closing', 'conversion', 'signup'],
    model: 'document-pattern',
    content: { type: 'doc', content: closingCta() }
  }),
  pattern({
    key: 'starter-page',
    label: 'Marketing starter page',
    summary: 'A complete editable page with one configured FAQ.',
    category: 'Starter',
    icon: 'i-lucide-panels-top-left',
    keywords: ['blank alternative', 'full page', 'landing', 'starter'],
    model: 'document-pattern',
    requiredConfiguredBlocks: ['pageFAQ'],
    requiredEditableUnits: ['pageHero'],
    content: {
      type: 'doc',
      content: [splitHero(), ...featureGrid(), ...testimonial().slice(0, 2), faq(), ...closingCta()]
    }
  })
]

export const pagePatternRegistry = {
  patterns: pagePatternDefinitions,
  byKey: Object.fromEntries(pagePatternDefinitions.map(item => [item.key, item])) as Record<PagePatternKey, PagePatternDefinition>
}

type ValidationState = {
  issues: string[]
  nodes: number
  text: number
  configuredBlocks: Set<PageBlockComponentKey>
  editableUnits: Set<'pageHero'>
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null
}

function validatePatternValue(
  value: unknown,
  state: ValidationState,
  path: string,
  depth: number
) {
  if (depth > MAX_PATTERN_DEPTH) {
    state.issues.push('Pattern content exceeds the nesting budget.')
    return
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => validatePatternValue(child, state, `${path}.${index + 1}`, depth))
    return
  }
  const node = record(value)
  if (!node || typeof node.type !== 'string') {
    state.issues.push(`${path} is not a Tiptap JSON node or mark.`)
    return
  }

  state.nodes += 1
  if (state.nodes > MAX_PATTERN_NODES) {
    state.issues.push('Pattern content exceeds the node budget.')
    return
  }
  if (Object.keys(node).some(key => forbiddenStoredKeys.has(key))) {
    state.issues.push(`${path} contains a forbidden runtime key.`)
  }
  const attrs = record(node.attrs)
  if (attrs && Object.keys(attrs).some(key => forbiddenStoredKeys.has(key))) {
    state.issues.push(`${path} contains forbidden stored attributes.`)
  }

  if (typeof node.text === 'string') {
    state.text += node.text.length
    if (node.text.length > 5_000 || state.text > MAX_PATTERN_TEXT) {
      state.issues.push('Pattern content exceeds the text budget.')
    }
  }
  if (node.type === 'image') {
    if (!attrs || typeof attrs.src !== 'string' || !attrs.src || !isPortablePageAssetPath(attrs.src)) {
      state.issues.push(`${path} has an unsafe or malformed image source.`)
    }
  }
  if (node.type === 'link') {
    if (!attrs || typeof attrs.href !== 'string' || !isSafePageUrl(attrs.href)
      || (attrs.target !== undefined && !['_self', '_blank'].includes(attrs.target))) {
      state.issues.push(`${path} has an unsafe or malformed link.`)
    }
  }
  if (node.type === 'pageBlock') {
    const blockAttrs = attrs as StoredPageBlockAttrs | null
    const component = blockAttrs?.component
    if (!blockAttrs || !configuredPatternBlocks.has(component as PageBlockComponentKey)
      || !isValidCuratedPageBlockAttrs(blockAttrs)) {
      state.issues.push(`${path} is not an approved configured block.`)
    } else {
      state.configuredBlocks.add(component as PageBlockComponentKey)
    }
  }
  if (node.type === 'pageHero') {
    if (!normalizePageHeroAttrs(attrs ?? {})) state.issues.push(`${path} has invalid Hero attributes.`)
    state.editableUnits.add('pageHero')
  }

  if (Array.isArray(node.marks)) validatePatternValue(node.marks, state, `${path}.marks`, depth)
  if (Array.isArray(node.content)) validatePatternValue(node.content, state, `${path}.content`, depth + 1)
}

export function validatePagePatternContent(content: unknown) {
  const state: ValidationState = {
    issues: [],
    nodes: 0,
    text: 0,
    configuredBlocks: new Set(),
    editableUnits: new Set()
  }
  if (!Array.isArray(content) || !content.length) {
    state.issues.push('Pattern content must be a non-empty document fragment.')
    return state
  }
  validatePatternValue(content, state, 'Pattern', 0)
  return state
}

export function validatePagePatternDefinition(definition: PagePatternDefinition) {
  const issues: string[] = []
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Pattern version must be a positive integer.')
  if (definition.compatibility.editor !== 'page') issues.push('Pattern is not compatible with the page editor.')
  if (definition.compatibility.patternContract !== PAGE_PATTERN_CONTRACT_VERSION) issues.push('Unsupported pattern contract version.')
  if (definition.compatibility.blockRegistry !== PAGE_BLOCK_REGISTRY_VERSION) issues.push('Unsupported block registry version.')
  if (!['configured-block', 'editable-unit', 'document-pattern'].includes(definition.model)) issues.push('Pattern has an unsupported library model.')
  if (definition.content.type !== 'doc') issues.push('Pattern content must be a document fragment.')

  const validated = validatePagePatternContent(definition.content.content)
  issues.push(...validated.issues)
  for (const key of definition.compatibility.requiredConfiguredBlocks) {
    if (!validated.configuredBlocks.has(key)) issues.push(`Pattern is missing required configured block ${key}.`)
  }
  for (const key of validated.configuredBlocks) {
    if (!definition.compatibility.requiredConfiguredBlocks.includes(key)) issues.push(`Pattern is missing compatibility metadata for ${key}.`)
  }
  for (const key of definition.compatibility.requiredEditableUnits) {
    if (!validated.editableUnits.has(key)) issues.push(`Pattern is missing required editable unit ${key}.`)
  }
  for (const key of validated.editableUnits) {
    if (!definition.compatibility.requiredEditableUnits.includes(key)) issues.push(`Pattern is missing compatibility metadata for ${key}.`)
  }
  return issues
}

export function clonePagePatternContent(key: PagePatternKey): JSONContent[] {
  return structuredClone(pagePatternRegistry.byKey[key].content.content)
}

export function buildPageDocumentFromPattern(key: PagePatternKey) {
  return { type: 'doc' as const, content: clonePagePatternContent(key) }
}
