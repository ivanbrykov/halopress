import { z } from 'zod'

import type {
  PublicSiteMenuDocument,
  ResolvedSiteMenuLeaf,
  SiteMenuItem
} from './site-menu'

export const SITE_PRIMARY_COLORS = ['blue', 'emerald', 'indigo', 'orange', 'purple', 'rose', 'teal'] as const
export const SITE_NEUTRAL_COLORS = ['gray', 'neutral', 'slate', 'stone', 'zinc'] as const
export const SITE_THEME_PRESETS = {
  halo: {
    label: 'HaloPress',
    primaryColor: 'purple',
    neutralColor: 'zinc',
    typographyScale: 'default',
    radius: 'md'
  },
  editorial: {
    label: 'Editorial',
    primaryColor: 'indigo',
    neutralColor: 'slate',
    typographyScale: 'relaxed',
    radius: 'lg'
  },
  minimal: {
    label: 'Minimal',
    primaryColor: 'emerald',
    neutralColor: 'neutral',
    typographyScale: 'compact',
    radius: 'sm'
  }
} as const

const safeIdSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  'Use letters, numbers, dots, colons, underscores, or hyphens'
)

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

const externalUrlSchema = z.string().trim().max(2048).refine(
  isSafeExternalUrl,
  'Use an absolute http or https URL without embedded credentials'
)

export const publicNavigationDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('home') }).strict(),
  z.object({ type: z.literal('page'), pageId: safeIdSchema }).strict(),
  z.object({ type: z.literal('collection'), schemaKey: safeIdSchema }).strict(),
  z.object({ type: z.literal('content'), schemaKey: safeIdSchema, contentId: safeIdSchema }).strict(),
  z.object({ type: z.literal('external'), url: externalUrlSchema, newWindow: z.boolean().default(false) }).strict()
])

export const publicNavigationLeafSchema = z.object({
  id: safeIdSchema,
  label: z.string().trim().min(1).max(80),
  destination: publicNavigationDestinationSchema
}).strict()

export const publicNavigationItemSchema = publicNavigationLeafSchema.extend({
  children: z.array(publicNavigationLeafSchema).max(8).default([])
}).strict()

export const siteGeneralSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(320),
  locale: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, 'Use a locale such as en or ko-KR'),
  logoAssetId: safeIdSchema.nullable(),
  faviconAssetId: safeIdSchema.nullable(),
  socialImageAssetId: safeIdSchema.nullable()
}).strict()

export const siteAppearanceSchema = z.object({
  preset: z.enum(['halo', 'editorial', 'minimal']),
  primaryColor: z.enum(SITE_PRIMARY_COLORS),
  neutralColor: z.enum(SITE_NEUTRAL_COLORS),
  typographyScale: z.enum(['compact', 'default', 'relaxed']),
  radius: z.enum(['none', 'sm', 'md', 'lg']),
  colorMode: z.enum(['system', 'light', 'dark'])
}).strict()

export const siteShellSchema = z.object({
  width: z.enum(['default', 'wide', 'centered']),
  headerVariant: z.enum(['standard', 'centered', 'minimal']),
  showDeskLink: z.boolean(),
  showColorMode: z.boolean()
}).strict()

export const siteNavigationSchema = z.object({
  items: z.array(publicNavigationItemSchema).max(12)
}).strict().superRefine((value, context) => {
  const ids = new Set<string>()
  for (const item of value.items) {
    for (const candidate of [item, ...item.children]) {
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: 'custom',
          message: `Navigation item IDs must be unique: ${candidate.id}`,
          path: ['items']
        })
      }
      ids.add(candidate.id)
    }
  }
})

export const siteFooterSchema = z.object({
  variant: z.enum(['route', 'simple', 'links']),
  copyright: z.string().trim().max(200),
  showRoute: z.boolean(),
  links: z.array(publicNavigationLeafSchema).max(8)
}).strict()

export const sitePresentationSchema = z.object({
  version: z.literal(1),
  general: siteGeneralSchema,
  appearance: siteAppearanceSchema,
  shell: siteShellSchema,
  navigation: siteNavigationSchema,
  footer: siteFooterSchema
}).strict()

export const sitePresentationPatchSchema = z.object({
  general: siteGeneralSchema.optional(),
  appearance: siteAppearanceSchema.optional(),
  shell: siteShellSchema.optional(),
  footer: siteFooterSchema.optional()
}).strict().refine(value => Object.keys(value).length > 0, 'Provide at least one settings section')

