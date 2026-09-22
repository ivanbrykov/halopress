import { z } from 'zod'
import { caseFold } from 'unicode-case-folding'

import { publicPathLookupKey } from './public-routing'
import { publicNavigationDestinationSchema } from './site-presentation'

export const GLOBAL_SITE_MENU_ID = 'global-navigation'
export const GLOBAL_SITE_MENU_NAME = 'Global navigation'
export const SITE_MENU_MAX_ITEMS = 12
export const SITE_MENU_MAX_CHILDREN = 8
export const SITE_MENU_MAX_DYNAMIC_SOURCES = 8
export const SITE_MENU_MAX_SOURCE_FILTERS = 4
export const SITE_MENU_MAX_EXACT_SET_VALUES = 10
export const SITE_MENU_MIN_SOURCE_RESULTS = 1
export const SITE_MENU_MAX_SOURCE_RESULTS = 12

export const SITE_MENU_ICONS = [
  'i-lucide-book-open',
  'i-lucide-circle-help',
  'i-lucide-file-text',
  'i-lucide-folder',
  'i-lucide-globe-2',
  'i-lucide-home',
  'i-lucide-info',
  'i-lucide-link',
  'i-lucide-mail',
  'i-lucide-menu',
  'i-lucide-newspaper',
  'i-lucide-search',
  'i-lucide-tag',
  'i-lucide-user',
  'i-lucide-users'
] as const

export const siteMenuIdSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  'Use letters, numbers, dots, colons, underscores, or hyphens'
)

export const siteMenuNameSchema = z.string().trim().min(1, 'Enter a menu name').max(80)

/**
 * Stable application-side identity for menu names. SQLite's lower() only
 * handles ASCII, so normalize compatibility forms and apply Unicode's full
 * default case folding in application code before persistence.
 */
export function siteMenuNameKey(name: string) {
  return caseFold(name.trim().normalize('NFKC')).normalize('NFKC')
}

export const siteMenuValueSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  'Menu values may use letters, numbers, dots, colons, underscores, or hyphens'
)

export const siteMenuBadgeSchema = z.union([
  z.string().trim().min(1).max(24),
  z.number().finite()
])

export const siteMenuFilterValueSchema = z.union([
  z.string().trim().min(1).max(256),
  z.number().finite(),
  z.boolean()
])

export const siteMenuSchemaKeySchema = z.string().trim().min(1).max(128).regex(
  /^[a-z0-9][a-z0-9_]*$/,
  'Use a stable lowercase Schema key'
)

export const siteMenuFieldIdSchema = siteMenuIdSchema

export const siteMenuSchemaFilterSchema = z.discriminatedUnion('operator', [
  z.object({
    fieldId: siteMenuFieldIdSchema,
    operator: z.literal('exact'),
    value: siteMenuFilterValueSchema
  }).strict(),
  z.object({
    fieldId: siteMenuFieldIdSchema,
    operator: z.literal('exactSet'),
    values: z.array(siteMenuFilterValueSchema)
      .min(1)
      .max(SITE_MENU_MAX_EXACT_SET_VALUES)
  }).strict()
])

export const siteMenuSchemaSortSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('system'),
    field: z.enum(['createdAt', 'updatedAt']),
    direction: z.enum(['asc', 'desc'])
  }).strict(),
  z.object({
    type: z.literal('field'),
    fieldId: siteMenuFieldIdSchema,
    direction: z.enum(['asc', 'desc'])
  }).strict()
])

export const siteMenuSchemaLabelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('systemTitle') }).strict(),
  z.object({ type: z.literal('field'), fieldId: siteMenuFieldIdSchema }).strict()
])

function normalizeSiteMenuPagePrefix(value: string) {
  const input = value.normalize('NFKC').trim()
  if (!input || input.split('/').filter(Boolean).length === 0) return '/'
  return publicPathLookupKey(input, { allowReserved: true })
}

export const siteMenuPagePrefixSchema = z.string().trim().min(1).max(512).refine((value) => {
  try {
    normalizeSiteMenuPagePrefix(value)
    return true
  } catch {
    return false
  }
}, 'Use a normalized Site path prefix').transform(normalizeSiteMenuPagePrefix)

export const siteMenuPageScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fixed'),
    prefix: siteMenuPagePrefixSchema
  }).strict(),
  z.object({ type: z.literal('currentParent') }).strict()
])

