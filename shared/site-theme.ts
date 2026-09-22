import { z } from 'zod'

import type { SitePresentation } from './site-presentation'

export const SITE_THEME_CONTRACT_VERSION = 1 as const
// This digest pins the source-controlled v1 default artifact. Keep the v1
// compiler/default bytes reconstructable forever; compatible changes publish a
// new contract/compiler rather than silently changing this external URL.
export const SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION = 'e9e707a11106ed2a26bf472ff9e363226f1be08e889e70205f6ae540afdbcb68'
export const SITE_THEME_FONT_FAMILIES = [
  'public-sans',
  'system-sans',
  'humanist-sans',
  'system-serif',
  'system-mono'
] as const

export const SITE_THEME_FONT_OPTIONS = [
  { label: 'Public Sans', value: 'public-sans' },
  { label: 'System sans', value: 'system-sans' },
  { label: 'Humanist sans', value: 'humanist-sans' },
  { label: 'System serif', value: 'system-serif' },
  { label: 'System monospace', value: 'system-mono' }
] as const

const fontStacks: Record<typeof SITE_THEME_FONT_FAMILIES[number], string> = {
  'public-sans': '"Public Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'system-sans': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'humanist-sans': 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif',
  'system-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  'system-mono': 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'
}

const hexColorSchema = z.string().regex(
  /^#[0-9a-f]{6}$/i,
  'Use a six-digit hexadecimal color such as #9333ea'
).transform(value => value.toLowerCase())

export const siteThemeSemanticColorsSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  neutral: hexColorSchema,
  background: hexColorSchema,
  text: hexColorSchema,
  success: hexColorSchema,
  info: hexColorSchema,
  warning: hexColorSchema,
  error: hexColorSchema
}).strict()

const radiusValueSchema = z.number().finite().min(0).max(2).multipleOf(0.0625)
const spacingValueSchema = z.number().finite().min(0.25).max(4).multipleOf(0.0625)

export const siteThemeSchema = z.object({
  version: z.literal(SITE_THEME_CONTRACT_VERSION),
  colorMode: z.enum(['system', 'light', 'dark']),
  colors: z.object({
    light: siteThemeSemanticColorsSchema,
    dark: siteThemeSemanticColorsSchema
  }).strict(),
  radii: z.object({
    control: radiusValueSchema,
    sm: radiusValueSchema,
    md: radiusValueSchema,
    lg: radiusValueSchema
  }).strict(),
  typography: z.object({
    bodyFontFamily: z.enum(SITE_THEME_FONT_FAMILIES),
    headingFontFamily: z.enum(SITE_THEME_FONT_FAMILIES),
    fontSizeBase: z.number().finite().min(0.875).max(1.25).multipleOf(0.0625),
    lineHeightBody: z.number().finite().min(1.2).max(2).multipleOf(0.05),
    lineHeightHeading: z.number().finite().min(1).max(1.6).multipleOf(0.05)
  }).strict(),
  spacing: z.object({
    block: spacingValueSchema,
    inline: spacingValueSchema
  }).strict(),
  content: z.object({
    maxWidth: z.number().finite().min(32).max(120).multipleOf(1),
    textWidth: z.number().finite().min(24).max(80).multipleOf(1)
  }).strict()
}).strict().superRefine((value, context) => {
  const { control, sm, md, lg } = value.radii
  if (!(control <= sm && sm <= md && md <= lg)) {
    context.addIssue({
      code: 'custom',
      path: ['radii', control > sm ? 'sm' : sm > md ? 'md' : 'lg'],
      message: 'Radius values must be ordered from control through large'
    })
  }
  if (value.content.textWidth > value.content.maxWidth) {
    context.addIssue({
      code: 'custom',
      path: ['content', 'textWidth'],
      message: 'Text width cannot exceed the content width'
    })
  }
})

export type SiteTheme = z.output<typeof siteThemeSchema>
export type SiteThemeColorMode = keyof SiteTheme['colors']

