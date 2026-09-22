import {
  KEYWORD_SEARCH_CONTRACT_VERSION,
  KEYWORD_SEARCH_DEFAULT_LIMIT,
  type KeywordSearchFilter,
  type KeywordSearchResponse,
  type KeywordSearchResult
} from './keyword-search'

export type KeywordSearchCapabilities = {
  contractVersion: typeof KEYWORD_SEARCH_CONTRACT_VERSION
  mode: 'browser' | 'server'
  endpoint: string | null
  browserFallback: boolean
  tokenizerGeneration: string
  queryEpoch: number | null
  indexAvailable: boolean
  analyzer: {
    status: 'initializing' | 'available' | 'unavailable'
    retryable: boolean
  }
  available: boolean
  enabledFields: number
}

export type KeywordSearchInput = {
  query: string
  operator?: 'all' | 'any'
  schemaKeys?: string[]
  fieldIds?: string[]
  filters?: KeywordSearchFilter[]
  limit?: number
}

export type KeywordSearchClientStatus =
  | 'idle'
  | 'loading-capabilities'
  | 'initializing-analyzer'
  | 'searching'
  | 'ready'
  | 'unavailable'
  | 'error'

export type KeywordSearchClientError = {
  code: string
  message: string
  status: number
  retryable: boolean
}

export type KeywordSearchClientState = {
  status: KeywordSearchClientStatus
  mode: 'browser' | 'server' | null
  query: string
  items: KeywordSearchResult[]
  nextCursor: string | null
  availability: 'available' | 'partial' | 'unavailable'
  fallback: boolean
  error: KeywordSearchClientError | null
}

type BrowserTokenizer = {
  analyzeQuery(query: string): {
    tokenizerGeneration: string
    rawTerms: string[]
    morphTerms: string[]
  }
}

type KeywordSearchClientOptions = {
  fetch?: typeof globalThis.fetch
  loadBrowserTokenizer: () => Promise<BrowserTokenizer>
  capabilitiesEndpoint?: string
  tokenEndpoint?: string
}

type SearchAttempt = {
  input: Required<Omit<KeywordSearchInput, 'filters'>> & { filters: KeywordSearchFilter[] }
  append: boolean
}

const INITIAL_STATE: KeywordSearchClientState = {
  status: 'idle',
  mode: null,
  query: '',
  items: [],
  nextCursor: null,
  availability: 'unavailable',
  fallback: false,
  error: null
}

function normalizeInput(input: KeywordSearchInput): SearchAttempt['input'] {
  return {
    query: input.query.normalize('NFC').replace(/\s+/gu, ' ').trim(),
    operator: input.operator === 'any' ? 'any' : 'all',
    schemaKeys: [...new Set(input.schemaKeys ?? [])],
    fieldIds: [...new Set(input.fieldIds ?? [])],
    filters: input.filters ?? [],
    limit: input.limit ?? KEYWORD_SEARCH_DEFAULT_LIMIT
  }
}

function requestIdentity(input: SearchAttempt['input']) {
  return JSON.stringify(input)
}

function errorFromPayload(status: number, payload: unknown): KeywordSearchClientError {
  const value = payload && typeof payload === 'object'
    ? payload as Record<string, any>
    : {}
  const details = value.error && typeof value.error === 'object'
    ? value.error
    : value.data && typeof value.data === 'object'
      ? value.data
      : {}
  const code = typeof details.code === 'string'
    ? details.code
    : status === 429
      ? 'rate_limited'
      : 'search_failed'
  return {
    code,
    message: typeof details.message === 'string'
      ? details.message
      : typeof value.statusMessage === 'string'
        ? value.statusMessage
        : status === 429
          ? 'Too many search requests'
          : 'Keyword search failed',
    status,
    retryable: Boolean(details.retryable) || status === 409 || status === 429 || status >= 500
  }
}

