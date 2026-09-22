import type { PageBlockComponent, PageBlockRegistry } from './types'
import { pageBlockDefinitions } from '~~/shared/page-blocks'

const orientationOptions = [
  { label: 'Vertical', value: 'vertical' },
  { label: 'Horizontal', value: 'horizontal' }
]

const targetOptions = [
  { label: 'Same tab', value: '_self' },
  { label: 'New tab', value: '_blank' }
]

const colorOptions = [
  { label: 'Primary', value: 'primary' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Success', value: 'success' },
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' },
  { label: 'Neutral', value: 'neutral' }
]

const heroFields: PageBlockComponent['fields'] = [
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'orientation', label: 'Orientation', type: 'select', options: orientationOptions },
  { key: 'reverse', label: 'Reverse', type: 'boolean' },
  { key: 'links', label: 'Links', type: 'link-list', help: 'Add up to 12 safe action links.' }
]

const ctaFields: PageBlockComponent['fields'] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'orientation', label: 'Orientation', type: 'select', options: orientationOptions },
  { key: 'reverse', label: 'Reverse', type: 'boolean' },
  { key: 'links', label: 'Links', type: 'link-list', help: 'Add up to 12 safe action links.' },
  { key: 'variant', label: 'Variant', type: 'select', options: [
    { label: 'Outline', value: 'outline' },
    { label: 'Solid', value: 'solid' },
    { label: 'Soft', value: 'soft' },
    { label: 'Subtle', value: 'subtle' },
    { label: 'Naked', value: 'naked' }
  ] }
]

const cardFields: PageBlockComponent['fields'] = [
  { key: 'icon', label: 'Icon', type: 'icon', help: 'Choose a supported Lucide icon.' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'orientation', label: 'Orientation', type: 'select', options: orientationOptions },
  { key: 'reverse', label: 'Reverse', type: 'boolean' },
  { key: 'variant', label: 'Variant', type: 'select', options: [
    { label: 'Solid', value: 'solid' },
    { label: 'Outline', value: 'outline' },
    { label: 'Soft', value: 'soft' },
    { label: 'Subtle', value: 'subtle' },
    { label: 'Ghost', value: 'ghost' },
    { label: 'Naked', value: 'naked' }
  ] },
  { key: 'highlight', label: 'Highlight', type: 'boolean' },
  { key: 'highlightColor', label: 'Highlight Color', type: 'color-token', options: colorOptions },
  { key: 'spotlight', label: 'Spotlight', type: 'boolean' },
  { key: 'spotlightColor', label: 'Spotlight Color', type: 'color-token', options: colorOptions },
  { key: 'to', label: 'Link To', type: 'url', placeholder: 'https://' },
  { key: 'target', label: 'Link Target', type: 'select', options: targetOptions }
]

const sectionFields: PageBlockComponent['fields'] = [
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'icon', label: 'Icon', type: 'icon', help: 'Choose a supported icon for the section.' },
  { key: 'orientation', label: 'Orientation', type: 'select', options: orientationOptions },
  { key: 'reverse', label: 'Reverse', type: 'boolean' },
  { key: 'links', label: 'Links', type: 'link-list', help: 'Add up to 12 safe action links.' },
  {
    key: 'features',
    label: 'Features',
    type: 'object-list',
    itemLabel: 'Feature',
    maxItems: 6,
    itemFields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'orientation', label: 'Orientation', type: 'select', options: orientationOptions },
      { key: 'to', label: 'Destination', type: 'url', placeholder: '/path, #section, or https://' },
      { key: 'target', label: 'Target', type: 'select', options: targetOptions }
    ]
  }
]

const testimonialFields: PageBlockComponent['fields'] = [
  { key: 'quote', label: 'Quote', type: 'textarea', placeholder: 'Add the customer outcome in their own words.' },
  { key: 'author', label: 'Author', type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' }
]

const logoFields: PageBlockComponent['fields'] = [
  { key: 'title', label: 'Title', type: 'text' },
  {
    key: 'items',
    label: 'Logos',
    type: 'object-list',
    itemLabel: 'Logo',
    maxItems: 12,
    itemFields: [
      { key: 'name', label: 'Name', type: 'text' },
      {
        key: 'src',
        label: 'Site asset path',
        type: 'asset-path',
        placeholder: '/assets/id/raw',
        help: 'Use an uploaded HaloPress asset. External image URLs are not stored in portable blocks.'
      },
      { key: 'alt', label: 'Alternative text', type: 'text' }
    ]
  }
]

const faqFields: PageBlockComponent['fields'] = [
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'items',
    label: 'Questions',
    type: 'object-list',
    itemLabel: 'Question',
    maxItems: 12,
    itemFields: [
      { key: 'question', label: 'Question', type: 'text' },
      { key: 'answer', label: 'Answer', type: 'textarea' }
    ]
  }
]

