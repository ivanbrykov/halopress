import { z } from 'zod'
import { caseFold } from 'unicode-case-folding'

import { GLOBAL_SITE_MENU_ID } from './site-menu'

export const LAYOUT_DOCUMENT_VERSION = 1 as const

export const layoutViewportKeys = Object.freeze(['mobile', 'tablet', 'desktop'] as const)
export const layoutRegionKeys = Object.freeze(['header', 'left-sidebar', 'content', 'right-sidebar', 'footer'] as const)
export const layoutElementTypes = Object.freeze([
  'page-content',
  'site-logo',
  'site-title',
  'menu',
  'page-list',
  'table-of-contents',
  'copyright'
] as const)
export const layoutPresetKeys = Object.freeze([
  'blank',
  'grid',
  'header-footer',
  'header-footer-justified',
  'header-right-sidebar',
  'header-right-sidebar-justified',
  'header-left-right-sidebars',
  'header-left-right-sidebars-justified'
] as const)

export type LayoutViewport = typeof layoutViewportKeys[number]
export type LayoutRegionKey = typeof layoutRegionKeys[number]
export type LayoutElementType = typeof layoutElementTypes[number]
export type LayoutPresetKey = typeof layoutPresetKeys[number]

export type DeepReadonly<T> = T extends (...args: any[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

/** Recursively protects exported source registries from consumer mutation. */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value as DeepReadonly<T>
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value) as DeepReadonly<T>
}

export const layoutIdSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  'Use letters, numbers, dots, colons, underscores, or hyphens'
)
export const layoutElementIdSchema = layoutIdSchema
export const layoutNameSchema = z.string().trim().min(1, 'Enter a Layout name').max(80)

/**
 * Persisted Layout names use application-owned Unicode identity. SQLite's
 * lower() is ASCII-only and cannot enforce the intended name uniqueness.
 */
export function layoutNameKey(name: string) {
  return caseFold(name.trim().normalize('NFKC')).normalize('NFKC')
}

const responsivePlacementSchema = z.object({
  row: z.number().int().min(1).max(12),
  column: z.number().int().min(1).max(12),
  span: z.number().int().min(1).max(12),
  visibility: z.enum(['visible', 'hidden'])
}).strict()

const regionSchema = z.object({
  id: z.enum(layoutRegionKeys),
  flow: z.enum(['start', 'center', 'end', 'space-between']),
  placement: z.object({
    mobile: responsivePlacementSchema,
    tablet: responsivePlacementSchema,
    desktop: responsivePlacementSchema
  }).strict()
}).strict()

const elementBase = {
  id: layoutElementIdSchema,
  region: z.enum(layoutRegionKeys),
  order: z.number().int().min(0).max(63)
} as const

const pageContentElementSchema = z.object({
  ...elementBase,
  type: z.literal('page-content'),
  props: z.object({}).strict()
}).strict()

const siteLogoElementSchema = z.object({
  ...elementBase,
  type: z.literal('site-logo'),
  props: z.object({
    size: z.enum(['small', 'medium', 'large']),
    link: z.enum(['home', 'none'])
  }).strict()
}).strict()

const siteTitleElementSchema = z.object({
  ...elementBase,
  type: z.literal('site-title'),
  props: z.object({
    emphasis: z.enum(['normal', 'strong']),
    link: z.enum(['home', 'none'])
  }).strict()
}).strict()

const menuElementSchema = z.object({
  ...elementBase,
  type: z.literal('menu'),
  props: z.object({
    menuSetId: layoutIdSchema,
    orientation: z.enum(['horizontal', 'vertical'])
  }).strict()
}).strict()

const pageListElementSchema = z.object({
  ...elementBase,
  type: z.literal('page-list'),
  props: z.object({
    scope: z.enum(['all-pages', 'current-section']),
    sort: z.enum(['title-ascending', 'recently-updated']),
    limit: z.number().int().min(1).max(50)
  }).strict()
}).strict()

const tableOfContentsElementSchema = z.object({
  ...elementBase,
  type: z.literal('table-of-contents'),
  props: z.object({
    maxDepth: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    marker: z.enum(['none', 'ordered'])
  }).strict()
}).strict()

const copyrightElementSchema = z.object({
  ...elementBase,
  type: z.literal('copyright'),
  props: z.object({
    format: z.enum(['year-site', 'site-year']),
    startYear: z.number().int().min(1900).max(2100).optional()
  }).strict()
}).strict()

export const layoutElementSchema = z.discriminatedUnion('type', [
  pageContentElementSchema,
  siteLogoElementSchema,
  siteTitleElementSchema,
  menuElementSchema,
  pageListElementSchema,
  tableOfContentsElementSchema,
  copyrightElementSchema
])

