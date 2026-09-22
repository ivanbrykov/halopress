import { z } from 'zod'

import { layoutIdSchema } from '../../shared/site-layout'

const uiConfig = z.object({
  widget: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  rows: z.number().int().positive().optional(),
  group: z.string().optional(),
  order: z.number().int().optional(),
  hidden: z.boolean().optional(),
  readonly: z.boolean().optional()
}).strict()

const searchConfig = z.object({
  mode: z.enum(['off', 'exact', 'range', 'exact_set']).optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  fullText: z.boolean().optional()
}).strict()

const listingConfig = z.object({
  titleFieldKey: z.string().nullable().optional(),
  descriptionFieldKey: z.string().nullable().optional(),
  imageFieldKey: z.string().nullable().optional()
}).strict()

const fieldRendererKey = z.enum([
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'link',
  'badge',
  'rich_text',
  'asset',
  'asset_gallery',
  'reference',
  'reference_list'
])

const presentationConfig = z.object({
  contractVersion: z.literal(1),
  preset: z.enum(['generic', 'article', 'catalog']),
  collectionTemplate: z.enum(['list', 'cards', 'catalog-grid']),
  detailTemplate: z.enum(['document', 'article', 'catalog']),
  // Editors use null while clearing the selector. Normalize that wire value
  // back to the optional published SchemaPresentationConfig property.
  layoutId: layoutIdSchema.nullable().optional().transform(value => value ?? undefined),
  slugFieldId: z.string().min(1).optional(),
  structuredDataType: z.enum(['WebPage', 'Article', 'BlogPosting', 'NewsArticle', 'Product']).optional(),
  slots: z.object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    gallery: z.string().min(1).optional(),
    price: z.string().min(1).optional()
  }).strict().optional(),
  renderers: z.array(z.object({
    fieldId: z.string().min(1),
    renderer: fieldRendererKey
  }).strict()).optional()
}).strict()

const schemaKeySchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_]*$/)

const relConfig = z.object({
  kind: z.enum(['ref', 'ref_list', 'poly_ref', 'asset_ref']),
  target: z.string(),
  cardinality: z.enum(['one', 'many']),
  editMode: z.enum(['pick', 'inline_create', 'inline_edit', 'embed_snapshot']).optional(),
  default: z.enum(['currentUser', 'none']).optional(),
  picker: z.string().optional(),
  inline: z.object({
    ui: z.string().optional(),
    createOn: z.enum(['save']).optional()
  }).strict().optional()
}).strict()

const fieldKind = z.enum([
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'url',
  'enum',
  'richtext',
  'reference',
  'asset',
  'asset_list'
])

export const fieldNodeSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  kind: fieldKind,
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  enumValues: z.array(z.object({ label: z.string(), value: z.string() }).strict()).optional(),
  ui: uiConfig.optional(),
  search: searchConfig.optional(),
  rel: relConfig.optional(),
  assetList: z.object({
    minItems: z.number().int().min(0).optional(),
    maxItems: z.number().int().positive().optional()
  }).strict().optional(),
  system: z.boolean().optional()
}).strict().superRefine((field, ctx) => {
  if (field.search?.fullText && !['string', 'text', 'richtext'].includes(field.kind)) {
    ctx.addIssue({
      code: 'custom',
      path: ['search', 'fullText'],
      message: 'Full-text search requires string, text, or richtext kind'
    })
  }
  if (field.assetList && field.kind !== 'asset_list') {
    ctx.addIssue({ code: 'custom', path: ['assetList'], message: 'Asset list constraints require asset_list kind' })
  }
  if (field.assetList?.minItems != null && field.assetList?.maxItems != null
    && field.assetList.minItems > field.assetList.maxItems) {
    ctx.addIssue({ code: 'custom', path: ['assetList', 'minItems'], message: 'Minimum cannot exceed maximum' })
  }
})

export const schemaAstSchema = z.object({
  schemaKey: schemaKeySchema,
  title: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(fieldNodeSchema),
  listing: listingConfig.optional(),
  presentation: presentationConfig.optional()
}).strict()
