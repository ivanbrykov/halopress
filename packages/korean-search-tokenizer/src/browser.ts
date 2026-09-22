import { Garu } from 'garu-ko/browser'
import { createSearchTokenizer } from './index'

export * from './index'

let cachedTokenizer: Promise<ReturnType<typeof createSearchTokenizer>> | null = null

export function createBrowserTokenizer() {
  cachedTokenizer ??= Garu.load()
    .then(createSearchTokenizer)
    .catch((error) => {
      cachedTokenizer = null
      throw error
    })
  return cachedTokenizer
}

export function resetBrowserTokenizerForTests() {
  cachedTokenizer = null
}
