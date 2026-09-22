function parseAcceptLanguage(value?: string) {
  if (!value) return ''
  const first = value.split(',')[0] || ''
  return first.split(';')[0]?.trim() || ''
}

export function useDisplayLocale() {
  return useState<string>('display-locale', () => {
    if (import.meta.server) {
      const headers = useRequestHeaders(['accept-language'])
      const locale = parseAcceptLanguage(headers['accept-language'])
      return locale || 'en-US'
    }

    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language
    }

    return 'en-US'
  })
}

export function formatDate(
  value: string | number | Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...options
  }).format(date)
}

export function formatDateTime(value: string | number | Date, locale: string, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options
  }).format(date)
}