const gridSchema = z.object({
  maxWidth: z.enum(['content', 'wide', 'full']),
  gap: z.enum(['none', 'compact', 'comfortable', 'spacious']),
  columns: z.object({
    mobile: z.literal(4),
    tablet: z.literal(8),
    desktop: z.literal(12)
  }).strict(),
  regions: z.array(regionSchema).min(1).max(layoutRegionKeys.length)
}).strict()

const allowedRegionsByType: Record<LayoutElementType, readonly LayoutRegionKey[]> = {
  'page-content': ['content'],
  'site-logo': ['header', 'footer'],
  'site-title': ['header', 'footer'],
  menu: ['header', 'left-sidebar', 'right-sidebar', 'footer'],
  'page-list': ['left-sidebar', 'right-sidebar', 'footer'],
  'table-of-contents': ['left-sidebar', 'right-sidebar'],
  copyright: ['footer']
}

const layoutDocumentObjectSchema = z.object({
  version: z.literal(LAYOUT_DOCUMENT_VERSION),
  layoutId: layoutIdSchema,
  name: layoutNameSchema,
  grid: gridSchema,
  elements: z.array(layoutElementSchema).min(1).max(64)
}).strict()

type ValidatedLayoutDocument = z.output<typeof layoutDocumentObjectSchema>