export const siteMenuSourceSchema = z.discriminatedUnion('type', [
  z.object({
    version: z.literal(1),
    type: z.literal('schemaQuery'),
    schemaKey: siteMenuSchemaKeySchema,
    filters: z.array(siteMenuSchemaFilterSchema).max(SITE_MENU_MAX_SOURCE_FILTERS).default([]),
    sort: siteMenuSchemaSortSchema,
    label: siteMenuSchemaLabelSchema,
    limit: z.number().int().min(SITE_MENU_MIN_SOURCE_RESULTS).max(SITE_MENU_MAX_SOURCE_RESULTS),
    icon: z.enum(SITE_MENU_ICONS).optional(),
    badge: siteMenuBadgeSchema.optional()
  }).strict(),
  z.object({
    version: z.literal(1),
    type: z.literal('pagePrefix'),
    scope: siteMenuPageScopeSchema,
    sort: z.enum(['title', 'path']).default('title'),
    limit: z.number().int().min(SITE_MENU_MIN_SOURCE_RESULTS).max(SITE_MENU_MAX_SOURCE_RESULTS),
    icon: z.enum(SITE_MENU_ICONS).optional(),
    badge: siteMenuBadgeSchema.optional()
  }).strict()
])

export const siteMenuDynamicItemSchema = z.object({
  kind: z.literal('dynamic'),
  id: siteMenuIdSchema,
  source: siteMenuSourceSchema
}).strict()

export const siteMenuLeafSchema = z.object({
  id: siteMenuIdSchema,
  label: z.string().trim().min(1, 'Enter a label').max(80, 'Use 80 characters or fewer'),
  destination: publicNavigationDestinationSchema,
  value: siteMenuValueSchema.optional(),
  icon: z.enum(SITE_MENU_ICONS).optional(),
  badge: siteMenuBadgeSchema.optional()
}).strict()

export const siteMenuChildSchema = z.union([
  siteMenuLeafSchema,
  siteMenuDynamicItemSchema
])

export const siteMenuStaticItemSchema = siteMenuLeafSchema.extend({
  children: z.array(siteMenuChildSchema).max(SITE_MENU_MAX_CHILDREN).default([])
}).strict()

export const siteMenuItemSchema = z.union([
  siteMenuStaticItemSchema,
  siteMenuDynamicItemSchema
])

function hasDynamicMenuKind(value: unknown): value is { kind: 'dynamic' } {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'dynamic')
}

export const siteMenuDocumentSchema = z.object({
  version: z.literal(1),
  items: z.array(siteMenuItemSchema).max(SITE_MENU_MAX_ITEMS)
}).strict().superRefine((document, context) => {
  const ids = new Set<string>()
  const values = new Set<string>()
  let sourceCount = 0

  for (const [itemIndex, item] of document.items.entries()) {
    const candidates = [
      { candidate: item, path: ['items', itemIndex] },
      ...(hasDynamicMenuKind(item)
        ? []
        : item.children.map((candidate, childIndex) => ({
            candidate,
            path: ['items', itemIndex, 'children', childIndex]
          })))
    ]
    for (const { candidate, path } of candidates) {
      if (hasDynamicMenuKind(candidate)) sourceCount++
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: 'custom',
          message: `Menu item IDs must be unique: ${candidate.id}`,
          path: [...path, 'id']
        })
      }
      ids.add(candidate.id)

      const effectiveValue = hasDynamicMenuKind(candidate)
        ? candidate.id
        : candidate.value || candidate.id
      if (values.has(effectiveValue)) {
        context.addIssue({
          code: 'custom',
          message: `Menu item values must be unique: ${effectiveValue}`,
          path: [...path, 'value']
        })
      }
      values.add(effectiveValue)
    }
  }

  if (sourceCount > SITE_MENU_MAX_DYNAMIC_SOURCES) {
    context.addIssue({
      code: 'custom',
      message: `Menus may contain at most ${SITE_MENU_MAX_DYNAMIC_SOURCES} dynamic sources`,
      path: ['items']
    })
  }
})