export type PublicSiteThemeManifest = {
  contractVersion: typeof SITE_THEME_CONTRACT_VERSION
  siteModeEnabled: boolean
  revision: string
  stylesheetRevision: string
  stylesheetUrl: string
  colorMode: SiteTheme['colorMode']
}

export function normalizePublicSiteThemeManifest(value: unknown): PublicSiteThemeManifest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PublicSiteThemeManifest>
  if (candidate.contractVersion !== SITE_THEME_CONTRACT_VERSION
    || typeof candidate.siteModeEnabled !== 'boolean'
    || !/^[0-9a-f]{64}$/.test(candidate.revision ?? '')
    || !/^[0-9a-f]{64}$/.test(candidate.stylesheetRevision ?? '')
    || !['system', 'light', 'dark'].includes(candidate.colorMode ?? '')) return null
  try {
    const url = new URL(String(candidate.stylesheetUrl ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== `/_halo/theme/v1/${candidate.stylesheetRevision}.css`) return null
    return {
      contractVersion: SITE_THEME_CONTRACT_VERSION,
      siteModeEnabled: candidate.siteModeEnabled,
      revision: candidate.revision!,
      stylesheetRevision: candidate.stylesheetRevision!,
      stylesheetUrl: url.href,
      colorMode: candidate.colorMode!
    }
  } catch {
    return null
  }
}

// Halo-owned literal sRGB equivalents of the source-controlled palettes used
// by the legacy Nuxt UI shell. Keeping these values here makes bootstrap
// adaptation deterministic without importing Tailwind into the Theme contract.
const legacyPrimaryColors: Record<SitePresentation['appearance']['primaryColor'], { light: string, dark: string }> = {
  blue: { light: '#2b7fff', dark: '#51a2ff' },
  emerald: { light: '#00bc7d', dark: '#00d492' },
  indigo: { light: '#615fff', dark: '#7c86ff' },
  orange: { light: '#ff6900', dark: '#ff8904' },
  purple: { light: '#ad46ff', dark: '#c27aff' },
  rose: { light: '#ff2056', dark: '#ff637e' },
  teal: { light: '#00bba7', dark: '#00d5be' }
}

type LegacyNeutralShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950'
type LegacyNeutralPalette = Record<LegacyNeutralShade, string>

const legacyNeutralPalettes: Record<SitePresentation['appearance']['neutralColor'], LegacyNeutralPalette> = {
  gray: {
    50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5dc', 400: '#99a1af',
    500: '#6a7282', 600: '#4a5565', 700: '#364153', 800: '#1e2939', 900: '#101828', 950: '#030712'
  },
  neutral: {
    50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a1a1a1',
    500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717', 950: '#0a0a0a'
  },
  slate: {
    50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cad5e2', 400: '#90a1b9',
    500: '#62748e', 600: '#45556c', 700: '#314158', 800: '#1d293d', 900: '#0f172b', 950: '#020618'
  },
  stone: {
    50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a6a09b',
    500: '#79716b', 600: '#57534d', 700: '#44403b', 800: '#292524', 900: '#1c1917', 950: '#0c0a09'
  },
  zinc: {
    50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#9f9fa9',
    500: '#71717b', 600: '#52525c', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b'
  }
}

const legacyRadiusScales: Record<SitePresentation['appearance']['radius'], SiteTheme['radii']> = {
  none: { control: 0, sm: 0, md: 0, lg: 0 },
  sm: { control: 0.125, sm: 0.125, md: 0.1875, lg: 0.25 },
  md: { control: 0.25, sm: 0.25, md: 0.375, lg: 0.5 },
  lg: { control: 0.5, sm: 0.5, md: 0.75, lg: 1 }
}

const legacyBodyLineHeights: Record<SitePresentation['appearance']['typographyScale'], number> = {
  compact: 1.45,
  default: 1.6,
  relaxed: 1.75
}