function compareStableIdentifier(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Produces the sole canonical persisted/projection shape. Relative element
 * order is semantic; numeric gaps and caller array order are not. Explicit
 * reconstruction also keeps JSON object-key order defined by this schema.
 */
function canonicalizeValidatedLayoutDocument(document: ValidatedLayoutDocument): ValidatedLayoutDocument {
  const regionOrder = new Map(layoutRegionKeys.map((region, index) => [region, index]))
  const nextElementOrder = new Map<LayoutRegionKey, number>()
  return {
    version: document.version,
    layoutId: document.layoutId,
    name: document.name,
    grid: {
      maxWidth: document.grid.maxWidth,
      gap: document.grid.gap,
      columns: {
        mobile: document.grid.columns.mobile,
        tablet: document.grid.columns.tablet,
        desktop: document.grid.columns.desktop
      },
      regions: [...document.grid.regions]
        .sort((left, right) => regionOrder.get(left.id)! - regionOrder.get(right.id)!)
        .map(region => ({
          id: region.id,
          flow: region.flow,
          placement: {
            mobile: { ...region.placement.mobile },
            tablet: { ...region.placement.tablet },
            desktop: { ...region.placement.desktop }
          }
        }))
    },
    elements: [...document.elements]
      .sort((left, right) => (
        regionOrder.get(left.region)! - regionOrder.get(right.region)! ||
        left.order - right.order ||
        compareStableIdentifier(left.id, right.id)
      ))
      .map((element) => {
        const order = nextElementOrder.get(element.region) ?? 0
        nextElementOrder.set(element.region, order + 1)
        return layoutElementSchema.parse({ ...element, order })
      })
  }
}

const validatedLayoutDocumentSchema = layoutDocumentObjectSchema.superRefine((document, context) => {
  const regionIds = new Set<LayoutRegionKey>()
  for (const [index, region] of document.grid.regions.entries()) {
    if (regionIds.has(region.id)) {
      context.addIssue({ code: 'custom', message: `Layout regions must be unique: ${region.id}`, path: ['grid', 'regions', index, 'id'] })
    }
    regionIds.add(region.id)
  }

  for (const viewport of layoutViewportKeys) {
    const columnCount = document.grid.columns[viewport]
    const occupied = new Set<string>()
    for (const [index, region] of document.grid.regions.entries()) {
      const placement = region.placement[viewport]
      if (placement.column + placement.span - 1 > columnCount) {
        context.addIssue({
          code: 'custom',
          message: `${viewport} placement exceeds the ${columnCount}-column grid`,
          path: ['grid', 'regions', index, 'placement', viewport]
        })
        continue
      }
      if (placement.visibility === 'hidden') continue
      for (let column = placement.column; column < placement.column + placement.span; column += 1) {
        const cell = `${placement.row}:${column}`
        if (occupied.has(cell)) {
          context.addIssue({
            code: 'custom',
            message: `${viewport} regions must not overlap`,
            path: ['grid', 'regions', index, 'placement', viewport]
          })
          break
        }
        occupied.add(cell)
      }
    }
  }

  const contentRegion = document.grid.regions.find(region => region.id === 'content')
  if (!contentRegion) {
    context.addIssue({ code: 'custom', message: 'Every Layout requires a content region', path: ['grid', 'regions'] })
  } else {
    for (const viewport of layoutViewportKeys) {
      if (contentRegion.placement[viewport].visibility !== 'visible') {
        context.addIssue({
          code: 'custom',
          message: 'The Page content region must remain visible at every viewport',
          path: ['grid', 'regions', document.grid.regions.indexOf(contentRegion), 'placement', viewport, 'visibility']
        })
      }
    }
  }

  const elementIds = new Set<string>()
  const regionOrders = new Set<string>()
  let pageContentCount = 0
  for (const [index, element] of document.elements.entries()) {
    if (elementIds.has(element.id)) {
      context.addIssue({ code: 'custom', message: `Layout element IDs must be unique: ${element.id}`, path: ['elements', index, 'id'] })
    }
    elementIds.add(element.id)

    const orderIdentity = `${element.region}:${element.order}`
    if (regionOrders.has(orderIdentity)) {
      context.addIssue({ code: 'custom', message: 'Element order must be unique within a region', path: ['elements', index, 'order'] })
    }
    regionOrders.add(orderIdentity)

    if (!regionIds.has(element.region)) {
      context.addIssue({ code: 'custom', message: `Element region is not present: ${element.region}`, path: ['elements', index, 'region'] })
    }
    if (!allowedRegionsByType[element.type].includes(element.region)) {
      context.addIssue({ code: 'custom', message: `${element.type} is not allowed in ${element.region}`, path: ['elements', index, 'region'] })
    }
    if (element.type === 'page-content') pageContentCount += 1
  }
  if (pageContentCount !== 1) {
    context.addIssue({ code: 'custom', message: 'Every Layout requires exactly one Page content element', path: ['elements'] })
  }
}).transform(canonicalizeValidatedLayoutDocument)

// Run the forbidden scan before strict structural parsing. This keeps direct
// exported-schema consumers (#71/#73) from receiving Zod unrecognized-key
// diagnostics that echo a forbidden framework/runtime property name.
const guardedLayoutDocumentInputSchema = z.unknown().superRefine((value, context) => {
  for (const issue of findForbiddenLayoutData(value)) {
    context.addIssue({
      code: 'custom',
      message: issue.message,
      path: issue.path.split('.').filter(Boolean)
    })
  }
})

export const layoutDocumentSchema = guardedLayoutDocumentInputSchema.pipe(validatedLayoutDocumentSchema)

export type LayoutElement = z.output<typeof layoutElementSchema>
export type LayoutDocument = z.output<typeof layoutDocumentSchema>

export type LayoutValidationIssue = {
  path: string
  message: string
  kind: 'forbidden' | 'invalid'
}

const forbiddenLayoutKeys = new Set([
  'nuxtlayout',
  'layout',
  'component',
  'componentkey',
  'runtimecomponentkey',
  'import',
  'path',
  'class',
  'classname',
  'tailwind',
  'ui',
  'slots',
  'template',
  'html',
  'css',
  'script',
  '__proto__',
  'prototype',
  'constructor'
])

const forbiddenLayoutIdentifiers = [
  /app\/layouts\//i,
  /(?:^|[/#])components(?:\/|$)/i,
  /^(?:~|~~)\//,
  /^U(?=[A-Z])(?=.*[a-z])[A-Za-z0-9]*$/,
  /^(?:[A-Z][a-z0-9]+){2,}$/,
  /^Desk(?:Layout|Header|Sidebar|Shell|Navigation|Workspace)$/,
  /^SiteWorkspaceShell$/,
  /^NavigationMenuItem$/,
  /\.vue$/i
]

function isForbiddenLayoutIdentifier(value: string) {
  return forbiddenLayoutIdentifiers.some(pattern => pattern.test(value))
}

/**
 * Defense in depth for persisted public rendering contracts. Zod strictness
 * rejects unknown fields; this traversal also reports dangerous framework and
 * executable vocabulary wherever an untrusted document attempts to hide it.
 */
export function findForbiddenLayoutData(value: unknown): LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = []
  const seen = new Set<unknown>()
  const visit = (candidate: unknown, path: Array<string | number>) => {
    if (typeof candidate === 'string') {
      if (isForbiddenLayoutIdentifier(candidate)) {
        issues.push({ path: path.join('.'), message: 'Framework or runtime identifier is not allowed', kind: 'forbidden' })
      }
      return
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, [...path, index]))
      return
    }
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      const keyPath = [...path, key]
      if (forbiddenLayoutKeys.has(key.toLowerCase())) {
        issues.push({ path: keyPath.join('.'), message: `Persisted Layouts cannot contain ${key}`, kind: 'forbidden' })
      }
      if (isForbiddenLayoutIdentifier(key)) {
        // Never echo an unsafe property name through issue paths or messages.
        // Continue scanning its value at the safe parent path so nested
        // executable data still fails closed without leaking the raw key.
        issues.push({
          path: path.join('.'),
          message: 'Persisted Layout contains a forbidden framework or runtime property name',
          kind: 'forbidden'
        })
        visit(nested, path)
      } else {
        visit(nested, keyPath)
      }
    }
  }
  visit(value, [])
  return issues
}

