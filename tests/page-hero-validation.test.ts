import { describe, expect, it } from 'vitest'

import { pageBlockLibraryClassification } from '../app/editor/page/registry'
import { validatePageDocumentForPublication } from '../app/editor/page/validation'
import { normalizePageContent } from '../server/cms/page-content'
import { buildPageDocumentFromPattern } from '../shared/page-patterns'

describe('editable Page unit validation', () => {
  it('reuses the exact Page schema for Hero children and top-level placement', () => {
    const valid = buildPageDocumentFromPattern('centered-hero')
    expect(normalizePageContent(valid)).toEqual(valid)

    const malformed = structuredClone(valid) as any
    malformed.content[0].content = [{
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Missing required supporting paragraph' }]
    }]
    expect(() => normalizePageContent(malformed)).toThrow('Editable Hero has invalid child content.')

    const nested = {
      type: 'doc',
      content: [{ type: 'blockquote', content: valid.content }]
    }
    expect(() => normalizePageContent(nested)).toThrow('Editable Hero units must be top-level Page content.')
  })

  it('allows temporary Hero image upload state in drafts but not publication', () => {
    const draft = buildPageDocumentFromPattern('centered-hero') as any
    draft.content[0].content.push({ type: 'imageUpload' })

    expect(normalizePageContent(draft, { mode: 'draft' })).toEqual(draft)
    expect(() => normalizePageContent(draft, { mode: 'publish' }))
      .toThrow('Editable Hero has an unfinished image upload.')
  })

  it('rejects unfinished image uploads outside Heroes at publication', () => {
    const draft = buildPageDocumentFromPattern('media-content')

    expect(normalizePageContent(draft, { mode: 'draft' })).toEqual(draft)
    expect(validatePageDocumentForPublication(draft)).toContainEqual({
      path: 'content',
      message: 'Page has an unfinished image upload.'
    })
    expect(() => normalizePageContent(draft, { mode: 'publish' }))
      .toThrow('Page has an unfinished image upload.')
  })

  it('uses the same publication validation for the new-page starter and existing drafts', () => {
    const starter = buildPageDocumentFromPattern('starter-page')
    const existingDraft = structuredClone(starter)

    for (const document of [starter, existingDraft]) {
      expect(validatePageDocumentForPublication(document)[0]).toEqual({
        path: 'content.1',
        message: 'Editable Hero has an unfinished image upload.'
      })
    }
  })

  it('keeps every legacy atom classified while offering only finite configured blocks', () => {
    expect(pageBlockLibraryClassification).toEqual({
      pageHero: expect.objectContaining({ model: 'legacy-only', showDirectly: false }),
      pageCard: expect.objectContaining({ model: 'legacy-only', showDirectly: false }),
      pageSection: expect.objectContaining({ model: 'legacy-only', showDirectly: false }),
      pageTestimonial: expect.objectContaining({ model: 'legacy-only', showDirectly: false }),
      pageLogos: expect.objectContaining({ model: 'configured-block', showDirectly: true }),
      pageFAQ: expect.objectContaining({ model: 'configured-block', showDirectly: false }),
      pageCTA: expect.objectContaining({ model: 'legacy-only', showDirectly: false })
    })
    expect(Object.values(pageBlockLibraryClassification).every(entry => entry.rationale.length > 20)).toBe(true)
  })
})
