import { createError } from 'h3'

interface PreviewFetchError {
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
}

export function getPreviewDataState<T>(
  data: T | null | undefined,
  error: PreviewFetchError | null | undefined
): 'ready' | 'not-found' {
  const statusCode = error?.statusCode ?? error?.status

  if (error && (statusCode === 401 || statusCode === 403 || statusCode === 404)) {
    return 'not-found'
  }

  if (error) {
    throw createError({
      statusCode: statusCode ?? 500,
      statusMessage: error.statusMessage ?? error.message ?? 'Preview unavailable'
    })
  }

  return data == null ? 'not-found' : 'ready'
}
