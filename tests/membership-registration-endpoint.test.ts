import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentialsEnabled: true,
  consumeRateLimit: vi.fn(async () => {}),
  getDb: vi.fn(async () => ({ kind: 'db' })),
  readBody: vi.fn(async () => ({ email: 'member@example.com', password: 'secure password 123' })),
  register: vi.fn(async () => ({ id: 'member-1', email: 'member@example.com', status: 'active', role: 'user' })),
  rateLimitKeys: vi.fn(async () => ['ip-key', 'email-key'])
}))

vi.mock('../server/db/db', () => ({ getDb: mocks.getDb }))
vi.mock('../server/utils/oauth', () => ({
  resolveCredentialsEnabled: vi.fn(async () => mocks.credentialsEnabled)
}))
vi.mock('../server/utils/member-registration', () => ({
  consumeRegistrationRateLimit: mocks.consumeRateLimit,
  getRegistrationRequestIp: vi.fn(() => '127.0.0.1'),
  registerPasswordMember: mocks.register,
  registrationInputSchema: {
    safeParse: vi.fn((value: unknown) => ({ success: true, data: value }))
  },
  registrationRateLimitKeys: mocks.rateLimitKeys,
  RegistrationError: class RegistrationError extends Error {}
}))
vi.mock('h3', async (importOriginal) => ({
  ...await importOriginal<typeof import('h3')>(),
  readBody: mocks.readBody
}))
vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)

let handler: (event: any) => Promise<any>
const event = {
  context: {},
  node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } }
} as any

beforeAll(async () => {
  handler = (await import('../server/api/membership/register.post')).default
})

beforeEach(() => {
  mocks.credentialsEnabled = true
  vi.clearAllMocks()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('password membership registration endpoint', () => {
  it('rejects registration before creating an inaccessible account when credentials are disabled', async () => {
    mocks.credentialsEnabled = false
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Password registration is not available'
    })
    expect(mocks.readBody).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('retains the normal rate-limited registration path when credentials are enabled', async () => {
    await expect(handler(event)).resolves.toMatchObject({ id: 'member-1', status: 'active' })
    expect(mocks.consumeRateLimit).toHaveBeenCalledOnce()
    expect(mocks.register).toHaveBeenCalledOnce()
  })
})