export function defaultSiteTheme(): SiteTheme {
  return {
    version: SITE_THEME_CONTRACT_VERSION,
    colorMode: 'system',
    colors: {
      light: {
        primary: '#ad46ff',
        secondary: '#2b7fff',
        neutral: '#71717b',
        background: '#ffffff',
        text: '#3f3f46',
        success: '#00c16a',
        info: '#2b7fff',
        warning: '#f0b100',
        error: '#fb2c36'
      },
      dark: {
        primary: '#c27aff',
        secondary: '#51a2ff',
        neutral: '#9f9fa9',
        background: '#18181b',
        text: '#e4e4e7',
        success: '#00dc82',
        info: '#51a2ff',
        warning: '#fdc700',
        error: '#ff6467'
      }
    },
    radii: {
      control: 0.25,
      sm: 0.25,
      md: 0.375,
      lg: 0.5
    },
    typography: {
      bodyFontFamily: 'public-sans',
      headingFontFamily: 'public-sans',
      fontSizeBase: 1,
      lineHeightBody: 1.6,
      lineHeightHeading: 1.15
    },
    spacing: {
      block: 1.25,
      inline: 0.75
    },
    content: {
      maxWidth: 72,
      textWidth: 48
    }
  }
}

export function adaptLegacyAppearanceToSiteTheme(
  appearance: SitePresentation['appearance']
): SiteTheme {
  const theme = defaultSiteTheme()
  theme.colorMode = appearance.colorMode
  const primary = legacyPrimaryColors[appearance.primaryColor]
  const neutral = legacyNeutralPalettes[appearance.neutralColor]
  theme.colors.light.primary = primary.light
  theme.colors.dark.primary = primary.dark
  theme.colors.light.neutral = neutral[500]
  theme.colors.light.text = neutral[700]
  theme.colors.dark.neutral = neutral[400]
  theme.colors.dark.background = neutral[900]
  theme.colors.dark.text = neutral[200]
  theme.radii = { ...legacyRadiusScales[appearance.radius] }
  theme.typography.lineHeightBody = legacyBodyLineHeights[appearance.typographyScale]
  return theme
}

function parseHex(value: string) {
  return [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number]
}

function toHex(value: number) {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
}

function mixHex(first: string, second: string, firstWeight: number) {
  const a = parseHex(first)
  const b = parseHex(second)
  return `#${a.map((channel, index) => toHex(channel * firstWeight + b[index]! * (1 - firstWeight))).join('')}`
}

function legacyNeutralPaletteForMode(colors: SiteTheme['colors'][SiteThemeColorMode], mode: SiteThemeColorMode) {
  return Object.values(legacyNeutralPalettes).find((palette) => {
    if (mode === 'light') {
      return colors.neutral === palette[500]
        && colors.background === '#ffffff'
        && colors.text === palette[700]
    }
    return colors.neutral === palette[400]
      && colors.background === palette[900]
      && colors.text === palette[200]
  })
}

