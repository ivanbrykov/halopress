export type SearchStatementResult<T = Record<string, unknown>> = {
  results?: T[]
  success?: boolean
  meta?: Record<string, unknown>
}

export type SearchPreparedStatement = {
  bind(...values: unknown[]): SearchPreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<SearchStatementResult<T>>
  run<T = Record<string, unknown>>(): Promise<SearchStatementResult<T>>
}

/**
 * The deliberately small SQLite statement surface used by the search runtime.
 * Platform-specific SQLite adapters implement this contract.
 */
export type SearchStore = {
  prepare(query: string): SearchPreparedStatement
  batch<T = Record<string, unknown>>(
    statements: SearchPreparedStatement[]
  ): Promise<Array<SearchStatementResult<T>>>
}