const components: PageBlockComponent[] = [
  {
    key: 'pageHero',
    label: 'Page Hero',
    defaultProps: pageBlockDefinitions.pageHero.defaultProps,
    defaultMedia: {
      url: '',
      alt: ''
    },
    fields: heroFields,
    category: 'Hero',
    icon: 'i-lucide-layout-template',
    summary: 'A prominent introduction with headline, media, and actions.',
    keywords: ['banner', 'headline', 'intro', 'landing'],
    compatibility: 'page',
    preview: { title: 'Hero', description: 'Large headline, description, media, and actions' },
    insertion: 'block'
  },
  {
    key: 'pageCard',
    label: 'Page Card',
    defaultProps: pageBlockDefinitions.pageCard.defaultProps,
    defaultMedia: {
      url: '',
      alt: ''
    },
    fields: cardFields,
    category: 'Content',
    icon: 'i-lucide-square-stack',
    summary: 'A linked content card with optional media and highlight.',
    keywords: ['content', 'feature', 'link', 'tile'],
    compatibility: 'page',
    preview: { title: 'Card', description: 'Compact linked content with media and icon' },
    insertion: 'block'
  },
  {
    key: 'pageSection',
    label: 'Page Section',
    defaultProps: pageBlockDefinitions.pageSection.defaultProps,
    defaultMedia: { url: '', alt: '' },
    fields: sectionFields,
    category: 'Content',
    icon: 'i-lucide-panels-top-left',
    summary: 'A responsive section with optional media, features, and actions.',
    keywords: ['features', 'grid', 'media', 'section'],
    compatibility: 'page',
    preview: { title: 'Section', description: 'Responsive content, features, actions, and media' },
    insertion: 'block'
  },
  {
    key: 'pageTestimonial',
    label: 'Testimonial',
    defaultProps: pageBlockDefinitions.pageTestimonial.defaultProps,
    defaultMedia: { url: '', alt: '' },
    fields: testimonialFields,
    category: 'Trust',
    icon: 'i-lucide-message-square-quote',
    summary: 'A customer quote with typed attribution and optional portrait.',
    keywords: ['author', 'customer', 'quote', 'review'],
    compatibility: 'page',
    preview: { title: 'Testimonial', description: 'Customer quote and attribution' },
    insertion: 'block'
  },
  {
    key: 'pageLogos',
    label: 'Logo Cloud',
    defaultProps: pageBlockDefinitions.pageLogos.defaultProps,
    defaultMedia: { url: '', alt: '' },
    fields: logoFields,
    category: 'Trust',
    icon: 'i-lucide-gallery-horizontal',
    summary: 'A responsive row of customer or partner logos.',
    keywords: ['brands', 'customers', 'logos', 'social proof'],
    compatibility: 'page',
    preview: { title: 'Logo cloud', description: 'Customer or partner proof' },
    insertion: 'block'
  },
  {
    key: 'pageFAQ',
    label: 'FAQ',
    defaultProps: pageBlockDefinitions.pageFAQ.defaultProps,
    defaultMedia: { url: '', alt: '' },
    fields: faqFields,
    category: 'FAQ',
    icon: 'i-lucide-circle-help',
    summary: 'A keyboard-accessible list of questions and answers.',
    keywords: ['accordion', 'answers', 'questions', 'support'],
    compatibility: 'page',
    preview: { title: 'Frequently asked questions', description: 'Accessible accordion answers' },
    insertion: 'block'
  },
  {
    key: 'pageCTA',
    label: 'Page CTA',
    defaultProps: pageBlockDefinitions.pageCTA.defaultProps,
    defaultMedia: {
      url: '',
      alt: ''
    },
    fields: ctaFields,
    category: 'Conversion',
    icon: 'i-lucide-megaphone',
    summary: 'A focused call to action with safe structured links.',
    keywords: ['action', 'button', 'conversion', 'promo'],
    compatibility: 'page',
    preview: { title: 'Call to action', description: 'Focused message with action links' },
    insertion: 'block'
  }
]

export const pageBlockLibraryClassification = {
  pageHero: {
    model: 'legacy-only',
    showDirectly: false,
    rationale: 'New Heroes use the editable pageHero unit; the atom remains registered for stored documents and explicit conversion.'
  },
  pageCard: {
    model: 'legacy-only',
    showDirectly: false,
    rationale: 'General card copy does not justify Inspector-only editing.'
  },
  pageSection: {
    model: 'legacy-only',
    showDirectly: false,
    rationale: 'Feature and media compositions now insert ordinary editable document content.'
  },
  pageTestimonial: {
    model: 'legacy-only',
    showDirectly: false,
    rationale: 'Testimonials now use editable blockquote and attribution content.'
  },
  pageLogos: {
    model: 'configured-block',
    showDirectly: true,
    rationale: 'A finite logo collection keeps asset, alternative-text, and ordering configuration coherent.'
  },
  pageFAQ: {
    model: 'configured-block',
    showDirectly: false,
    rationale: 'The finite accordion item contract preserves keyboard-accessible behavior; the curated FAQ entry inserts it.'
  },
  pageCTA: {
    model: 'legacy-only',
    showDirectly: false,
    rationale: 'Closing copy and link labels now insert as ordinary editable document content.'
  }
} as const satisfies Record<PageBlockComponent['key'], {
  model: 'configured-block' | 'legacy-only'
  showDirectly: boolean
  rationale: string
}>

export const pageBlockRegistry: PageBlockRegistry = {
  components,
  byKey: components.reduce((acc, item) => {
    acc[item.key] = item
    return acc
  }, {} as PageBlockRegistry['byKey'])
}

export function getPageBlockComponent(key: string | undefined) {
  if (!key) return null
  return pageBlockRegistry.byKey[key as keyof typeof pageBlockRegistry.byKey] ?? null
}
