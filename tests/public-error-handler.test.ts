import { beforeEach, describe, expect, it, vi } from 'vitest'

const h3 = vi.hoisted(() => ({
  send: vi.fn((event: any, body: string) => {
    event.sentBody = body
    return body
  }),
  setResponseHeaders: vi.fn((event: any, headers: Record<string, string>) => {
    event.responseHeaders = headers
  }),
  setResponseStatus: vi.fn((event: any, statusCode: number, statusMessage: string) => {
    event.responseStatus = { statusCode, statusMessage }
  })
}))

vi.mock('h3', () => ({
  getRequestHeader: (event: any, name: string) => event.requestHeaders?.[name.toLowerCase()],
  send: h3.send,
  setResponseHeaders: h3.setResponseHeaders,
  setResponseStatus: h3.setResponseStatus
}))
vi.mock('nitropack/runtime', () => ({ defineNitroErrorHandler: (handler: unknown) => handler }))

const handler = (await import('../server/error-handler')).default

function eventFor(accept: string, marked = true) {
  return {
    path: '/private-draft',
    context: marked ? { publicDeliveryPrivateNoindex: true } : {},
    requestHeaders: { accept }
  } as any
}

beforeEach(() => vi.clearAllMocks())

describe('public delivery error handler', () => {
  it('leaves unrelated errors to the default Nitro handler', () => {
    const event = eventFor('application/json', false)
    expect(handler({ statusCode: 404 } as any, event, {} as any)).toBeUndefined()
    expect(h3.send).not.toHaveBeenCalled()
    expect(h3.setResponseHeaders).not.toHaveBeenCalled()
  })

  it('returns a private noindex JSON 404 for marked API-style requests', () => {
    const event = eventFor('application/json')
    const body = handler({ statusCode: 404 } as any, event, {} as any)

    expect(JSON.parse(String(body))).toMatchObject({
      error: true,
      url: '/private-draft',
      statusCode: 404,
      statusMessage: 'Not Found'
    })
    expect(event.responseStatus).toEqual({ statusCode: 404, statusMessage: 'Not Found' })
    expect(event.responseHeaders).toMatchObject({
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Type': 'application/json'
    })
  })

  it('returns an explicitly non-cacheable public resource miss with safe CORS', () => {
    const event = eventFor('application/json', false)
    event.context.portablePublicResourceNoStore = true
    event.path = `/_halo/theme/v1/${'f'.repeat(64)}.css`
    const body = handler({ statusCode: 404 } as any, event, {} as any)

    expect(JSON.parse(String(body))).toMatchObject({
      statusCode: 404,
      statusMessage: 'Theme stylesheet not found'
    })
    expect(event.responseHeaders).toMatchObject({
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff'
    })
  })

  it('returns a private noindex HTML 404 for marked browser requests', () => {
    const event = eventFor('text/html,application/xhtml+xml')
    const body = String(handler({ statusCode: 404 } as any, event, {} as any))

    expect(body).toContain('<title>404 Not Found</title>')
    expect(body).toContain('<meta name="robots" content="noindex, nofollow, noarchive">')
    expect(event.responseHeaders).toMatchObject({
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Type': 'text/html; charset=utf-8'
    })
  })
})