function zodIssues(error: z.ZodError): LayoutValidationIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    kind: 'invalid'
  }))
}

export function parseLayoutDocument(value: unknown) {
  const forbidden = findForbiddenLayoutData(value)
  if (forbidden.length) return { success: false as const, issues: forbidden }
  const parsed = layoutDocumentSchema.safeParse(value)
  if (!parsed.success) return { success: false as const, issues: zodIssues(parsed.error) }
  return { success: true as const, document: parsed.data }
}

/** Serializes only the canonical, strictly validated Layout document shape. */
export function serializeLayoutDocument(document: LayoutDocument) {
  return JSON.stringify(layoutDocumentSchema.parse(document))
}

export type LayoutElementOfType<Type extends LayoutElementType> = Extract<LayoutElement, { type: Type }>
export type LayoutElementProps<Type extends LayoutElementType> = LayoutElementOfType<Type>['props']

export type LayoutInspectorFieldDescriptor<Key extends string = string> = {
  key: Key
  label: string
  control: 'select' | 'integer' | 'resource'
  required: boolean
  options?: Array<{ label: string, value: string | number }>
  minimum?: number
  maximum?: number
  resourceType?: 'menu-set'
}

export type LayoutElementDescriptorFor<Type extends LayoutElementType> = {
  type: Type
  label: string
  summary: string
  icon: string
  allowedRegions: readonly LayoutRegionKey[]
  defaultProps: LayoutElementProps<Type>
  inspectorFields: readonly LayoutInspectorFieldDescriptor<Extract<keyof LayoutElementProps<Type>, string>>[]
  reference: Type extends 'menu'
    ? { kind: 'menu-set', prop: Extract<keyof LayoutElementProps<Type>, 'menuSetId'>, resolution: 'live', onDelete: 'restrict' }
    : { kind: 'none' }
  deletion: Type extends 'page-content' ? 'required' : 'removable'
  required: boolean
}

export type LayoutElementDescriptor = {
  [Type in LayoutElementType]: LayoutElementDescriptorFor<Type>
}[LayoutElementType]

function descriptor<Type extends LayoutElementType>(definition: LayoutElementDescriptorFor<Type>) {
  return deepFreeze(structuredClone(definition))
}

