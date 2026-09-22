import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'

import {
  SITE_NEUTRAL_COLORS,
  SITE_PRIMARY_COLORS,
  defaultSitePresentation,
  type SitePresentation
} from '../shared/site-presentation'
import {
  SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION,
  adaptLegacyAppearanceToSiteTheme,
  compileSiteThemeCss,
  defaultSiteTheme,
  normalizePublicSiteThemeManifest,
  siteThemeAccessibilityWarnings,
  siteThemeContrastRatio,
  siteThemeSchema,
  type SiteTheme
} from '../shared/site-theme'
import { buildSiteThemeArtifact } from '../server/utils/site-theme-settings'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

describe('HaloPress Theme v1 contract', () => {
  it('normalizes semantic colors and canonical document ordering before revisioning', () => {
    const lower = defaultSiteTheme()
    const upper = structuredClone(lower) as any
    upper.colors.light.primary = '#ABCDEF'
    lower.colors.light.primary = '#abcdef'

    const reordered = {
      content: lower.content,
      spacing: lower.spacing,
      typography: lower.typography,
      radii: lower.radii,
      colors: lower.colors,
      colorMode: lower.colorMode,
      version: lower.version
    }
    const parsedUpper = siteThemeSchema.parse(upper)
    const parsedReordered = siteThemeSchema.parse(reordered)
    expect(parsedUpper.colors.light.primary).toBe('#abcdef')
    expect(buildSiteThemeArtifact(parsedUpper).revision)
      .toBe(buildSiteThemeArtifact(parsedReordered).revision)
    expect(buildSiteThemeArtifact(parsedUpper).stylesheetRevision)
      .toBe(buildSiteThemeArtifact(parsedReordered).stylesheetRevision)
  })

  it('uses a pinned source-controlled default stylesheet with stable numeric serialization', () => {
    const theme = defaultSiteTheme()
    const css = compileSiteThemeCss(theme)
    expect(sha256(css)).toBe(SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION)
    expect(css).toContain('--halo-font-size-base: 1rem;')
    expect(css).toContain('--halo-line-height-body: 1.6;')
    expect(css).toContain('--halo-radius-md: 0.375rem;')
    expect(css).toContain('--halo-font-family-body: "Public Sans", ui-sans-serif')
    expect(css).not.toMatch(/1\.0000|1\.6500|0\.8750/)

    const invalidPrecision = structuredClone(theme) as any
    invalidPrecision.typography.lineHeightBody = 1.60001
    expect(siteThemeSchema.safeParse(invalidPrecision).success).toBe(false)
  })

  it('keeps whole-document revisions separate from exact CSS byte digests', () => {
    const system = buildSiteThemeArtifact(defaultSiteTheme())
    const lightTheme = defaultSiteTheme()
    lightTheme.colorMode = 'light'
    const light = buildSiteThemeArtifact(lightTheme)

    expect(light.revision).not.toBe(system.revision)
    expect(light.stylesheetRevision).toBe(system.stylesheetRevision)
    expect(light.css).toBe(system.css)
  })

  it('rejects raw CSS, URLs, unsupported fonts, malformed colors, invalid metrics, and extra keys', () => {
    const invalidDocuments: any[] = []
    const remoteFont = structuredClone(defaultSiteTheme()) as any
    remoteFont.typography.bodyFontFamily = 'url(https://user:pass@example.com/font.woff2)'
    invalidDocuments.push(remoteFont)
    const cssColor = structuredClone(defaultSiteTheme()) as any
    cssColor.colors.light.primary = 'var(--evil)'
    invalidDocuments.push(cssColor)
    const radiusOrder = structuredClone(defaultSiteTheme()) as any
    radiusOrder.radii.sm = 1.5
    invalidDocuments.push(radiusOrder)
    const nonFinite = structuredClone(defaultSiteTheme()) as any
    nonFinite.typography.fontSizeBase = Number.POSITIVE_INFINITY
    invalidDocuments.push(nonFinite)
    const unsupportedVersion = { ...defaultSiteTheme(), version: 2 }
    invalidDocuments.push(unsupportedVersion)
    invalidDocuments.push({ ...defaultSiteTheme(), rawCss: 'body { display: none }' })

    for (const document of invalidDocuments) {
      expect(siteThemeSchema.safeParse(document).success).toBe(false)
    }
    const radiusError = siteThemeSchema.safeParse(radiusOrder)
    expect(radiusError.success).toBe(false)
    if (!radiusError.success) expect(radiusError.error.issues[0]?.path).toEqual(['radii', 'md'])
  })

  it('compiles a portable-only contract with v1 aliases and explicit light/dark/system cascade', () => {
    const css = compileSiteThemeCss(defaultSiteTheme())
    for (const variable of [
      '--halo-color-primary',
      '--halo-color-secondary',
      '--halo-color-neutral',
      '--halo-color-background',
      '--halo-color-text',
      '--halo-color-success',
      '--halo-color-info',
      '--halo-color-warning',
      '--halo-color-error',
      '--halo-font-family-body',
      '--halo-font-family-heading',
      '--halo-font-size-base',
      '--halo-line-height-body',
      '--halo-line-height-heading',
      '--halo-radius-control',
      '--halo-radius-md',
      '--halo-space-block',
      '--halo-space-inline'
    ]) expect(css).toContain(variable)

    expect(css).toContain('.halo-content[data-halo-color-mode="light"]')
    expect(css).toContain('.halo-content[data-halo-color-mode="dark"]')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain('.halo-content[data-halo-color-mode="default"]')
    expect(css).toContain('--halo-primary: var(--halo-color-primary)')
    expect(css).toContain('--halo-background: var(--halo-color-background)')
    expect(css).toContain('--halo-radius: var(--halo-radius-md)')
    expect(css).toContain('font-family: var(--halo-font-family-body)')
    expect(css).toContain('line-height: var(--halo-line-height-heading)')
    expect(css).toContain('margin-block-start: var(--halo-space-block)')
    expect(css).toContain('margin-block-start: var(--halo-space-inline)')
    expect(css).toContain('.halo-content .halo-block-header')
    expect(css).toContain('gap: var(--halo-space-inline)')
    expect(css).toContain('--halo-shadow: var(--halo-elevation-shadow)')
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*--halo-elevation-shadow: 0 18px 45px/)
    expect(css).not.toMatch(/--ui-|\.site-shell|(^|\s)\.dark(?:\s|\{|,)|tailwind|nuxt|vue|@font-face|url\(/i)
  })

  it('wins the portable v1 cascade for spacing and heading margins with computed styles', () => {
    const theme = defaultSiteTheme()
    theme.spacing.block = 3
    theme.spacing.inline = 2
    const base = readFileSync(resolve(import.meta.dirname, '../server/assets/portable-content-v1.css'), 'utf8')
    const window = new Window()
    const style = window.document.createElement('style')
    style.textContent = `${base}\n${compileSiteThemeCss(theme)}`
    window.document.head.append(style)
    window.document.body.innerHTML = `<article class="halo-content" data-halo-color-mode="light">
      <div>First block</div><div id="next-block">Next block</div>
      <h2>Heading</h2><p id="after-heading">Body</p>
      <div class="halo-block-header" id="header"></div>
      <div class="halo-actions" id="actions"></div>
      <div class="halo-logo-list" id="logos"></div>
    </article>`
    expect(window.getComputedStyle(window.document.querySelector('#next-block')!).marginBlockStart).toBe('3rem')
    expect(window.getComputedStyle(window.document.querySelector('#after-heading')!).marginBlockStart).toBe('2rem')
    for (const id of ['header', 'actions', 'logos']) {
      expect(window.getComputedStyle(window.document.querySelector(`#${id}`)!).gap).toBe('2rem')
    }
    window.close()
  })

  it('deterministically adapts every legacy Appearance role and preserves the visual default', () => {
    const presentation = defaultSitePresentation()
    expect(adaptLegacyAppearanceToSiteTheme(presentation.appearance)).toEqual(defaultSiteTheme())
    expect(defaultSiteTheme().typography).toMatchObject({
      bodyFontFamily: 'public-sans',
      headingFontFamily: 'public-sans',
      fontSizeBase: 1,
      lineHeightBody: 1.6
    })
    expect(defaultSiteTheme().colors).toMatchObject({
      light: {
        secondary: '#2b7fff', success: '#00c16a', info: '#2b7fff', warning: '#f0b100', error: '#fb2c36'
      },
      dark: {
        secondary: '#51a2ff', success: '#00dc82', info: '#51a2ff', warning: '#fdc700', error: '#ff6467'
      }
    })

    const primaryPairs = {
      blue: ['#2b7fff', '#51a2ff'],
      emerald: ['#00bc7d', '#00d492'],
      indigo: ['#615fff', '#7c86ff'],
      orange: ['#ff6900', '#ff8904'],
      purple: ['#ad46ff', '#c27aff'],
      rose: ['#ff2056', '#ff637e'],
      teal: ['#00bba7', '#00d5be']
    } as const
    for (const primaryColor of SITE_PRIMARY_COLORS) {
      const appearance = { ...presentation.appearance, primaryColor }
      const adapted = adaptLegacyAppearanceToSiteTheme(appearance)
      expect([adapted.colors.light.primary, adapted.colors.dark.primary]).toEqual(primaryPairs[primaryColor])
    }
    const neutralRoles = {
      gray: ['#6a7282', '#364153', '#99a1af', '#101828', '#e5e7eb', '#1e2939'],
      neutral: ['#737373', '#404040', '#a1a1a1', '#171717', '#e5e5e5', '#262626'],
      slate: ['#62748e', '#314158', '#90a1b9', '#0f172b', '#e2e8f0', '#1d293d'],
      stone: ['#79716b', '#44403b', '#a6a09b', '#1c1917', '#e7e5e4', '#292524'],
      zinc: ['#71717b', '#3f3f46', '#9f9fa9', '#18181b', '#e4e4e7', '#27272a']
    } as const
    for (const neutralColor of SITE_NEUTRAL_COLORS) {
      const appearance = { ...presentation.appearance, neutralColor }
      const adapted = adaptLegacyAppearanceToSiteTheme(appearance)
      const expected = neutralRoles[neutralColor]
      expect([
        adapted.colors.light.neutral,
        adapted.colors.light.text,
        adapted.colors.dark.neutral,
        adapted.colors.dark.background,
        adapted.colors.dark.text
      ]).toEqual([expected[0], expected[1], expected[2], expected[3], expected[4]])
      const css = compileSiteThemeCss(adapted)
      expect(css).toContain(`--halo-color-background-accented: ${expected[4]};`)
      expect(css).toContain(`--halo-color-background-muted-dark: ${expected[5]};`)
    }
    const radiusScales = {
      none: { control: 0, sm: 0, md: 0, lg: 0 },
      sm: { control: 0.125, sm: 0.125, md: 0.1875, lg: 0.25 },
      md: { control: 0.25, sm: 0.25, md: 0.375, lg: 0.5 },
      lg: { control: 0.5, sm: 0.5, md: 0.75, lg: 1 }
    } as const
    for (const [radius, expected] of Object.entries(radiusScales) as Array<[
      SitePresentation['appearance']['radius'], SiteTheme['radii']
    ]>) {
      const theme = adaptLegacyAppearanceToSiteTheme({ ...presentation.appearance, radius })
      expect(siteThemeSchema.safeParse(theme).success).toBe(true)
      expect(theme.radii).toEqual(expected)
    }
    for (const [typographyScale, expected] of Object.entries({ compact: 1.45, default: 1.6, relaxed: 1.75 }) as Array<[
      SitePresentation['appearance']['typographyScale'], number
    ]>) {
      const adapted = adaptLegacyAppearanceToSiteTheme({
        ...presentation.appearance,
        typographyScale
      })
      expect(siteThemeSchema.safeParse(adapted).success).toBe(true)
      expect(adapted.typography.lineHeightBody).toBe(expected)
      expect(adapted.typography).toMatchObject({
        bodyFontFamily: 'public-sans',
        headingFontFamily: 'public-sans',
        fontSizeBase: 1
      })
    }
    for (const colorMode of ['system', 'light', 'dark'] as const) {
      expect(adaptLegacyAppearanceToSiteTheme({ ...presentation.appearance, colorMode }).colorMode).toBe(colorMode)
    }
  })

  it('computes known WCAG ratios and returns nonblocking warnings from unrounded values', () => {
    expect(siteThemeContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 8)
    expect(siteThemeContrastRatio('#abcdef', '#abcdef')).toBe(1)
    expect(siteThemeContrastRatio('#64779d', '#ffffff')).toBeLessThan(4.5)

    const lowContrast = defaultSiteTheme()
    lowContrast.colors.light.text = '#64779d'
    expect(siteThemeSchema.safeParse(lowContrast).success).toBe(true)
    expect(siteThemeAccessibilityWarnings(lowContrast))
      .toContain('light text and background are below the WCAG AA 4.5:1 contrast target.')
    expect(buildSiteThemeArtifact(lowContrast).warnings.length).toBeGreaterThan(0)

    const midpointRole = defaultSiteTheme()
    midpointRole.colors.light.primary = '#777777'
    expect(siteThemeAccessibilityWarnings(midpointRole))
      .toContain('light primary and its derived foreground are below the WCAG AA 4.5:1 contrast target.')

    const textRole = defaultSiteTheme()
    textRole.colors.light.warning = '#d97706'
    expect(siteThemeContrastRatio(textRole.colors.light.warning, textRole.colors.light.background)).toBeLessThan(4.5)
    expect(siteThemeAccessibilityWarnings(textRole))
      .toContain('light warning text is below the WCAG AA 4.5:1 contrast target against the background.')

    const neutralTextRole = defaultSiteTheme()
    neutralTextRole.colors.light.neutral = '#aaaaaa'
    expect(siteThemeContrastRatio(neutralTextRole.colors.light.neutral, neutralTextRole.colors.light.background)).toBeLessThan(4.5)
    expect(siteThemeAccessibilityWarnings(neutralTextRole))
      .toContain('light neutral text is below the WCAG AA 4.5:1 contrast target against the background.')

    const brightRole = defaultSiteTheme()
    brightRole.colors.light.primary = '#ffff00'
    const brightCss = compileSiteThemeCss(brightRole)
    expect(siteThemeContrastRatio('#ffffff', '#ffff00')).toBeLessThan(1.1)
    expect(siteThemeContrastRatio('#18181b', '#ffff00')).toBeGreaterThan(4.5)
    expect(brightCss).toContain('--halo-color-on-primary: #18181b')
  })

  it('validates the public manifest URL and requires the explicit public Site-mode projection', () => {
    const artifact = buildSiteThemeArtifact(defaultSiteTheme())
    const manifest = {
      contractVersion: 1 as const,
      revision: artifact.revision,
      stylesheetRevision: artifact.stylesheetRevision,
      stylesheetUrl: `https://press.example.com${artifact.stylesheetPath}`,
      colorMode: 'system' as const,
      siteModeEnabled: false
    }
    expect(normalizePublicSiteThemeManifest(manifest)).toEqual(manifest)
    expect(normalizePublicSiteThemeManifest({ ...manifest, siteModeEnabled: undefined })).toBeNull()
    expect(normalizePublicSiteThemeManifest({ ...manifest, siteModeEnabled: 'false' })).toBeNull()
    for (const stylesheetUrl of [
      'not-a-url',
      `javascript:${artifact.stylesheetPath}`,
      `https://user:pass@press.example.com${artifact.stylesheetPath}`,
      `https://press.example.com${artifact.stylesheetPath}?cache=off`,
      `https://press.example.com/_halo/theme/v1/${'a'.repeat(64)}.css`
    ]) {
      expect(normalizePublicSiteThemeManifest({ ...manifest, stylesheetUrl })).toBeNull()
    }
  })
})
