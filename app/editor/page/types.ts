import type { PageBlockComponentKey } from '~~/shared/page-blocks'

export type { PageBlockComponentKey } from '~~/shared/page-blocks'

export type PageBlockMedia = {
  url?: string
  alt?: string
  width?: number
  height?: number
  requiredAction?: string
}

export type PageBlockAttrs = {
  component: string
  props: Record<string, unknown>
  advanced: Record<string, unknown>
  media: PageBlockMedia
}

export type PageBlockFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'boolean'
  | 'url'
  | 'asset-path'
  | 'link-list'
  | 'icon'
  | 'color-token'
  | 'spacing'
  | 'object-list'

export type PageBlockField = {
  key: string
  label: string
  type: PageBlockFieldType
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  help?: string
  itemLabel?: string
  maxItems?: number
  itemFields?: PageBlockField[]
}

export type PageBlockComponent = {
  key: PageBlockComponentKey
  label: string
  defaultProps: Record<string, unknown>
  defaultMedia: PageBlockMedia
  fields: PageBlockField[]
  category: 'Hero' | 'Content' | 'Trust' | 'FAQ' | 'Conversion'
  icon: string
  summary: string
  keywords: string[]
  compatibility: 'page'
  preview: { title: string; description: string }
  insertion: 'block'
}

export type PageBlockRegistry = {
  components: PageBlockComponent[]
  byKey: Record<PageBlockComponentKey, PageBlockComponent>
}