const layoutElementRegistryDefinition = {
  'page-content': descriptor({
    type: 'page-content',
    label: 'Page content',
    summary: 'The single slot that receives the resolved Page or Schema content.',
    icon: 'i-lucide-file-text',
    allowedRegions: allowedRegionsByType['page-content'],
    defaultProps: {},
    inspectorFields: [],
    reference: { kind: 'none' },
    deletion: 'required',
    required: true
  }),
  'site-logo': descriptor({
    type: 'site-logo',
    label: 'Site logo',
    summary: 'The current Site identity logo.',
    icon: 'i-lucide-image',
    allowedRegions: allowedRegionsByType['site-logo'],
    defaultProps: { size: 'medium', link: 'home' },
    inspectorFields: [
      { key: 'size', label: 'Size', control: 'select', required: true, options: ['small', 'medium', 'large'].map(value => ({ label: value, value })) },
      { key: 'link', label: 'Link', control: 'select', required: true, options: [{ label: 'Home', value: 'home' }, { label: 'None', value: 'none' }] }
    ],
    reference: { kind: 'none' },
    deletion: 'removable',
    required: false
  }),
  'site-title': descriptor({
    type: 'site-title',
    label: 'Site title',
    summary: 'The current Site identity title.',
    icon: 'i-lucide-heading-1',
    allowedRegions: allowedRegionsByType['site-title'],
    defaultProps: { emphasis: 'strong', link: 'home' },
    inspectorFields: [
      { key: 'emphasis', label: 'Emphasis', control: 'select', required: true, options: ['normal', 'strong'].map(value => ({ label: value, value })) },
      { key: 'link', label: 'Link', control: 'select', required: true, options: [{ label: 'Home', value: 'home' }, { label: 'None', value: 'none' }] }
    ],
    reference: { kind: 'none' },
    deletion: 'removable',
    required: false
  }),
  menu: descriptor({
    type: 'menu',
    label: 'Menu set',
    summary: 'A live reference to a named Menu set.',
    icon: 'i-lucide-menu',
    allowedRegions: allowedRegionsByType.menu,
    defaultProps: { menuSetId: GLOBAL_SITE_MENU_ID, orientation: 'horizontal' },
    inspectorFields: [
      { key: 'menuSetId', label: 'Menu set', control: 'resource', required: true, resourceType: 'menu-set' },
      { key: 'orientation', label: 'Orientation', control: 'select', required: true, options: ['horizontal', 'vertical'].map(value => ({ label: value, value })) }
    ],
    reference: { kind: 'menu-set', prop: 'menuSetId', resolution: 'live', onDelete: 'restrict' },
    deletion: 'removable',
    required: false
  }),
  'page-list': descriptor({
    type: 'page-list',
    label: 'Page list',
    summary: 'A bounded semantic list of canonical Pages.',
    icon: 'i-lucide-list',
    allowedRegions: allowedRegionsByType['page-list'],
    defaultProps: { scope: 'all-pages', sort: 'title-ascending', limit: 12 },
    inspectorFields: [
      { key: 'scope', label: 'Scope', control: 'select', required: true, options: ['all-pages', 'current-section'].map(value => ({ label: value, value })) },
      { key: 'sort', label: 'Sort', control: 'select', required: true, options: ['title-ascending', 'recently-updated'].map(value => ({ label: value, value })) },
      { key: 'limit', label: 'Limit', control: 'integer', required: true, minimum: 1, maximum: 50 }
    ],
    reference: { kind: 'none' },
    deletion: 'removable',
    required: false
  }),
  'table-of-contents': descriptor({
    type: 'table-of-contents',
    label: 'Table of contents',
    summary: 'A bounded outline of resolved content headings.',
    icon: 'i-lucide-list-tree',
    allowedRegions: allowedRegionsByType['table-of-contents'],
    defaultProps: { maxDepth: 3, marker: 'none' },
    inspectorFields: [
      { key: 'maxDepth', label: 'Maximum depth', control: 'select', required: true, options: [2, 3, 4].map(value => ({ label: String(value), value })) },
      { key: 'marker', label: 'Marker', control: 'select', required: true, options: ['none', 'ordered'].map(value => ({ label: value, value })) }
    ],
    reference: { kind: 'none' },
    deletion: 'removable',
    required: false
  }),
  copyright: descriptor({
    type: 'copyright',
    label: 'Copyright',
    summary: 'Current year and Site title copyright text.',
    icon: 'i-lucide-copyright',
    allowedRegions: allowedRegionsByType.copyright,
    defaultProps: { format: 'year-site' },
    inspectorFields: [
      { key: 'format', label: 'Format', control: 'select', required: true, options: ['year-site', 'site-year'].map(value => ({ label: value, value })) },
      { key: 'startYear', label: 'Start year', control: 'integer', required: false, minimum: 1900, maximum: 2100 }
    ],
    reference: { kind: 'none' },
    deletion: 'removable',
    required: false
  })
} satisfies { [Type in LayoutElementType]: DeepReadonly<LayoutElementDescriptorFor<Type>> }

export const layoutElementRegistry = deepFreeze(layoutElementRegistryDefinition)

export const layoutElementDescriptors: readonly DeepReadonly<LayoutElementDescriptor>[] = deepFreeze(
  layoutElementTypes.map(type => layoutElementRegistry[type])
)

type LayoutPresetTemplate = Omit<LayoutDocument, 'layoutId' | 'name'>
type LayoutPresetDefinition = {
  key: LayoutPresetKey
  label: string
  summary: string
  document: LayoutPresetTemplate
}

const placement = (row: number, column: number, span: number, visibility: 'visible' | 'hidden' = 'visible') => ({ row, column, span, visibility })
const region = (
  id: LayoutRegionKey,
  mobile: ReturnType<typeof placement>,
  tablet: ReturnType<typeof placement>,
  desktop: ReturnType<typeof placement>,
  flow: 'start' | 'center' | 'end' | 'space-between' = 'start'
) => ({ id, flow, placement: { mobile, tablet, desktop } })
const contentElement = (): LayoutElement => ({ id: 'page-content', type: 'page-content', region: 'content', order: 0, props: {} })
const logoElement = (): LayoutElement => ({ id: 'site-logo', type: 'site-logo', region: 'header', order: 0, props: { size: 'medium', link: 'home' } })
const titleElement = (): LayoutElement => ({ id: 'site-title', type: 'site-title', region: 'header', order: 1, props: { emphasis: 'strong', link: 'home' } })
const menuElement = (regionId: LayoutRegionKey, order: number, orientation: 'horizontal' | 'vertical'): LayoutElement => ({
  id: `menu-${regionId}`,
  type: 'menu',
  region: regionId,
  order,
  props: { menuSetId: GLOBAL_SITE_MENU_ID, orientation }
})
const copyrightElement = (): LayoutElement => ({ id: 'copyright', type: 'copyright', region: 'footer', order: 0, props: { format: 'year-site' } })

const commonGrid = { maxWidth: 'wide' as const, gap: 'comfortable' as const, columns: { mobile: 4 as const, tablet: 8 as const, desktop: 12 as const } }

