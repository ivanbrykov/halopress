import { describe, expect, it } from 'vitest'

import {
  legacyContentPath,
  legacyPagePath,
  normalizePublicPath,
  normalizePublicSlug,
  PublicPathValidationError,
  publicPathFromDecodedSegments,
  publicPathToHref,
  publicPathLookupKey
} from '../shared/public-routing'

describe('public route normalization', () => {
  it('normalizes Unicode input with NFKC before generating slugs', () => {
    expect(normalizePublicSlug('　Ｈｅｌｌｏ＿Ｗｏｒｌｄ　')).toBe('hello-world')
    expect(normalizePublicSlug('Cafe\u0301 Society')).toBe('café-society')
    expect(normalizePublicPath('/Ｎｅｗｓ/Cafe\u0301 Society')).toBe('/news/café-society')
  })

  it('normalizes lookup case while preserving schema-key underscores', () => {
    expect(publicPathLookupKey('/Release_Notes/Entry_01')).toBe('/release_notes/entry_01')
    expect(publicPathLookupKey('／Ｒｅｌｅａｓｅ＿Ｎｏｔｅｓ／Ｅｎｔｒｙ＿０１'))
      .toBe('/release_notes/entry_01')
  })

  it('reconstructs Unicode router params without accepting encoded segment boundaries', () => {
    const path = publicPathFromDecodedSegments(['뉴스', 'café'])
    expect(path).toBe('/뉴스/café')
    expect(publicPathToHref(path)).toBe('/%EB%89%B4%EC%8A%A4/caf%C3%A9')
    expect(() => publicPathFromDecodedSegments(['article', 'nested/entry'])).toThrow(PublicPathValidationError)
    expect(() => publicPathFromDecodedSegments(['article', 'nested／entry'])).toThrow(PublicPathValidationError)
    expect(() => publicPathFromDecodedSegments(['article', 'nested＼entry'])).toThrow(PublicPathValidationError)
  })

  it('truncates long astral slugs without splitting a Unicode code point', () => {
    const slug = normalizePublicSlug('𐐀'.repeat(121))
    expect([...slug]).toHaveLength(120)
    expect(() => encodeURIComponent(slug)).not.toThrow()
  })

  it.each([
    '/_desk/article',
    '/ＡＰＩ/article',
    '/assets/image',
    '/p/page-id',
    '/robots.txt',
    '/search',
    '/sitemap.xml'
  ])('rejects the reserved public root %s', (path) => {
    expect(() => normalizePublicPath(path)).toThrow(PublicPathValidationError)
    expect(() => publicPathLookupKey(path)).toThrow(PublicPathValidationError)
  })

  it('permits reserved roots only for explicit system and legacy route generation', () => {
    expect(publicPathLookupKey('/p/page-id', { allowReserved: true })).toBe('/p/page-id')
    expect(legacyPagePath('PAGE_01')).toBe('/p/page_01')
  })
})

describe('legacy public route identity', () => {
  it('builds deterministic lowercase content paths without replacing schema underscores', () => {
    expect(legacyContentPath('Release_Notes', '01JZ_ID')).toBe('/release_notes/01jz_id')
    expect(legacyContentPath('Ｒｅｌｅａｓｅ＿Ｎｏｔｅｓ', 'ＩＤ＿０１'))
      .toBe('/release_notes/id_01')
  })

  it('builds deterministic lowercase page paths under the reserved page prefix', () => {
    expect(legacyPagePath('01JZ_PAGE_ID')).toBe('/p/01jz_page_id')
    expect(legacyPagePath('ＰＡＧＥ＿０１')).toBe('/p/page_01')
  })
})

describe('public route lookup validation', () => {
  it.each([
    '',
    '/',
    '/article\\entry',
    '/article?draft=true',
    '/article#preview',
    '/article%2Fentry',
    '/article/..',
    '/article/has space',
    '/one/two/three/four/five/six/seven/eight/nine'
  ])('rejects invalid or ambiguous lookup path %j', (path) => {
    expect(() => publicPathLookupKey(path)).toThrow(PublicPathValidationError)
  })

  it('rejects non-text and overlong lookup paths', () => {
    expect(() => publicPathLookupKey(42)).toThrow(PublicPathValidationError)
    expect(() => publicPathLookupKey(`/${'a'.repeat(512)}`)).toThrow(PublicPathValidationError)
  })
})
