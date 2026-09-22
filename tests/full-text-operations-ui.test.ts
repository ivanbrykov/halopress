import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const source = (path: string) => readFile(resolve(root, path), 'utf8')

describe('full-text indexing operations surface', () => {
  it('keeps status, retry, and reindex endpoints admin-only', async () => {
    const endpoints = await Promise.all([
      source('server/api/settings/search-index.get.ts'),
      source('server/api/settings/search-index/retry.post.ts'),
      source('server/api/settings/search-index/reindex.post.ts')
    ])
    for (const endpoint of endpoints) expect(endpoint).toContain('requireAdmin(event)')
    expect(endpoints[1]).toContain('queueFullTextReconcile(event)')
    expect(endpoints[2]).toContain('queueFullTextReconcile(event)')
  })

  it('renders unavailable and loading states without false zero values', async () => {
    const panel = await source('app/components/settings/SearchIndexingPanel.vue')
    expect(panel).toContain('useFetch<SearchIndexStatus>(\'/api/settings/search-index\')')
    expect(panel).not.toContain('await useFetch')
    expect(panel).toContain('Search indexing status is unavailable')
    expect(panel).toContain('v-else-if="pending && !data"')
    expect(panel).toContain('v-else-if="data"')
    expect(panel).toContain('Retry failed')
    expect(panel).toContain('Reindex all')
  })
})