const blankDocument: LayoutPresetTemplate = {
  version: LAYOUT_DOCUMENT_VERSION,
  grid: {
    ...commonGrid,
    maxWidth: 'content',
    regions: [region('content', placement(1, 1, 4), placement(1, 1, 8), placement(1, 1, 12))]
  },
  elements: [contentElement()]
}

function headerFooterTemplate(flow: 'start' | 'space-between' | 'center'): LayoutPresetTemplate {
  return {
    version: LAYOUT_DOCUMENT_VERSION,
    grid: {
      ...commonGrid,
      regions: [
        region('header', placement(1, 1, 4), placement(1, 1, 8), placement(1, 1, 12), flow),
        region('content', placement(2, 1, 4), placement(2, 1, 8), placement(2, 1, 12)),
        region('footer', placement(3, 1, 4), placement(3, 1, 8), placement(3, 1, 12), flow)
      ]
    },
    elements: [logoElement(), titleElement(), menuElement('header', 2, 'horizontal'), contentElement(), copyrightElement()]
  }
}

function rightSidebarTemplate(flow: 'start' | 'space-between'): LayoutPresetTemplate {
  return {
    version: LAYOUT_DOCUMENT_VERSION,
    grid: {
      ...commonGrid,
      regions: [
        region('header', placement(1, 1, 4), placement(1, 1, 8), placement(1, 1, 12), flow),
        region('content', placement(2, 1, 4), placement(2, 1, 5), placement(2, 1, 8)),
        region('right-sidebar', placement(3, 1, 4), placement(2, 6, 3), placement(2, 9, 4))
      ]
    },
    elements: [
      logoElement(),
      titleElement(),
      menuElement('header', 2, 'horizontal'),
      contentElement(),
      { id: 'table-of-contents', type: 'table-of-contents', region: 'right-sidebar', order: 0, props: { maxDepth: 3, marker: 'none' } }
    ]
  }
}

function sidebarsTemplate(flow: 'start' | 'space-between'): LayoutPresetTemplate {
  return {
    version: LAYOUT_DOCUMENT_VERSION,
    grid: {
      ...commonGrid,
      regions: [
        region('header', placement(1, 1, 4), placement(1, 1, 8), placement(1, 1, 12), flow),
        region('left-sidebar', placement(2, 1, 4), placement(2, 1, 2), placement(2, 1, 2)),
        region('content', placement(3, 1, 4), placement(2, 3, 4), placement(2, 3, 8)),
        region('right-sidebar', placement(4, 1, 4), placement(2, 7, 2), placement(2, 11, 2))
      ]
    },
    elements: [
      logoElement(),
      titleElement(),
      menuElement('header', 2, 'horizontal'),
      { id: 'page-list', type: 'page-list', region: 'left-sidebar', order: 0, props: { scope: 'all-pages', sort: 'title-ascending', limit: 12 } },
      contentElement(),
      { id: 'table-of-contents', type: 'table-of-contents', region: 'right-sidebar', order: 0, props: { maxDepth: 3, marker: 'none' } }
    ]
  }
}

const gridDocument: LayoutPresetTemplate = {
  version: LAYOUT_DOCUMENT_VERSION,
  grid: {
    ...commonGrid,
    gap: 'spacious',
    maxWidth: 'full',
    regions: [
      region('header', placement(1, 1, 4), placement(1, 1, 8), placement(1, 1, 12), 'space-between'),
      region('left-sidebar', placement(2, 1, 4), placement(2, 1, 2), placement(2, 1, 2)),
      region('content', placement(3, 1, 4), placement(2, 3, 4), placement(2, 3, 8)),
      region('right-sidebar', placement(4, 1, 4), placement(2, 7, 2), placement(2, 11, 2)),
      region('footer', placement(5, 1, 4), placement(3, 1, 8), placement(3, 1, 12), 'space-between')
    ]
  },
  elements: [
    logoElement(),
    titleElement(),
    menuElement('header', 2, 'horizontal'),
    { id: 'page-list', type: 'page-list', region: 'left-sidebar', order: 0, props: { scope: 'all-pages', sort: 'title-ascending', limit: 12 } },
    contentElement(),
    { id: 'table-of-contents', type: 'table-of-contents', region: 'right-sidebar', order: 0, props: { maxDepth: 3, marker: 'none' } },
    copyrightElement()
  ]
}

function preset(definition: LayoutPresetDefinition): DeepReadonly<LayoutPresetDefinition> {
  const parsed = layoutDocumentSchema.safeParse({ ...definition.document, layoutId: 'preset-validation', name: definition.label })
  if (!parsed.success) throw new Error(`Invalid Layout preset ${definition.key}: ${parsed.error.message}`)
  return deepFreeze({ ...definition, document: structuredClone(definition.document) })
}

