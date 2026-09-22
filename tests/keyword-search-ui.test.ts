import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../app/pages/search.vue', import.meta.url), 'utf8')
const component = readFileSync(
  new URL('../app/components/public/KeywordSearch.vue', import.meta.url),
  'utf8'
)
const composable = readFileSync(
  new URL('../app/composables/useKeywordSearch.ts', import.meta.url),
  'utf8'
)
const nuxtConfig = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
const sitemap = readFileSync(new URL('../server/routes/sitemap.xml.get.ts', import.meta.url), 'utf8')
const collectionPage = readFileSync(
  new URL('../app/pages/[schema]/index.vue', import.meta.url),
  'utf8'
)
const endpoint = readFileSync(
  new URL('../server/api/keyword-search.post.ts', import.meta.url),
  'utf8'
)
const searchContract = readFileSync(
  new URL('../shared/keyword-search.ts', import.meta.url),
  'utf8'
)
const analyzerBoundary = readFileSync(
  new URL('../server/utils/search-analyzer.ts', import.meta.url),
  'utf8'
)
const mainWorkerEntry = readFileSync(
  new URL('../workers/search/src/main-entry.ts', import.meta.url),
  'utf8'
)

describe('public keyword search surface', () => {
  it('keeps query state shareable while canonicalizing and excluding result URLs', () => {
    expect(page).toContain('robots.value = \'noindex, follow\'')
    expect(page).toContain('robots: \'noindex, follow\'')
    expect(page).toContain('rel: \'canonical\', href: canonicalUrl')
    expect(page).toContain('nextQuery.q = query')
    expect(page).not.toContain('route.query.schema')
    expect(page).not.toContain('route.query.field')
    expect(page).toContain('navigateTo({ path: \'/search\', query: nextQuery })')
    expect(page).not.toContain('{ replace: true }')
    expect(sitemap).toContain('listCanonicalPublicRoutes')
    expect(sitemap).not.toContain('/search')
  })

  it('keeps collection-scoped search and filter fields on the collection URL', () => {
    expect(collectionPage).toContain('collectionKeywordFilters')
    expect(collectionPage).toContain(':schema-keys="[schemaKey]"')
    expect(collectionPage).toContain(':filters="keywordFilters"')
    expect(collectionPage).toContain('path: route.path')
    expect(collectionPage).toContain('q: query || undefined')
    expect(collectionPage).not.toContain('path: \'/search\'')
  })

  it('resolves role access on the main Worker before returning ranked results', () => {
    expect(endpoint).toContain('const roleKey = await getSchemaRoleKey(event)')
    expect(endpoint).toContain('admin: roleKey === \'admin\'')
    expect(endpoint).toContain('\'Vary\', \'Cookie\'')
    expect(searchContract).toContain('WITH readable_schema AS')
    expect(searchContract).toContain('gate.role_key = ?')
    expect(searchContract).toContain('JOIN readable_schema access')
    expect(endpoint).toContain('analyzeKeywordSearchRequest(event, raw)')
    expect(analyzerBoundary).toContain('HALOPRESS_SEARCH_ANALYZER.analyzeQuery')
    expect(mainWorkerEntry).toContain('SEARCH_ANALYZER_BINDING')
    expect(mainWorkerEntry).not.toContain('/v1/analyze')
  })

  it('exposes explicit loading, unavailable, partial, fallback, empty, retry, and pagination states', () => {
    expect(component).toContain('status === \'unavailable\'')
    expect(component).toContain('availability === \'partial\'')
    expect(component).toContain('v-if="fallback"')
    expect(component).toContain('isInitialLoading')
    expect(component).toContain('title="No results"')
    expect(component).toContain('@click="retrySearch"')
    expect(component).toContain('@click="loadMore"')
    expect(component).toContain('aria-live="polite"')
    expect(component).toContain('searchInput.value?.inputRef?.focus()')
    expect(component).toContain('animation="carousel"')
  })

  it('returns synchronous state fields and keeps the browser analyzer lazy', () => {
    expect(composable).toContain('await import(\'@halopress/korean-search-tokenizer/browser\')')
    expect(composable).toContain('onMounted(() =>')
    expect(composable).toContain('state: readonly(state)')
    expect(composable).not.toContain('export async function useKeywordSearch')
    expect(composable).not.toContain('...client')
    expect(nuxtConfig).toContain('exclude: [\'garu-ko/browser\']')
  })
})