function canonicalSurfaceRoles(colors: SiteTheme['colors'][SiteThemeColorMode], mode: SiteThemeColorMode) {
  const palette = legacyNeutralPaletteForMode(colors, mode)
  if (palette && mode === 'light') {
    return {
      textDimmed: palette[400],
      textMuted: palette[500],
      textToned: palette[600],
      textHighlighted: palette[900],
      textInverted: '#ffffff',
      backgroundMuted: palette[50],
      backgroundElevated: palette[100],
      backgroundAccented: palette[200],
      backgroundInverted: palette[900],
      border: palette[200],
      borderMuted: palette[200],
      borderAccented: palette[300],
      borderInverted: palette[900]
    }
  }
  if (palette) {
    return {
      textDimmed: palette[500],
      textMuted: palette[400],
      textToned: palette[300],
      textHighlighted: '#ffffff',
      textInverted: palette[900],
      backgroundMuted: palette[800],
      backgroundElevated: palette[800],
      backgroundAccented: palette[700],
      backgroundInverted: '#ffffff',
      border: palette[800],
      borderMuted: palette[700],
      borderAccented: palette[700],
      borderInverted: '#ffffff'
    }
  }
  return {
    textDimmed: mixHex(colors.text, colors.background, 0.55),
    textMuted: mixHex(colors.text, colors.background, 0.72),
    textToned: mixHex(colors.text, colors.background, 0.84),
    textHighlighted: colors.text,
    textInverted: colors.background,
    backgroundMuted: mixHex(colors.background, colors.text, 0.96),
    backgroundElevated: mixHex(colors.background, colors.text, 0.985),
    backgroundAccented: mixHex(colors.background, colors.text, 0.88),
    backgroundInverted: colors.text,
    border: mixHex(colors.text, colors.background, 0.2),
    borderMuted: mixHex(colors.text, colors.background, 0.2),
    borderAccented: mixHex(colors.text, colors.background, 0.3),
    borderInverted: colors.text
  }
}

function luminance(value: string) {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

export function siteThemeContrastRatio(first: string, second: string) {
  const firstLuminance = luminance(first)
  const secondLuminance = luminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastText(background: string) {
  return siteThemeContrastRatio(background, '#ffffff') >= siteThemeContrastRatio(background, '#18181b')
    ? '#ffffff'
    : '#18181b'
}

export function siteThemeAccessibilityWarnings(theme: SiteTheme) {
  const warnings: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const colors = theme.colors[mode]
    if (siteThemeContrastRatio(colors.text, colors.background) < 4.5) {
      warnings.push(`${mode} text and background are below the WCAG AA 4.5:1 contrast target.`)
    }
    for (const role of ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'error'] as const) {
      if (siteThemeContrastRatio(colors[role], colors.background) < 4.5) {
        warnings.push(`${mode} ${role} text is below the WCAG AA 4.5:1 contrast target against the background.`)
      }
      const onRole = contrastText(colors[role])
      if (siteThemeContrastRatio(onRole, colors[role]) < 4.5) {
        warnings.push(`${mode} ${role} and its derived foreground are below the WCAG AA 4.5:1 contrast target.`)
      }
    }
    if (siteThemeContrastRatio(colors.neutral, colors.background) < 1.5) {
      warnings.push(`${mode} neutral has weak separation from the background.`)
    }
  }
  if (siteThemeContrastRatio(theme.colors.light.background, theme.colors.dark.background) < 1.5) {
    warnings.push('Light and dark backgrounds are visually very similar.')
  }
  if (theme.typography.fontSizeBase < 1 || theme.typography.lineHeightBody < 1.5) {
    warnings.push('Small base type or tight body line height may reduce readability.')
  }
  return warnings
}

