import { describe, expect, it } from 'vitest'
import type { KoreanSearchAnalyzer } from '../src'
import {
  KOREAN_SEARCH_TOKENIZER_GENERATION,
  createSearchTokenizer,
  extractRawTerms,
  normalizeSearchText,
  splitTokenizerChunks,
  validateSearchTerms
} from '../src'
import { extractSearchPlainText } from '../src/plain-text'

const corpus: Record<string, Array<{ text: string, pos: string }>> = {
  '학교에서 점심을 먹었다': [
    { text: '학교', pos: 'NNG' },
    { text: '에서', pos: 'JKB' },
    { text: '점심', pos: 'NNG' },
    { text: '을', pos: 'JKO' },
    { text: '먹', pos: 'VV' },
    { text: '었', pos: 'EP' },
    { text: '다', pos: 'EF' }
  ],
  학교: [{ text: '학교', pos: 'NNG' }],
  먹다: [{ text: '먹', pos: 'VV' }, { text: '다', pos: 'EF' }]
}

function analyzer(): KoreanSearchAnalyzer {
  return {
    analyze(text) {
      return { tokens: corpus[text] ?? [{ text, pos: 'NNP' }] }
    },
    modelInfo() {
      return { version: '0.9.11', size: 1_438_231, accuracy: 0.958 }
    },
    destroy() {}
  }
}

describe('Korean search tokenizer contract', () => {
  it('shares Korean noun and verb stems between documents and queries', () => {
    const tokenizer = createSearchTokenizer(analyzer())
    const document = tokenizer.analyzeDocument('학교에서 점심을 먹었다')

    expect(document.morphTerms).toEqual(['학교', '점심', '먹'])
    expect(tokenizer.analyzeQuery('학교').morphTerms).toEqual(['학교'])
    expect(tokenizer.analyzeQuery('먹다').morphTerms).toEqual(['먹'])
    expect(document.tokenizerGeneration).toBe(KOREAN_SEARCH_TOKENIZER_GENERATION)
  })

  it('normalizes NFC/NFD input and retains mixed raw identifiers in order', () => {
    const nfd = '학교'.normalize('NFD')
    expect(normalizeSearchText(nfd)).toBe('학교')
    expect(extractRawTerms('Cloudflare Workers AI BM25 code_123 2026')).toEqual([
      'cloudflare',
      'workers',
      'ai',
      'bm25',
      'code_123',
      '2026'
    ])
  })

  it('bounds query terms without accepting raw whitespace or non-normalized input', () => {
    expect(validateSearchTerms(['학교', 'bm25'])).toEqual(['학교', 'bm25'])
    expect(() => validateSearchTerms(['학교 에서'])).toThrow('normalized tokens')
    expect(() => validateSearchTerms(['A'])).toThrow('normalized tokens')
    expect(() => validateSearchTerms(Array.from({ length: 65 }, () => 'a'))).toThrow('exceed')
  })

  it('splits long content without losing normalized text', () => {
    const source = Array.from({ length: 60 }, (_, index) => `학교에서 ${index}번째 점심을 먹었다.`).join(' ')
    const chunks = splitTokenizerChunks(source, 256)
    expect(chunks.length).toBeGreaterThanOrEqual(6)
    expect(chunks.every(chunk => new TextEncoder().encode(chunk).byteLength <= 256)).toBe(true)
    expect(chunks.join(' ')).toBe(normalizeSearchText(source))
  })

  it('extracts only text nodes from malformed richtext-like values', () => {
    const result = extractSearchPlainText({
      type: 'doc',
      attrs: { src: 'data:image/png;base64,secret', alt: 'not indexed' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '안녕하세요' }] },
        null,
        { type: 'image', attrs: { src: '<script>alert(1)</script>' } }
      ]
    })
    expect(result).toEqual({ text: '안녕하세요', truncated: false, bytes: 15 })
    expect(extractSearchPlainText('<p>Hello <strong>학교</strong></p><script>secret()</script>')).toMatchObject({
      text: 'Hello 학교',
      truncated: false
    })
  })
})