function isSafeResolvedTarget(value: string) {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

export const resolvedSiteMenuTargetSchema = z.string().trim().min(1).max(2048).refine(
  isSafeResolvedTarget,
  'Use a canonical Site path or an absolute http or https URL without embedded credentials'
)

export const resolvedSiteMenuLeafSchema = z.object({
  id: siteMenuIdSchema,
  label: z.string().trim().min(1).max(80),
  to: resolvedSiteMenuTargetSchema,
  value: siteMenuValueSchema,
  icon: z.enum(SITE_MENU_ICONS).optional(),
  badge: siteMenuBadgeSchema.optional(),
  target: z.literal('_blank').optional(),
  rel: z.literal('noopener noreferrer').optional()
}).strict().superRefine((item, context) => {
  if (Boolean(item.target) !== Boolean(item.rel)) {
    context.addIssue({
      code: 'custom',
      message: 'External window targets must include noopener noreferrer',
      path: ['target']
    })
  }
})

export const resolvedSiteMenuItemSchema = resolvedSiteMenuLeafSchema.extend({
  children: z.array(resolvedSiteMenuLeafSchema).max(SITE_MENU_MAX_CHILDREN).default([])
}).strict()

export const resolvedSiteMenuDocumentSchema = z.object({
  version: z.literal(1),
  items: z.array(resolvedSiteMenuItemSchema).max(SITE_MENU_MAX_ITEMS)
}).strict().superRefine((document, context) => {
  const ids = new Set<string>()
  const values = new Set<string>()
  for (const item of document.items) {
    for (const candidate of [item, ...item.children]) {
      if (ids.has(candidate.id)) {
        context.addIssue({ code: 'custom', message: `Menu item IDs must be unique: ${candidate.id}`, path: ['items'] })
      }
      ids.add(candidate.id)
      if (values.has(candidate.value)) {
        context.addIssue({ code: 'custom', message: `Menu item values must be unique: ${candidate.value}`, path: ['items'] })
      }
      values.add(candidate.value)
    }
  }
})

// Public delivery uses the validated resolved projection. It deliberately has
// no typed destination, so canonical targets can never be written back into the
// strict persisted document by mistake.
export const publicSiteMenuDocumentSchema = resolvedSiteMenuDocumentSchema

export const siteMenuCreateSchema = z.object({
  name: siteMenuNameSchema
}).strict()

export const siteMenuUpdateSchema = z.object({
  name: siteMenuNameSchema,
  document: siteMenuDocumentSchema
}).strict()

export type SiteMenuLeaf = z.output<typeof siteMenuLeafSchema>
export type SiteMenuDynamicItem = z.output<typeof siteMenuDynamicItemSchema>
export type SiteMenuChild = z.output<typeof siteMenuChildSchema>
export type SiteMenuStaticItem = z.output<typeof siteMenuStaticItemSchema>
export type SiteMenuItem = z.output<typeof siteMenuItemSchema>
export type SiteMenuDocument = z.output<typeof siteMenuDocumentSchema>
export type SiteMenuSource = z.output<typeof siteMenuSourceSchema>
export type SiteMenuSchemaFilter = z.output<typeof siteMenuSchemaFilterSchema>
export type SiteMenuSchemaSort = z.output<typeof siteMenuSchemaSortSchema>
export type SiteMenuCreate = z.output<typeof siteMenuCreateSchema>
export type SiteMenuUpdate = z.output<typeof siteMenuUpdateSchema>
export type ResolvedSiteMenuLeaf = z.output<typeof resolvedSiteMenuLeafSchema>
export type ResolvedSiteMenuItem = z.output<typeof resolvedSiteMenuItemSchema>
export type ResolvedSiteMenuDocument = z.output<typeof resolvedSiteMenuDocumentSchema>
export type PublicSiteMenuDocument = ResolvedSiteMenuDocument

export type SiteMenuUsage = {
  resourceType: 'public-site-shell' | 'site-layout'
  resourceId: string
  label: string
}

export type SiteMenuValidationIssue = {
  path: string
  message: string
}

export type SiteMenuAdminResource = {
  id: string
  name: string
  document: SiteMenuDocument
  malformedStoredValue: boolean
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  usage: SiteMenuUsage[]
  canDelete: boolean
}

export type SiteMenuListResponse = {
  defaultMenuId: typeof GLOBAL_SITE_MENU_ID
  items: SiteMenuAdminResource[]
}

export type SiteMenuSourceFieldOption = {
  fieldId: string
  fieldKey: string
  label: string
  kind: string
  searchMode: 'off' | 'exact' | 'exact_set' | 'range'
  filterable: boolean
  sortable: boolean
  labelEligible: boolean
  enumValues: Array<{ label: string, value: string }>
}

export type SiteMenuSourceSchemaOption = {
  schemaKey: string
  label: string
  fields: SiteMenuSourceFieldOption[]
}

export type SiteMenuSourcePageOption = {
  id: string
  title: string
  path: string
}

export type SiteMenuSourceOptionsResponse = {
  schemas: SiteMenuSourceSchemaOption[]
  pages: SiteMenuSourcePageOption[]
}

export type SiteMenuSourceDiagnostic = {
  sourceId: string
  sourceType: SiteMenuSource['type']
  status: 'ready' | 'empty' | 'context-unavailable' | 'invalid' | 'timeout' | 'error'
  count: number
  message: string
}

export type SiteMenuPreviewResponse = {
  menu: PublicSiteMenu
  digest: string
  context: { pageId: string, canonicalPath: string } | null
  diagnostics: SiteMenuSourceDiagnostic[]
}

export type PublicSiteMenu = {
  id: string
  name: string
  document: PublicSiteMenuDocument
}

export function defaultSiteMenuDocument(): SiteMenuDocument {
  return { version: 1, items: [] }
}

export function siteMenuItemValue(item: SiteMenuLeaf) {
  return item.value || item.id
}

export function isSiteMenuDynamicItem(item: SiteMenuItem | SiteMenuChild): item is SiteMenuDynamicItem {
  return hasDynamicMenuKind(item)
}

export function isSiteMenuStaticItem(item: SiteMenuItem): item is SiteMenuStaticItem {
  return !hasDynamicMenuKind(item)
}
