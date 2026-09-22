import { describe, expect, it } from 'vitest'

import { resolvePostAuthPath } from '../shared/auth-redirect'

describe('post-auth redirects', () => {
  const admin = { role: 'admin', accountType: 'staff' }
  const member = { role: 'user', accountType: 'member' }

  it('uses role-aware fallbacks and preserves safe local callbacks', () => {
    expect(resolvePostAuthPath(undefined, admin)).toBe('/_desk')
    expect(resolvePostAuthPath(undefined, member)).toBe('/')
    expect(resolvePostAuthPath('/_desk/users?status=active#results', admin))
      .toBe('/_desk/users?status=active#results')
    expect(resolvePostAuthPath('/articles/welcome?from=login#comments', member))
      .toBe('/articles/welcome?from=login#comments')
  })

  it('keeps non-admin and member sessions out of Desk callbacks', () => {
    expect(resolvePostAuthPath('/_desk', member)).toBe('/')
    expect(resolvePostAuthPath('/_desk/settings', { role: 'admin', accountType: 'member' })).toBe('/')
    expect(resolvePostAuthPath('/_desk/content', { role: 'publisher', accountType: 'staff' })).toBe('/')
  })

  it.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '///attacker.example/steal',
    '/\\attacker.example/steal'
  ])('rejects the unsafe callback %s', (callbackUrl) => {
    expect(resolvePostAuthPath(callbackUrl, admin)).toBe('/_desk')
    expect(resolvePostAuthPath(callbackUrl, member)).toBe('/')
  })

  it.each([
    '/api/auth/session',
    '/login?callbackUrl=/_desk',
    '/signup#form',
    '/_install'
  ])('rejects callbacks into reserved authentication and API routes: %s', (callbackUrl) => {
    expect(resolvePostAuthPath(callbackUrl, admin)).toBe('/_desk')
    expect(resolvePostAuthPath(callbackUrl, member)).toBe('/')
  })
})
