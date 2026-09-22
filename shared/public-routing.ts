export const PUBLIC_PAGE_ROUTE_PREFIX = 'p'

export const RESERVED_PUBLIC_PATH_SEGMENTS = new Set([
  '_desk',
  '_install',
  '_ipx',
  '_nuxt',
  '_preview',
  'account',
  'apple-touch-icon.png',
  'api',
  'assets',
  'auth',
  'branding',
  'cdn-cgi',
  'favicon.ico',
  'favicon.png',
  'login',
  PUBLIC_PAGE_ROUTE_PREFIX,
  'robots.txt',
  'search',
  'signup',
  'sitemap.xml'
])

export const RESERVED_SCHEMA_KEYS = RESERVED_PUBLIC_PATH_SEGMENTS

export function isReservedSchemaKey(key: string) {
  return RESERVED_SCHEMA_KEYS.has(key.normalize('NFKC').toLocaleLowerCase('en-US'))
}

export class PublicPathValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicPathValidationError'
  }
}

export function normalizePublicSlug(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const normalized = String(value)
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\p{Z}\s_]+/gu, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return [...normalized].slice(0, 120).join('')
}

export function publicPathFromDecodedSegments(values: unknown[]) {
  if (!values.length) throw new PublicPathValidationError('Public path must contain at least one segment')
  const segments = values.map((value) => {
    if (typeof value !== 'string') {
      throw new PublicPathValidationError('Public path contains an invalid encoded segment')
    }
    const normalized = value.normalize('NFKC')
    if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
      throw new PublicPathValidationError('Public path contains an invalid encoded segment')
    }
    return normalized
  })
  return publicPathLookupKey(`/${segments.join('/')}`, { allowReserved: true })
}

export function publicPathLookupKey(value: unknown, options: { allowReserved?: boolean } = {}) {
  if (typeof value !== 'string') throw new PublicPathValidationError('Public path must be text')
  const input = value.normalize('NFKC').trim()
  if (input.includes('\\')) throw new PublicPathValidationError('Public path cannot contain backslashes')
  const hasControlCharacter = [...input].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (/[?#%]/u.test(input) || hasControlCharacter) {
    throw new PublicPathValidationError('Public path cannot contain query, fragment, percent, or control characters')
  }
  const rawSegments = input.split('/').filter(Boolean)
  if (!rawSegments.length) throw new PublicPathValidationError('Public path must contain at least one segment')
  if (rawSegments.length > 8) throw new PublicPathValidationError('Public path can contain at most 8 segments')
  const normalizedFirst = rawSegments[0]!.normalize('NFKC').trim().toLocaleLowerCase('en-US')
  if (!options.allowReserved && RESERVED_PUBLIC_PATH_SEGMENTS.has(normalizedFirst)) {
    throw new PublicPathValidationError(`Public path uses reserved segment: ${normalizedFirst}`)
  }
  const segments = rawSegments.map((segment) => {
    const normalized = segment.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    if (!normalized || normalized === '.' || normalized === '..' || /[\p{Z}\s/]/u.test(normalized)) {
      throw new PublicPathValidationError('Public path contains an empty or invalid segment')
    }
    return normalized
  })
  if (!options.allowReserved && RESERVED_PUBLIC_PATH_SEGMENTS.has(segments[0]!)) {
    throw new PublicPathValidationError(`Public path uses reserved segment: ${segments[0]}`)
  }
  const path = `/${segments.join('/')}`
  if (path.length > 512) throw new PublicPathValidationError('Public path is too long')
  return path
}

export function normalizePublicPath(value: unknown, options: { allowReserved?: boolean } = {}) {
  if (typeof value !== 'string') throw new PublicPathValidationError('Public path must be text')
  const input = value.normalize('NFKC').trim()
  if (input.includes('\\')) throw new PublicPathValidationError('Public path cannot contain backslashes')
  const rawSegments = input.split('/').filter(Boolean)
  const normalizedFirst = rawSegments[0]?.normalize('NFKC').trim().toLocaleLowerCase('en-US')
  if (!options.allowReserved && normalizedFirst && RESERVED_PUBLIC_PATH_SEGMENTS.has(normalizedFirst)) {
    throw new PublicPathValidationError(`Public path uses reserved segment: ${normalizedFirst}`)
  }
  const segments = rawSegments.map((segment) => {
    const normalized = normalizePublicSlug(segment)
    if (!normalized) throw new PublicPathValidationError('Public path contains an empty or invalid segment')
    return normalized
  })
  return publicPathLookupKey(`/${segments.join('/')}`, options)
}

export function publicPathToHref(path: string) {
  if (path === '/') return path
  return `/${path.split('/').filter(Boolean).map(segment => encodeURIComponent(segment)).join('/')}`
}

export function publicParentPath(path: string | null) {
  if (!path || path === '/') return '/'
  const normalized = path.replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator <= 0 ? '/' : normalized.slice(0, separator)
}

export function legacyContentPath(schemaKey: string, contentId: string) {
  return publicPathLookupKey(`/${schemaKey.normalize('NFKC').toLocaleLowerCase('en-US')}/${String(contentId).normalize('NFKC').toLocaleLowerCase('en-US')}`, { allowReserved: true })
}

export function legacyPagePath(pageId: string) {
  return publicPathLookupKey(`/${PUBLIC_PAGE_ROUTE_PREFIX}/${String(pageId).normalize('NFKC').toLocaleLowerCase('en-US')}`, { allowReserved: true })
}

export function generatedContentPath(schemaKey: string, value: unknown, contentId: string) {
  const slug = normalizePublicSlug(value) || normalizePublicSlug(contentId)
  return publicPathLookupKey(`/${schemaKey.normalize('NFKC').toLocaleLowerCase('en-US')}/${slug}`, { allowReserved: true })
}

export function generatedPagePath(requestedPath: unknown, title: unknown, pageId: string) {
  if (typeof requestedPath === 'string' && requestedPath.trim()) return normalizePublicPath(requestedPath)
  const slug = normalizePublicSlug(title)
  if (slug && !RESERVED_PUBLIC_PATH_SEGMENTS.has(slug)) return normalizePublicPath(`/${slug}`)
  return legacyPagePath(pageId)
}

export { resolvePublicNavigationTarget } from './site-presentation'
