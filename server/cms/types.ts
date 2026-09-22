export type UiConfig = {
  widget?: string
  placeholder?: string
  help?: string
  rows?: number
  group?: string
  order?: number
  hidden?: boolean
  readonly?: boolean
}

export type SearchConfig = {
  mode?: 'off' | 'exact' | 'range' | 'exact_set'
  filterable?: boolean
  sortable?: boolean
  fullText?: boolean
}

export type ListingConfig = {
  titleFieldKey?: string | null
  descriptionFieldKey?: string | null
  imageFieldKey?: string | null
}

export type PresentationPreset = 'generic' | 'article' | 'catalog'
export type CollectionTemplate = 'list' | 'cards' | 'catalog-grid'
export type DetailTemplate = 'document' | 'article' | 'catalog'
export type PresentationSlot = 'title' | 'description' | 'image' | 'body' | 'gallery' | 'price'
export type StructuredDataType = 'WebPage' | 'Article' | 'BlogPosting' | 'NewsArticle' | 'Product'
export type FieldRendererKey =
  | 'text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'link'
  | 'badge'
  | 'rich_text'
  | 'asset'
  | 'asset_gallery'
  | 'reference'
  | 'reference_list'

export type SchemaPresentationConfig = {
  contractVersion: 1
  preset: PresentationPreset
  collectionTemplate: CollectionTemplate
  detailTemplate: DetailTemplate
  // Stable public Layout resource identity. Resolution deliberately follows
  // that resource's current revision rather than pinning a saved revision.
  layoutId?: string
  slugFieldId?: string
  structuredDataType?: StructuredDataType
  slots?: Partial<Record<PresentationSlot, string>>
  renderers?: Array<{ fieldId: string; renderer: FieldRendererKey }>
}

export type CompiledSchemaPresentation = Omit<SchemaPresentationConfig, 'slots' | 'renderers'> & {
  schemaVersion: number
  slugField?: { fieldId: string; fieldKey: string }
  slots: Partial<Record<PresentationSlot, { fieldId: string; fieldKey: string }>>
  fields: Array<{
    fieldId: string
    fieldKey: string
    kind: FieldKind
    renderer: FieldRendererKey
    title?: string
  }>
}

export type RelConfig = {
  kind: 'ref' | 'ref_list' | 'poly_ref' | 'asset_ref'
  target: string // system:User | system:Asset | content:SchemaKey
  cardinality: 'one' | 'many'
  editMode?: 'pick' | 'inline_create' | 'inline_edit' | 'embed_snapshot'
  default?: 'currentUser' | 'none'
  picker?: string
  inline?: {
    ui?: string
    createOn?: 'save'
  }
}

export type FieldKind =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'url'
  | 'enum'
  | 'richtext'
  | 'reference'
  | 'asset'
  | 'asset_list'

export type FieldNode = {
  id: string
  key: string
  kind: FieldKind
  title?: string
  description?: string
  required?: boolean
  default?: unknown
  enumValues?: { label: string; value: string }[]
  ui?: UiConfig
  search?: SearchConfig
  rel?: RelConfig
  assetList?: { minItems?: number; maxItems?: number }
  system?: boolean
}

export type SchemaAst = {
  schemaKey: string
  title: string
  description?: string
  fields: FieldNode[]
  listing?: ListingConfig
  presentation?: SchemaPresentationConfig
}

export type SchemaRegistry = {
  schemaKey: string
  version: number
  title: string
  listing?: ListingConfig
  presentation?: CompiledSchemaPresentation
  fields: Array<{
    fieldId: string
    key: string
    kind: FieldKind
    title?: string
    description?: string
    required?: boolean
    enumValues?: { label: string; value: string }[]
    ui?: UiConfig
    search?: SearchConfig
    rel?: RelConfig
    assetList?: { minItems?: number; maxItems?: number }
    system?: boolean
  }>
  relations: Array<{
    fieldId: string
    fieldKey: string
    targetKind: 'content' | 'user' | 'asset'
    targetSchemaKey?: string
    kind: RelConfig['kind']
  }>
}