export const layoutPresetDefinitions: readonly DeepReadonly<LayoutPresetDefinition>[] = deepFreeze([
  preset({ key: 'blank', label: 'Blank', summary: 'Page content without Site chrome.', document: blankDocument }),
  preset({ key: 'grid', label: 'Grid', summary: 'A complete responsive header, sidebars, content, and footer grid.', document: gridDocument }),
  preset({ key: 'header-footer', label: 'Header and footer', summary: 'A simple Site shell with navigation and copyright.', document: headerFooterTemplate('start') }),
  preset({ key: 'header-footer-justified', label: 'Justified header and footer', summary: 'A balanced shell that distributes Site identity and navigation.', document: headerFooterTemplate('space-between') }),
  preset({ key: 'header-right-sidebar', label: 'Header and right sidebar', summary: 'Content with a right-side table of contents.', document: rightSidebarTemplate('start') }),
  preset({ key: 'header-right-sidebar-justified', label: 'Justified header and right sidebar', summary: 'A distributed header above content and a right-side outline.', document: rightSidebarTemplate('space-between') }),
  preset({ key: 'header-left-right-sidebars', label: 'Header and two sidebars', summary: 'Page navigation, content, and outline in a three-column shell.', document: sidebarsTemplate('start') }),
  preset({ key: 'header-left-right-sidebars-justified', label: 'Justified header and two sidebars', summary: 'A distributed header above the complete three-column shell.', document: sidebarsTemplate('space-between') })
])

export const layoutPresetRegistry = deepFreeze({
  presets: layoutPresetDefinitions,
  byKey: Object.fromEntries(layoutPresetDefinitions.map(item => [item.key, item])) as Record<LayoutPresetKey, DeepReadonly<LayoutPresetDefinition>>
})

export type LayoutPresetMetadata = Pick<LayoutPresetDefinition, 'key' | 'label' | 'summary'>

export function layoutPresetMetadata(): LayoutPresetMetadata[] {
  return layoutPresetDefinitions.map(({ key, label, summary }) => ({ key, label, summary }))
}

export function createLayoutDocumentFromPreset(
  presetKey: LayoutPresetKey,
  layoutId: string,
  name: string,
  elementId: (templateId: string) => string = templateId => templateId
): LayoutDocument {
  const template = structuredClone(layoutPresetRegistry.byKey[presetKey].document)
  const candidate = {
    ...template,
    layoutId,
    name,
    elements: template.elements.map(element => ({ ...element, id: elementId(element.id) }))
  }
  const parsed = parseLayoutDocument(candidate)
  if (!parsed.success) throw new Error(parsed.issues[0]?.message || 'Invalid Layout preset document')
  return parsed.document
}

export class LayoutMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutMutationError'
  }
}

function normalizedElementOrders(elements: LayoutElement[]) {
  const next = structuredClone(elements)
  for (const regionId of layoutRegionKeys) {
    next.filter(element => element.region === regionId)
      .sort((a, b) => a.order - b.order)
      .forEach((element, index) => { element.order = index })
  }
  return next
}

function validatedMutation(document: LayoutDocument, elements: LayoutElement[]) {
  const candidate = { ...structuredClone(document), elements: normalizedElementOrders(elements) }
  const parsed = parseLayoutDocument(candidate)
  if (!parsed.success) throw new LayoutMutationError(parsed.issues[0]?.message || 'Invalid Layout mutation')
  return parsed.document
}

export function insertLayoutElement(document: LayoutDocument, element: LayoutElement, targetIndex?: number) {
  if (document.elements.some(candidate => candidate.id === element.id)) throw new LayoutMutationError('Layout element ID already exists')
  const sourceElements = structuredClone(document.elements)
  const regionElements = sourceElements.filter(candidate => candidate.region === element.region).sort((a, b) => a.order - b.order)
  const insertAt = Math.max(0, Math.min(targetIndex ?? regionElements.length, regionElements.length))
  regionElements.splice(insertAt, 0, structuredClone(element))
  regionElements.forEach((candidate, index) => {
    candidate.order = index
  })
  const otherElements = sourceElements.filter(candidate => candidate.region !== element.region)
  return validatedMutation(document, [...otherElements, ...regionElements])
}

export function moveLayoutElement(document: LayoutDocument, elementId: string, targetRegion: LayoutRegionKey, targetIndex: number) {
  const element = document.elements.find(candidate => candidate.id === elementId)
  if (!element) throw new LayoutMutationError('Layout element not found')
  const remaining = structuredClone(document.elements).filter(candidate => candidate.id !== elementId)
  const target = remaining.filter(candidate => candidate.region === targetRegion).sort((a, b) => a.order - b.order)
  const insertAt = Math.max(0, Math.min(targetIndex, target.length))
  target.splice(insertAt, 0, { ...structuredClone(element), region: targetRegion })
  target.forEach((candidate, index) => {
    candidate.order = index
  })
  return validatedMutation(document, [...remaining.filter(candidate => candidate.region !== targetRegion), ...target])
}

