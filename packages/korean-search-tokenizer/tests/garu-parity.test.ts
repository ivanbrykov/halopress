import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Garu } from 'garu-ko'
import type { KoreanSearchTokenizer } from '../src'
import { createSearchTokenizer } from '../src'

let tokenizer: KoreanSearchTokenizer

beforeAll(async () => {
  tokenizer = createSearchTokenizer(await Garu.load())
})

afterAll(() => {
  tokenizer.destroy()
})

describe('pinned Garu parity corpus', () => {
  it.each([
    ['학교에서 점심을 먹었다', ['학교', '점심', '먹']],
    ['학교', ['학교']],
    ['먹다', ['먹']],
    ['Cloudflare Workers AI BM25 code_123 2026', ['cloudflare', 'workers', 'ai', 'bm25', 'code', '123', '2026']],
    ['대한민국', ['대한민국']]
  ])('analyzes %s deterministically', (input, expected) => {
    expect(tokenizer.analyzeDocument(input).morphTerms).toEqual(expected)
    expect(tokenizer.analyzeDocument(input)).toEqual(tokenizer.analyzeDocument(input.normalize('NFD')))
  })
})