export type PublicNavigationDestination = z.output<typeof publicNavigationDestinationSchema>
export type PublicNavigationLeaf = z.output<typeof publicNavigationLeafSchema>
export type PublicNavigationItem = z.output<typeof publicNavigationItemSchema>
export type SitePresentation = z.output<typeof sitePresentationSchema>
export type SitePresentationPatch = z.output<typeof sitePresentationPatchSchema>
export type SiteThemePreset = keyof typeof SITE_THEME_PRESETS

export function siteThemePresetTokens(presetName: SiteThemePreset): Omit<SitePresentation['appearance'], 'colorMode'> {
  const preset = SITE_THEME_PRESETS[presetName]
  return {
    preset: presetName,
    primaryColor: preset.primaryColor,
    neutralColor: preset.neutralColor,
    typographyScale: preset.typographyScale,
    radius: preset.radius
  }
}

export type SitePresentationAdminValue = Omit<SitePresentation, 'navigation'> & {
  navigation: { items: SiteMenuItem[] }
}

// Footer links retain the existing typed destination delivery contract. The
// resolved `to` is additive so current consumers can keep reading destination
// while the public Site shell follows canonical routes without unsafe casts.
export type PublicSiteFooterLink = PublicNavigationLeaf & {
  to: string
}

export type PublicSitePresentation = Omit<SitePresentation, 'general' | 'navigation' | 'footer'> & {
  revision: string
  navigation: PublicSiteMenuDocument
  general: Omit<SitePresentation['general'], 'logoAssetId' | 'faviconAssetId' | 'socialImageAssetId'> & {
    logoUrl: string | null
    faviconUrl: string
    socialImageUrl: string
  }
  footer: Omit<SitePresentation['footer'], 'links'> & {
    links: PublicSiteFooterLink[]
  }
}

export function defaultSitePresentation(): SitePresentation {
  return {
    version: 1,
    general: {
      siteName: 'HaloPress',
      description: 'A batteries-included, schema-driven CMS for structured publishing.',
      locale: 'en',
      logoAssetId: null,
      faviconAssetId: null,
      socialImageAssetId: null
    },
    appearance: {
      preset: 'halo',
      primaryColor: 'purple',
      neutralColor: 'zinc',
      typographyScale: 'default',
      radius: 'md',
      colorMode: 'system'
    },
    shell: {
      width: 'default',
      headerVariant: 'standard',
      showDeskLink: true,
      showColorMode: true
    },
    navigation: { items: [] },
    footer: {
      variant: 'route',
      copyright: '',
      showRoute: true,
      links: []
    }
  }
}

export function resolvePublicNavigationTarget(destination: PublicNavigationDestination) {
  if (destination.type === 'home') return '/'
  if (destination.type === 'page') return `/p/${encodeURIComponent(destination.pageId)}`
  if (destination.type === 'collection') return `/${encodeURIComponent(destination.schemaKey)}/`
  if (destination.type === 'content') {
    return `/${encodeURIComponent(destination.schemaKey)}/${encodeURIComponent(destination.contentId)}`
  }
  return destination.url
}

function resolveLegacyNavigationLeaf(item: PublicNavigationLeaf): ResolvedSiteMenuLeaf {
  const externalWindow = item.destination.type === 'external' && item.destination.newWindow
  return {
    id: item.id,
    label: item.label,
    to: resolvePublicNavigationTarget(item.destination),
    value: item.id,
    target: externalWindow ? '_blank' : undefined,
    rel: externalWindow ? 'noopener noreferrer' : undefined
  }
}

function resolveLegacyFooterLink(item: PublicNavigationLeaf): PublicSiteFooterLink {
  return {
    ...item,
    to: resolvePublicNavigationTarget(item.destination)
  }
}

export function toPublicSitePresentation(
  value: SitePresentation,
  availableAssetIds: ReadonlySet<string>,
  revision: string
): PublicSitePresentation {
  const assetUrl = (assetId: string | null) => assetId && availableAssetIds.has(assetId)
    ? `/assets/${encodeURIComponent(assetId)}/raw`
    : null

  return {
    version: value.version,
    revision,
    general: {
      siteName: value.general.siteName,
      description: value.general.description,
      locale: value.general.locale,
      logoUrl: assetUrl(value.general.logoAssetId),
      faviconUrl: assetUrl(value.general.faviconAssetId) || '/favicon.ico',
      socialImageUrl: assetUrl(value.general.socialImageAssetId) || '/branding/halopress-social-card.png'
    },
    appearance: value.appearance,
    shell: value.shell,
    navigation: {
      version: 1,
      items: value.navigation.items.map(item => ({
        ...resolveLegacyNavigationLeaf(item),
        children: item.children.map(resolveLegacyNavigationLeaf)
      }))
    },
    footer: {
      ...value.footer,
      links: value.footer.links.map(resolveLegacyFooterLink)
    }
  }
}