export function reorderLayoutElement(document: LayoutDocument, elementId: string, targetIndex: number) {
  const element = document.elements.find(candidate => candidate.id === elementId)
  if (!element) throw new LayoutMutationError('Layout element not found')
  return moveLayoutElement(document, elementId, element.region, targetIndex)
}

export function duplicateLayoutElement(document: LayoutDocument, elementId: string, duplicateId: string) {
  const element = document.elements.find(candidate => candidate.id === elementId)
  if (!element) throw new LayoutMutationError('Layout element not found')
  if (layoutElementRegistry[element.type].deletion === 'required') throw new LayoutMutationError('The Page content element cannot be duplicated')
  if (document.elements.some(candidate => candidate.id === duplicateId)) throw new LayoutMutationError('Layout element ID already exists')
  const sourceIndex = document.elements.filter(candidate => candidate.region === element.region)
    .sort((left, right) => left.order - right.order)
    .findIndex(candidate => candidate.id === elementId)
  return insertLayoutElement(document, { ...structuredClone(element), id: duplicateId }, sourceIndex + 1)
}

export function deleteLayoutElement(document: LayoutDocument, elementId: string) {
  const element = document.elements.find(candidate => candidate.id === elementId)
  if (!element) throw new LayoutMutationError('Layout element not found')
  if (layoutElementRegistry[element.type].deletion === 'required') throw new LayoutMutationError('The Page content element cannot be deleted')
  return validatedMutation(document, document.elements.filter(candidate => candidate.id !== elementId))
}

export function layoutMenuReferences(document: LayoutDocument) {
  return document.elements.flatMap((element) => {
    const reference = layoutElementRegistry[element.type].reference
    if (element.type !== 'menu' || reference.kind !== 'menu-set') return []
    return [{ elementId: element.id, menuSetId: element.props[reference.prop], region: element.region }]
  })
}

export const layoutCreateSchema = z.object({
  name: layoutNameSchema,
  presetKey: z.enum(layoutPresetKeys)
}).strict()

export const layoutUpdateSchema = z.object({
  revision: z.number().int().min(1),
  document: z.unknown()
}).strict()

export const layoutRenameSchema = z.object({
  revision: z.number().int().min(1),
  name: layoutNameSchema
}).strict()

export const layoutDuplicateSchema = z.object({
  name: layoutNameSchema
}).strict()

export const layoutDeleteSchema = z.object({
  revision: z.number().int().min(1)
}).strict()

export type LayoutUsage = {
  resourceType: 'site' | 'schema' | 'page' | 'unknown'
  resourceId: string
  label: string
  behavior: 'use-current' | 'missing-fallback' | 'unknown'
}

export type LayoutRevision = {
  id: string
  revision: number
  document: LayoutDocument
  createdBy: string | null
  createdAt: string
}

export type LayoutResource = {
  id: string
  name: string
  revision: number
  status: 'ready'
  document: LayoutDocument
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  usage: LayoutUsage[]
  canDelete: boolean
}

export type LayoutRepairResource = Omit<LayoutResource, 'status' | 'document'> & {
  status: 'repair-required'
  document: null
  repair: {
    revision: number
    issues: LayoutValidationIssue[]
  }
}

export type LayoutAdminResource = LayoutResource | LayoutRepairResource

export type LayoutListResponse = {
  presets: LayoutPresetMetadata[]
  elementDescriptors: LayoutElementDescriptor[]
  items: LayoutAdminResource[]
}

export type ResolvedLayoutProjection =
  | {
      status: 'ready'
      version: typeof LAYOUT_DOCUMENT_VERSION
      layoutId: string
      name: string
      revision: number
      document: LayoutDocument
    }
    | {
      status: 'missing' | 'retired' | 'repair-required'
      layoutId: string
      reason: string
    }

export const resolvedLayoutProjectionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    version: z.literal(LAYOUT_DOCUMENT_VERSION),
    layoutId: layoutIdSchema,
    name: layoutNameSchema,
    revision: z.number().int().min(1),
    document: layoutDocumentSchema
  }).strict(),
  z.object({ status: z.literal('missing'), layoutId: layoutIdSchema, reason: z.string().min(1).max(500) }).strict(),
  z.object({ status: z.literal('retired'), layoutId: layoutIdSchema, reason: z.string().min(1).max(500) }).strict(),
  z.object({ status: z.literal('repair-required'), layoutId: layoutIdSchema, reason: z.string().min(1).max(500) }).strict()
])