function networkError(error: unknown): KeywordSearchClientError {
  return {
    code: 'network_error',
    message: error instanceof Error ? error.message : 'Search network request failed',
    status: 503,
    retryable: true
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw errorFromPayload(response.status, payload)
  return payload as T
}

export function createKeywordSearchClient(options: KeywordSearchClientOptions) {
  const request = options.fetch ?? globalThis.fetch
  const capabilitiesEndpoint = options.capabilitiesEndpoint ?? '/api/keyword-search/capabilities'
  const tokenEndpoint = options.tokenEndpoint ?? '/api/keyword-search'
  const listeners = new Set<(state: KeywordSearchClientState) => void>()
  let state = { ...INITIAL_STATE }
  let capabilities: KeywordSearchCapabilities | null = null
  let capabilitiesPromise: Promise<KeywordSearchCapabilities> | null = null
  let activeController: AbortController | null = null
  let sequence = 0
  let activeIdentity = ''
  let lastAttempt: SearchAttempt | null = null

  const publish = (patch: Partial<KeywordSearchClientState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  const loadCapabilities = async (force = false) => {
    if (force) {
      capabilities = null
      capabilitiesPromise = null
    }
    if (capabilities) return capabilities
    if (!capabilitiesPromise) {
      publish({ status: 'loading-capabilities', error: null })
      capabilitiesPromise = request(capabilitiesEndpoint, {
        headers: { Accept: 'application/json' }
      })
        .then(response => responseJson<KeywordSearchCapabilities>(response))
        .then((value) => {
          if (value.contractVersion !== KEYWORD_SEARCH_CONTRACT_VERSION) {
            throw {
              code: 'contract_mismatch',
              message: 'Search client and server contracts do not match',
              status: 409,
              retryable: false
            } satisfies KeywordSearchClientError
          }
          const analyzerTransient = value.mode === 'server'
            && value.analyzer.status !== 'available'
            && value.analyzer.retryable
          capabilities = analyzerTransient ? null : value
          if (analyzerTransient) capabilitiesPromise = null
          publish({
            status: value.available ? 'idle' : 'unavailable',
            mode: value.mode,
            availability: value.indexAvailable ? 'available' : 'unavailable'
          })
          return value
        })
        .catch((error) => {
          capabilitiesPromise = null
          const details = error?.code ? error as KeywordSearchClientError : networkError(error)
          publish({ status: 'error', error: details })
          throw details
        })
    }
    return capabilitiesPromise
  }

  const post = async (endpoint: string, body: Record<string, unknown>, signal: AbortSignal) => {
    try {
      return await responseJson<KeywordSearchResponse>(await request(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      }))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error
      throw networkError(error)
    }
  }

  const browserSearch = async (
    selected: KeywordSearchCapabilities,
    input: SearchAttempt['input'],
    cursor: string | null,
    signal: AbortSignal,
    fallback: boolean
  ) => {
    publish({ status: 'initializing-analyzer', fallback, error: null })
    let tokenizer: BrowserTokenizer
    try {
      tokenizer = await options.loadBrowserTokenizer()
    } catch (error) {
      throw {
        code: 'analyzer_unavailable',
        message: error instanceof Error ? error.message : 'Browser search analyzer is unavailable',
        status: 503,
        retryable: true
      } satisfies KeywordSearchClientError
    }
    const analyzed = tokenizer.analyzeQuery(input.query)
    if (analyzed.tokenizerGeneration !== selected.tokenizerGeneration) {
      throw {
        code: 'generation_mismatch',
        message: 'Search index and browser analyzer generations do not match',
        status: 409,
        retryable: true
      } satisfies KeywordSearchClientError
    }
    publish({ status: 'searching', fallback, error: null })
    return post(tokenEndpoint, {
      contractVersion: KEYWORD_SEARCH_CONTRACT_VERSION,
      mode: 'tokens',
      tokenizerGeneration: analyzed.tokenizerGeneration,
      rawTerms: analyzed.rawTerms,
      morphTerms: analyzed.morphTerms,
      operator: input.operator,
      schemaKeys: input.schemaKeys,
      fieldIds: input.fieldIds,
      filters: input.filters,
      limit: input.limit,
      cursor
    }, signal)
  }

  const runSearch = async (attempt: SearchAttempt, staleCursorRetry = true): Promise<void> => {
    const input = attempt.input
    const identity = requestIdentity(input)
    const append = attempt.append && identity === activeIdentity && Boolean(state.nextCursor)
    const cursor = append ? state.nextCursor : null
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const requestSequence = ++sequence
    lastAttempt = { input, append }
    if (!append) {
      activeIdentity = identity
      publish({
        query: input.query,
        items: [],
        nextCursor: null,
        availability: 'unavailable',
        fallback: false,
        error: null
      })
    }
    if (!input.query) {
      publish({ ...INITIAL_STATE })
      return
    }

    try {
      const selected = await loadCapabilities()
      if (requestSequence !== sequence) return
      if (!selected.indexAvailable || !selected.available) {
        publish({
          status: 'unavailable',
          mode: selected.mode,
          availability: 'unavailable',
          error: null
        })
        return
      }

      let result: KeywordSearchResponse
      if (selected.mode === 'server' && selected.endpoint) {
        publish({ status: 'searching', mode: 'server', fallback: false, error: null })
        try {
          result = await post(selected.endpoint, {
            contractVersion: KEYWORD_SEARCH_CONTRACT_VERSION,
            mode: 'raw',
            query: input.query,
            operator: input.operator,
            schemaKeys: input.schemaKeys,
            fieldIds: input.fieldIds,
            filters: input.filters,
            limit: input.limit,
            cursor
          }, controller.signal)
        } catch (error) {
          const details = error as KeywordSearchClientError
          const fallbackEligible = selected.browserFallback
            && (details.code === 'analyzer_unavailable'
              || details.code === 'network_error'
              || details.status >= 500)
          if (!fallbackEligible) throw details
          result = await browserSearch(selected, input, cursor, controller.signal, true)
        }
      } else {
        result = await browserSearch(
          selected,
          input,
          cursor,
          controller.signal,
          selected.mode === 'server'
        )
      }
      if (requestSequence !== sequence) return
      publish({
        status: 'ready',
        mode: selected.mode,
        items: append ? [...state.items, ...result.items] : result.items,
        nextCursor: result.nextCursor,
        availability: result.availability,
        error: null
      })
    } catch (error) {
      if (controller.signal.aborted || requestSequence !== sequence) return
      const details = error && typeof error === 'object' && 'code' in error
        ? error as KeywordSearchClientError
        : networkError(error)
      if (append && details.code === 'stale_cursor' && staleCursorRetry) {
        activeIdentity = ''
        await runSearch({ input, append: false }, false)
        return
      }
      if (details.code === 'generation_mismatch') {
        capabilities = null
        capabilitiesPromise = null
      }
      publish({
        status: details.code === 'search_unavailable' ? 'unavailable' : 'error',
        nextCursor: details.code === 'generation_mismatch' ? null : state.nextCursor,
        error: details
      })
    }
  }

  return {
    get state() {
      return state
    },
    subscribe(listener: (value: KeywordSearchClientState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    loadCapabilities,
    search(input: KeywordSearchInput) {
      return runSearch({ input: normalizeInput(input), append: false })
    },
    loadMore() {
      if (!lastAttempt || !state.nextCursor) return Promise.resolve()
      return runSearch({ input: lastAttempt.input, append: true })
    },
    retry() {
      if (!lastAttempt) return loadCapabilities(true).then(() => undefined)
      return runSearch(lastAttempt)
    },
    clear() {
      activeController?.abort()
      sequence += 1
      activeIdentity = ''
      lastAttempt = null
      publish({ ...INITIAL_STATE, mode: capabilities?.mode ?? null })
    },
    dispose() {
      activeController?.abort()
      listeners.clear()
    }
  }
}
