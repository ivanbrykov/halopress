import { buildPageDocumentFromPattern, pagePatternDefinitions, type PagePatternKey } from '../../shared/page-patterns'

export const pagePatternViewports = {
  desktop: { width: 1280, height: 900, colorMode: 'light' as const },
  mobile: { width: 390, height: 844, colorMode: 'dark' as const }
}

export type PagePatternVisualFixture = {
  id: string
  patternKey: PagePatternKey
  patternVersion: number
  viewport: keyof typeof pagePatternViewports
  width: number
  height: number
  colorMode: 'light' | 'dark'
  document: ReturnType<typeof buildPageDocumentFromPattern>
  selector: string
}

export const pagePatternVisualFixtures: PagePatternVisualFixture[] = pagePatternDefinitions.flatMap((pattern) => (
  Object.entries(pagePatternViewports).map(([viewport, dimensions]) => ({
    id: `${pattern.key}-v${pattern.version}-${viewport}`,
    patternKey: pattern.key as PagePatternKey,
    patternVersion: pattern.version,
    viewport: viewport as keyof typeof pagePatternViewports,
    ...dimensions,
    document: buildPageDocumentFromPattern(pattern.key as PagePatternKey),
    selector: `[data-page-pattern-fixture="${pattern.key}-v${pattern.version}"]`
  }))
))
