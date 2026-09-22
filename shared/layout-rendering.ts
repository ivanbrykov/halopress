import { z } from 'zod'

import { layoutDocumentSchema, layoutIdSchema, layoutNameSchema, layoutRegionKeys } from './site-layout'
import { publicSiteMenuDocumentSchema, siteMenuIdSchema } from './site-menu'
import { SITE_THEME_CONTRACT_VERSION } from './site-theme'

export const LAYOUT_RENDERING_CONTRACT_VERSION = 1 as const
export const LAYOUT_RENDERING_MAX_DIAGNOSTICS = 16
export const LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES = 128

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const safePathSchema = z.string().min(1).max(2048).refine(
  value => value.startsWith('/') && !value.startsWith('//'),
  'Expected a canonical Site path'
)
const safeAssetUrlSchema = z.string().max(2048).refine((value) => {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}, 'Expected a safe Site asset URL')

export const layoutOutlineEntrySchema = z.object({
  id: z.string().min(1).max(128).regex(/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}._:-]*$/u),
  level: z.number().int().min(1).max(4),
  text: z.string().min(1).max(200)
}).strict()

export const layoutDiagnosticSchema = z.object({
  code: z.enum([
    'layout-unassigned',
    'layout-unavailable',
    'menu-missing',
    'menu-malformed',
    'page-list-unavailable',
    'element-unavailable',
    'logo-missing',
    'outline-truncated'
  ]),
  elementId: layoutIdSchema.optional(),
  message: z.string().min(1).max(500)
}).strict()

export const layoutRenderContextSchema = z.object({
  visibility: z.enum(['public', 'preview']),
  documentKind: z.enum(['page', 'schema', 'content']),
  documentId: layoutIdSchema,
  schemaKey: layoutIdSchema.nullable(),
  schemaVersion: z.number().int().min(1).nullable(),
  canonicalPath: safePathSchema.nullable()
}).strict()

export const layoutThemeProjectionSchema = z.object({
  contractVersion: z.literal(SITE_THEME_CONTRACT_VERSION),
  siteModeEnabled: z.boolean(),
  revision: digestSchema,
  stylesheetRevision: digestSchema,
  stylesheetUrl: z.string().url().max(2048),
  colorMode: z.enum(['system', 'light', 'dark'])
}).strict()

export const layoutSiteIdentitySchema = z.object({
  revision: digestSchema,
  siteName: z.string().min(1).max(120),
  description: z.string().max(320),
  locale: z.string().min(2).max(16),
  logoUrl: safeAssetUrlSchema.nullable(),
  faviconUrl: safeAssetUrlSchema,
  socialImageUrl: safeAssetUrlSchema
}).strict()

export const layoutMenuProjectionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    menuSetId: siteMenuIdSchema,
    name: z.string().min(1).max(80),
    document: publicSiteMenuDocumentSchema,
    digest: digestSchema
  }).strict(),
  z.object({
    status: z.literal('missing'),
    menuSetId: siteMenuIdSchema,
    document: publicSiteMenuDocumentSchema,
    digest: digestSchema
  }).strict(),
  z.object({
    status: z.literal('malformed'),
    menuSetId: siteMenuIdSchema,
    document: publicSiteMenuDocumentSchema,
    digest: digestSchema
  }).strict()
])

export const layoutPageListItemSchema = z.object({
  id: layoutIdSchema,
  title: z.string().min(1).max(500),
  path: safePathSchema,
  publishedAt: z.string().datetime()
}).strict()

const resolvedElementBase = {
  id: layoutIdSchema,
  region: z.enum(layoutRegionKeys),
  order: z.number().int().min(0).max(63)
} as const

export const resolvedLayoutElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...resolvedElementBase,
    type: z.literal('page-content'),
    props: z.object({}).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('site-logo'),
    props: z.object({
      size: z.enum(['small', 'medium', 'large']),
      link: z.enum(['home', 'none']),
      siteName: z.string().min(1).max(120),
      logoUrl: safeAssetUrlSchema.nullable()
    }).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('site-title'),
    props: z.object({
      emphasis: z.enum(['normal', 'strong']),
      link: z.enum(['home', 'none']),
      siteName: z.string().min(1).max(120)
    }).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('menu'),
    props: z.object({
      menuSetId: siteMenuIdSchema,
      orientation: z.enum(['horizontal', 'vertical']),
      menu: layoutMenuProjectionSchema
    }).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('page-list'),
    props: z.object({
      scope: z.enum(['all-pages', 'current-section']),
      sort: z.enum(['title-ascending', 'recently-updated']),
      limit: z.number().int().min(1).max(50),
      items: z.array(layoutPageListItemSchema).max(50)
    }).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('table-of-contents'),
    props: z.object({
      maxDepth: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      marker: z.enum(['none', 'ordered']),
      items: z.array(layoutOutlineEntrySchema).max(LAYOUT_RENDERING_MAX_OUTLINE_ENTRIES)
    }).strict()
  }).strict(),
  z.object({
    ...resolvedElementBase,
    type: z.literal('copyright'),
    props: z.object({
      format: z.enum(['year-site', 'site-year']),
      startYear: z.number().int().min(1900).max(2100).optional(),
      text: z.string().min(1).max(500)
    }).strict()
  }).strict()
])

const projectionBase = {
  contractVersion: z.literal(LAYOUT_RENDERING_CONTRACT_VERSION),
  context: layoutRenderContextSchema,
  revision: digestSchema
} as const

export const layoutRenderProjectionSchema = z.discriminatedUnion('status', [
  z.object({
    ...projectionBase,
    status: z.literal('disabled'),
    reason: z.literal('site-disabled')
  }).strict(),
  z.object({
    ...projectionBase,
    status: z.literal('built-in-fallback'),
    reason: z.enum(['unassigned', 'explicit-assignment-unavailable']),
    diagnostics: z.array(layoutDiagnosticSchema).max(LAYOUT_RENDERING_MAX_DIAGNOSTICS)
  }).strict(),
  z.object({
    ...projectionBase,
    status: z.literal('ready'),
    source: z.enum(['page', 'schema', 'site']),
    layoutId: layoutIdSchema,
    name: layoutNameSchema,
    layoutRevision: z.number().int().min(1),
    document: layoutDocumentSchema,
    theme: layoutThemeProjectionSchema,
    site: layoutSiteIdentitySchema,
    elements: z.array(resolvedLayoutElementSchema).min(1).max(64),
    diagnostics: z.array(layoutDiagnosticSchema).max(LAYOUT_RENDERING_MAX_DIAGNOSTICS)
  }).strict()
])

export type LayoutOutlineEntry = z.output<typeof layoutOutlineEntrySchema>
export type LayoutDiagnostic = z.output<typeof layoutDiagnosticSchema>
export type LayoutRenderContext = z.output<typeof layoutRenderContextSchema>
export type LayoutThemeProjection = z.output<typeof layoutThemeProjectionSchema>
export type LayoutSiteIdentity = z.output<typeof layoutSiteIdentitySchema>
export type LayoutMenuProjection = z.output<typeof layoutMenuProjectionSchema>
export type LayoutPageListItem = z.output<typeof layoutPageListItemSchema>
export type ResolvedLayoutElement = z.output<typeof resolvedLayoutElementSchema>
export type LayoutRenderProjection = z.output<typeof layoutRenderProjectionSchema>

export function parseLayoutRenderProjection(value: unknown) {
  return layoutRenderProjectionSchema.safeParse(value)
}
