import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { pageBlockKeys } from '../shared/page-blocks'
import {
  buildPageDocumentFromPattern,
  clonePagePatternContent,
  pagePatternDefinitions,
  pagePatternKeys,
  validatePagePatternDefinition
} from '../shared/page-patterns'
import { pagePatternViewports, pagePatternVisualFixtures } from './fixtures/page-patterns'

const projectRoot = resolve(import.meta.dirname, '..')

describe('page pattern registry', () => {
  it('classifies versioned library entries independently from legacy atomic definitions', () => {
    expect(pagePatternDefinitions.map(pattern => pattern.key)).toEqual(pagePatternKeys)
    expect(new Set(pagePatternKeys).size).toBe(pagePatternKeys.length)
    expect(pagePatternKeys.some(key => pageBlockKeys.includes(key as any))).toBe(false)

    for (const pattern of pagePatternDefinitions) {
      expect(pattern.version).toBe(2)
      expect(['configured-block', 'editable-unit', 'document-pattern']).toContain(pattern.model)
      expect(pattern.compatibility).toMatchObject({
        editor: 'page',
        patternContract: 2,
        blockRegistry: 1
      })
      expect(validatePagePatternDefinition(pattern)).toEqual([])
    }
    expect(Object.fromEntries(pagePatternDefinitions.map(pattern => [pattern.key, pattern.model]))).toEqual({
      'centered-hero': 'editable-unit',
      'split-hero': 'editable-unit',
      'feature-grid': 'document-pattern',
      'media-content': 'document-pattern',
      'testimonial-social-proof': 'document-pattern',
      faq: 'configured-block',
      'closing-cta': 'document-pattern',
      'starter-page': 'document-pattern'
    })
  })

  it('ships the reviewed starter set and deep-clones every insertion', () => {
    expect(pagePatternKeys).toEqual([
      'centered-hero',
      'split-hero',
      'feature-grid',
      'media-content',
      'testimonial-social-proof',
      'faq',
      'closing-cta',
      'starter-page'
    ])

    const first = clonePagePatternContent('starter-page')
    const second = clonePagePatternContent('starter-page')
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    first[0]!.attrs!.reverse = true
    expect(second[0]!.attrs!.reverse).not.toBe(first[0]!.attrs!.reverse)
    expect(buildPageDocumentFromPattern('starter-page').content).not.toEqual(first)
  })

  it('contains only portable allowlisted data and intentional author placeholders', () => {
    const serialized = JSON.stringify(pagePatternDefinitions)
    expect(serialized).not.toMatch(/https?:\/\//)
    expect(serialized).not.toMatch(/"(?:class|ui|onClick|is)":/)
    expect(serialized).toContain('imageUpload')
    expect(serialized).toContain('[Add')

    const splitHero = pagePatternDefinitions.find(pattern => pattern.key === 'split-hero')!
    expect(splitHero.content.content[0]).toMatchObject({
      type: 'pageHero',
      attrs: { orientation: 'horizontal', reverse: false }
    })
    expect(splitHero.content.content[0]!.content?.map(node => node.type)).toEqual([
      'heading', 'paragraph', 'paragraph', 'imageUpload'
    ])

    const unsafe = structuredClone(splitHero)
    ;(unsafe.content.content[0]!.attrs as any).renderer = 'ArbitraryComponent'
    expect(validatePagePatternDefinition(unsafe)).toContain('Pattern.1 contains forbidden stored attributes.')
  })

  it('reports malformed runtime nodes without throwing', () => {
    const missingNode = structuredClone(pagePatternDefinitions[0]!) as any
    missingNode.content.content = [null]
    expect(validatePagePatternDefinition(missingNode)).toContain('Pattern.1 is not a Tiptap JSON node or mark.')

    const missingAttrs = structuredClone(pagePatternDefinitions[0]!) as any
    missingAttrs.content.content = [{ type: 'pageBlock' }]
    expect(validatePagePatternDefinition(missingAttrs)).toContain('Pattern.1 is not an approved configured block.')
  })
})

describe('page pattern visual fixtures', () => {
  it('provides deterministic desktop and mobile regression targets for every pattern', () => {
    expect(pagePatternViewports).toEqual({
      desktop: { width: 1280, height: 900, colorMode: 'light' },
      mobile: { width: 390, height: 844, colorMode: 'dark' }
    })

    for (const pattern of pagePatternDefinitions) {
      const fixtures = pagePatternVisualFixtures.filter(fixture => fixture.patternKey === pattern.key)
      expect(fixtures.map(fixture => fixture.viewport).sort()).toEqual(['desktop', 'mobile'])
      for (const fixture of fixtures) {
        expect(fixture.patternVersion).toBe(pattern.version)
        expect(fixture.document).toEqual(buildPageDocumentFromPattern(pattern.key as any))
        expect(fixture.selector).toContain(`${pattern.key}-v${pattern.version}`)
      }
    }
  })

  it('uses a real editable Hero content DOM and retains finite configured atoms', async () => {
    const [hero, faq, logos, palette] = await Promise.all([
      readFile(resolve(projectRoot, 'app/editor/page/PageHeroNodeView.vue'), 'utf8'),
      readFile(resolve(projectRoot, 'app/components/page-blocks/PageBlockFAQ.vue'), 'utf8'),
      readFile(resolve(projectRoot, 'app/components/page-blocks/PageBlockLogos.vue'), 'utf8'),
      readFile(resolve(projectRoot, 'app/components/page-editor/PageBlockPalette.vue'), 'utf8')
    ])
    expect(hero).toContain('<NodeViewContent')
    expect(hero).toContain('data-type="page-hero"')
    expect(hero).toContain('contenteditable="false"')
    expect(hero.match(/contenteditable=/g)).toHaveLength(1)
    expect(hero).toContain('page-hero-unit--horizontal')
    expect(hero).toContain('page-hero-unit--reverse')
    expect(hero).toContain('page-hero-unit__content min-w-0 pt-6')
    expect(faq).toContain('<UAccordion')
    expect(faq).toContain(':unmount-on-hide="false"')
    expect(logos).toContain('grid-cols-2')
    expect(logos).toContain('sm:grid-cols-4')
    expect(palette).toContain('return \'Editable unit\'')
    expect(palette).toContain('return \'Editable pattern\'')
    expect(palette).toContain('return \'Configured block\'')
  })

  it('documents copy-on-insert upgrades without rewriting existing pages', async () => {
    const docs = await readFile(resolve(projectRoot, 'docs/page-patterns.md'), 'utf8')
    expect(docs).toContain('copy-on-insert')
    expect(docs).toContain('Existing pages are never rewritten automatically')
    expect(docs).toContain('1280 × 900')
    expect(docs).toContain('390 × 844')
  })
})