function canonicalColorDeclarations(theme: SiteTheme, mode: SiteThemeColorMode, suffix = '') {
  const colors = theme.colors[mode]
  const roles = canonicalSurfaceRoles(colors, mode)
  const codeBackground = mode === 'dark' ? '#000000' : '#18181b'
  const codeText = mode === 'dark' ? '#fafafa' : '#f4f4f5'
  const shadow = mode === 'dark'
    ? '0 18px 45px rgb(0 0 0 / 0.35)'
    : '0 16px 40px rgb(24 24 27 / 0.1)'
  return [
    `  --halo-color-primary${suffix}: ${colors.primary};`,
    `  --halo-color-on-primary${suffix}: ${contrastText(colors.primary)};`,
    `  --halo-color-secondary${suffix}: ${colors.secondary};`,
    `  --halo-color-on-secondary${suffix}: ${contrastText(colors.secondary)};`,
    `  --halo-color-neutral${suffix}: ${colors.neutral};`,
    `  --halo-color-on-neutral${suffix}: ${contrastText(colors.neutral)};`,
    `  --halo-color-background${suffix}: ${colors.background};`,
    `  --halo-color-background-muted${suffix}: ${roles.backgroundMuted};`,
    `  --halo-color-background-elevated${suffix}: ${roles.backgroundElevated};`,
    `  --halo-color-background-accented${suffix}: ${roles.backgroundAccented};`,
    `  --halo-color-background-inverted${suffix}: ${roles.backgroundInverted};`,
    `  --halo-color-surface${suffix}: ${roles.backgroundMuted};`,
    `  --halo-color-surface-raised${suffix}: ${roles.backgroundElevated};`,
    `  --halo-color-text${suffix}: ${colors.text};`,
    `  --halo-color-text-dimmed${suffix}: ${roles.textDimmed};`,
    `  --halo-color-text-muted${suffix}: ${roles.textMuted};`,
    `  --halo-color-text-toned${suffix}: ${roles.textToned};`,
    `  --halo-color-text-highlighted${suffix}: ${roles.textHighlighted};`,
    `  --halo-color-text-inverted${suffix}: ${roles.textInverted};`,
    `  --halo-color-border${suffix}: ${roles.border};`,
    `  --halo-color-border-muted${suffix}: ${roles.borderMuted};`,
    `  --halo-color-border-accented${suffix}: ${roles.borderAccented};`,
    `  --halo-color-border-inverted${suffix}: ${roles.borderInverted};`,
    `  --halo-color-success${suffix}: ${colors.success};`,
    `  --halo-color-on-success${suffix}: ${contrastText(colors.success)};`,
    `  --halo-color-info${suffix}: ${colors.info};`,
    `  --halo-color-on-info${suffix}: ${contrastText(colors.info)};`,
    `  --halo-color-warning${suffix}: ${colors.warning};`,
    `  --halo-color-on-warning${suffix}: ${contrastText(colors.warning)};`,
    `  --halo-color-error${suffix}: ${colors.error};`,
    `  --halo-color-on-error${suffix}: ${contrastText(colors.error)};`,
    `  --halo-color-focus${suffix}: ${colors.primary};`,
    `  --halo-color-code-background${suffix}: ${codeBackground};`,
    `  --halo-color-code-text${suffix}: ${codeText};`,
    `  --halo-elevation-shadow${suffix}: ${shadow};`
  ]
}

function canonicalMetricDeclarations(theme: SiteTheme) {
  const cssNumber = (value: number) => Number(value.toFixed(4)).toString()
  return [
    `  --halo-font-family-body: ${fontStacks[theme.typography.bodyFontFamily]};`,
    `  --halo-font-family-heading: ${fontStacks[theme.typography.headingFontFamily]};`,
    `  --halo-font-size-base: ${cssNumber(theme.typography.fontSizeBase)}rem;`,
    `  --halo-line-height-body: ${cssNumber(theme.typography.lineHeightBody)};`,
    `  --halo-line-height-heading: ${cssNumber(theme.typography.lineHeightHeading)};`,
    `  --halo-radius-control: ${cssNumber(theme.radii.control)}rem;`,
    `  --halo-radius-sm: ${cssNumber(theme.radii.sm)}rem;`,
    `  --halo-radius-md: ${cssNumber(theme.radii.md)}rem;`,
    `  --halo-radius-lg: ${cssNumber(theme.radii.lg)}rem;`,
    `  --halo-space-block: ${cssNumber(theme.spacing.block)}rem;`,
    `  --halo-space-inline: ${cssNumber(theme.spacing.inline)}rem;`,
    `  --halo-content-width: ${cssNumber(theme.content.maxWidth)}rem;`,
    `  --halo-text-width: ${cssNumber(theme.content.textWidth)}rem;`
  ]
}

