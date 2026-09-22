import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; accountType: 'staff' | 'member' } }
}))

vi.mock('../server/utils/auth', () => ({
  getAuthSession: vi.fn(async () => authState.session)
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)

let middleware: (event: any) => Promise<any>
let accountMiddleware: (event: any) => Promise<any>

function request(path: string) {
  const headers = new Map<string, unknown>()
  const response = {
    statusCode: 200,
    statusMessage: '',
    writableEnded: false,
    setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    end() {
      response.writableEnded = true
    }
  }
  return {
    event: {
      context: {},
      path,
      node: {
        req: { url: path, originalUrl: path, headers: { host: 'example.test' } },
        res: response
      }
    },
    status: () => response.statusCode,
    location: () => headers.get('location')
  }
}

beforeAll(async () => {
  middleware = (await import('../server/middleware/desk-auth')).default
  accountMiddleware = (await import('../server/middleware/account-auth')).default
})

beforeEach(() => {
  authState.session = null
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('server Desk membership boundary', () => {
  it('redirects anonymous requests to the canonical public login', async () => {
    const target = request('/_desk/settings/membership?tab=invites')
    await middleware(target.event)
    expect(target.status()).toBe(302)
    expect(target.location()).toBe('/login?callbackUrl=%2F_desk%2Fsettings%2Fmembership%3Ftab%3Dinvites')
  })

  it('redirects authenticated members away from Desk', async () => {
    authState.session = { user: { id: 'member-1', role: 'user', accountType: 'member' } }
    const target = request('/_desk')
    await middleware(target.event)
    expect(target.status()).toBe(302)
    expect(target.location()).toBe('/')
  })

  it('allows only staff administrators to continue', async () => {
    authState.session = { user: { id: 'admin-1', role: 'admin', accountType: 'staff' } }
    const target = request('/_desk')
    await expect(middleware(target.event)).resolves.toBeUndefined()
    expect(target.status()).toBe(200)
    expect(target.location()).toBeUndefined()
  })
})

describe('server account boundary', () => {
  it('does not guard unrelated routes with an account prefix', async () => {
    const target = request('/accounting')
    await expect(accountMiddleware(target.event)).resolves.toBeUndefined()
    expect(target.status()).toBe(200)
  })

  it('redirects anonymous account requests before SSR rendering', async () => {
    const target = request('/account/security?linked=google')
    await accountMiddleware(target.event)
    expect(target.status()).toBe(302)
    expect(target.location()).toBe('/login?callbackUrl=%2Faccount%2Fsecurity%3Flinked%3Dgoogle')
  })

  it('allows active member sessions to manage their sign-in methods', async () => {
    authState.session = { user: { id: 'member-1', role: 'user', accountType: 'member' } }
    const target = request('/account/security')
    await expect(accountMiddleware(target.event)).resolves.toBeUndefined()
    expect(target.status()).toBe(200)
  })
})
