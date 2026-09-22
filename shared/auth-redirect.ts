type SessionUser = {
  role?: string | null
  accountType?: string | null
}

function isSafeLocalPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
}

export function resolvePostAuthPath(callbackUrl: unknown, user: SessionUser | null | undefined) {
  const isAdmin = user?.role === 'admin' && user.accountType === 'staff'
  const fallback = isAdmin ? '/_desk' : '/'
  if (!isSafeLocalPath(callbackUrl)) return fallback

  const pathname = callbackUrl.split(/[?#]/, 1)[0] || '/'
  if (pathname.startsWith('/api/') || pathname === '/login' || pathname === '/signup' || pathname === '/_install') {
    return fallback
  }
  if (!isAdmin && pathname.startsWith('/_desk')) return '/'
  return callbackUrl
}