function portableCompatibilityDeclarations() {
  return [
    '  --halo-background: var(--halo-color-background);',
    '  --halo-surface: var(--halo-color-surface);',
    '  --halo-surface-raised: var(--halo-color-surface-raised);',
    '  --halo-text: var(--halo-color-text);',
    '  --halo-text-muted: var(--halo-color-text-muted);',
    '  --halo-border: var(--halo-color-border);',
    '  --halo-primary: var(--halo-color-primary);',
    '  --halo-primary-contrast: var(--halo-color-on-primary);',
    '  --halo-secondary: var(--halo-color-secondary);',
    '  --halo-secondary-contrast: var(--halo-color-on-secondary);',
    '  --halo-success: var(--halo-color-success);',
    '  --halo-success-contrast: var(--halo-color-on-success);',
    '  --halo-info: var(--halo-color-info);',
    '  --halo-info-contrast: var(--halo-color-on-info);',
    '  --halo-warning: var(--halo-color-warning);',
    '  --halo-warning-contrast: var(--halo-color-on-warning);',
    '  --halo-error: var(--halo-color-error);',
    '  --halo-error-contrast: var(--halo-color-on-error);',
    '  --halo-neutral: var(--halo-color-neutral);',
    '  --halo-neutral-contrast: var(--halo-color-on-neutral);',
    '  --halo-focus: var(--halo-color-focus);',
    '  --halo-code-background: var(--halo-color-code-background);',
    '  --halo-code-text: var(--halo-color-code-text);',
    '  --halo-shadow: var(--halo-elevation-shadow);',
    '  --halo-radius-small: var(--halo-radius-sm);',
    '  --halo-radius: var(--halo-radius-md);',
    '  --halo-radius-large: var(--halo-radius-lg);',
    '  color: var(--halo-color-text);',
    '  background: var(--halo-color-background);',
    '  font-family: var(--halo-font-family-body);',
    '  font-size: var(--halo-font-size-base);',
    '  line-height: var(--halo-line-height-body);'
  ]
}

function modeBlock(theme: SiteTheme, mode: SiteThemeColorMode, selector: string) {
  return `${selector} {\n${[
    ...canonicalColorDeclarations(theme, mode),
    ...canonicalMetricDeclarations(theme),
    ...portableCompatibilityDeclarations(),
    `  color-scheme: ${mode};`
  ].join('\n')}\n}`
}

export function compileSiteThemeCss(theme: SiteTheme) {
  const parsed = siteThemeSchema.parse(theme)
  const rootLight = `:root {\n${[
    ...canonicalColorDeclarations(parsed, 'light'),
    ...canonicalColorDeclarations(parsed, 'light', '-light'),
    ...canonicalColorDeclarations(parsed, 'dark', '-dark'),
    ...canonicalMetricDeclarations(parsed)
  ].join('\n')}\n}`
  const lightContent = modeBlock(
    parsed,
    'light',
    '.halo-content,\n.halo-content[data-halo-color-mode="default"],\n.halo-content[data-halo-color-mode="light"]'
  )
  const darkContent = modeBlock(parsed, 'dark', '.halo-content[data-halo-color-mode="dark"]')
  const systemDarkContent = `@media (prefers-color-scheme: dark) {\n${modeBlock(
    parsed,
    'dark',
    '  .halo-content[data-halo-color-mode="default"]'
  )}\n}`
  const portableProperties = `.halo-content :where(h1, h2, h3, h4) {\n  font-family: var(--halo-font-family-heading);\n  line-height: var(--halo-line-height-heading);\n}\n\n.halo-content > * + * {\n  margin-block-start: var(--halo-space-block);\n}\n\n.halo-content > h1 + *,\n.halo-content > h2 + *,\n.halo-content > h3 + *,\n.halo-content > h4 + * {\n  margin-block-start: var(--halo-space-inline);\n}\n\n.halo-content .halo-block-header,\n.halo-content .halo-actions,\n.halo-content .halo-logo-list {\n  gap: var(--halo-space-inline);\n}`
  return `/* HaloPress Theme contract v1. Generated only from validated tokens. */\n${rootLight}\n\n${lightContent}\n\n${darkContent}\n\n${systemDarkContent}\n\n${portableProperties}\n`
}
