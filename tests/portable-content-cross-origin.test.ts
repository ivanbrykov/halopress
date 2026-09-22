import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createPortablePageRendering,
  createPortableStandaloneDocument,
  PORTABLE_CONTENT_STYLESHEET_PATH,
  PORTABLE_CONTENT_STYLESHEET_REVISION
} from '../shared/portable-content'
import {
  applyPortableMutableAssetHeaders,
  applyPortablePublicEnvelopeHeaders,
  applyPortableStylesheetHeaders
} from '../server/utils/portable-content-delivery'
import { portableContentFixture } from './fixtures/portable-content'

async function listen(server: Server) {
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server) {
  if (!server.listening) return
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
}

function fail(response: ServerResponse, error: unknown) {
  response.statusCode = 500
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(error instanceof Error ? error.message : 'Unexpected integration error')
}

describe('portable content two-origin network contract', () => {
  it('delivers the envelope, content-addressed CSS, and revalidated assets to a standalone consumer origin', async () => {
    const stylesheet = await readFile(resolve(import.meta.dirname, '../server/assets/portable-content-v1.css'), 'utf8')
    const assetBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')
    const assetContentType = 'image/svg+xml'
    let haloOrigin = ''

    const haloServer = createServer((request, response) => {
      try {
        const url = new URL(request.url || '/', haloOrigin)
        const event = { context: {}, node: { req: request, res: response } } as any

        if (url.pathname === '/api/delivery/page/portable') {
          const rendering = createPortablePageRendering(portableContentFixture, { origin: haloOrigin })
          const envelope = { id: 'portable', content: portableContentFixture, rendering }
          response.setHeader('content-type', 'application/json; charset=utf-8')
          if (applyPortablePublicEnvelopeHeaders(event, envelope)) {
            response.end()
            return
          }
          response.end(JSON.stringify(envelope))
          return
        }

        if (url.pathname === PORTABLE_CONTENT_STYLESHEET_PATH) {
          if (applyPortableStylesheetHeaders(event, stylesheet)) {
            response.end()
            return
          }
          response.end(stylesheet)
          return
        }

        if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('/raw')) {
          response.setHeader('content-type', assetContentType)
          if (applyPortableMutableAssetHeaders(event, `fixture:${url.pathname}`, assetContentType)) {
            response.end()
            return
          }
          response.end(assetBytes)
          return
        }

        response.statusCode = 404
        response.end('Not found')
      } catch (error) {
        fail(response, error)
      }
    })

    let consumerOrigin = ''
    const consumerServer = createServer((_, response) => {
      void (async () => {
        const envelopeResponse = await fetch(`${haloOrigin}/api/delivery/page/portable`)
        const envelope = await envelopeResponse.json() as {
          rendering: ReturnType<typeof createPortablePageRendering>
        }
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(createPortableStandaloneDocument(envelope.rendering, { title: 'Two-origin fixture' }))
      })().catch(error => fail(response, error))
    })

    try {
      haloOrigin = await listen(haloServer)
      consumerOrigin = await listen(consumerServer)
      expect(new URL(haloOrigin).origin).not.toBe(new URL(consumerOrigin).origin)

      const envelopeUrl = `${haloOrigin}/api/delivery/page/portable`
      const envelopeResponse = await fetch(envelopeUrl, { headers: { origin: consumerOrigin } })
      expect(envelopeResponse.status).toBe(200)
      expect(envelopeResponse.headers.get('access-control-allow-origin')).toBe('*')
      expect(envelopeResponse.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(envelopeResponse.headers.get('x-content-type-options')).toBe('nosniff')
      const envelopeEtag = envelopeResponse.headers.get('etag')
      expect(envelopeEtag).toMatch(/^"sha256-/)
      const envelope = await envelopeResponse.json() as {
        rendering: ReturnType<typeof createPortablePageRendering>
      }
      expect(envelope.rendering.stylesheets).toEqual([`${haloOrigin}${PORTABLE_CONTENT_STYLESHEET_PATH}`])

      const envelopeConditional = await fetch(envelopeUrl, {
        headers: { origin: consumerOrigin, 'if-none-match': envelopeEtag! }
      })
      expect(envelopeConditional.status).toBe(304)

      const consumerResponse = await fetch(consumerOrigin)
      const standalone = await consumerResponse.text()
      expect(consumerResponse.status).toBe(200)
      expect(standalone).toContain('<title>Two-origin fixture</title>')
      expect(standalone.match(/data-halo-block=/g)).toHaveLength(7)
      expect(standalone).not.toMatch(/<script\b|@nuxt\/ui|__nuxt|SiteWorkspaceShell|tailwind/i)

      const stylesheetUrl = standalone.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1]
      expect(stylesheetUrl).toBe(`${haloOrigin}${PORTABLE_CONTENT_STYLESHEET_PATH}`)
      expect(new URL(stylesheetUrl!).origin).not.toBe(new URL(consumerOrigin).origin)
      const stylesheetResponse = await fetch(stylesheetUrl!, { headers: { origin: consumerOrigin } })
      const stylesheetEtag = stylesheetResponse.headers.get('etag')
      const stylesheetBody = await stylesheetResponse.text()
      expect(stylesheetResponse.status).toBe(200)
      expect(stylesheetResponse.headers.get('access-control-allow-origin')).toBe('*')
      expect(stylesheetResponse.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(stylesheetResponse.headers.get('x-content-type-options')).toBe('nosniff')
      expect(stylesheetResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(createHash('sha256').update(stylesheetBody).digest('hex')).toBe(PORTABLE_CONTENT_STYLESHEET_REVISION)
      const stylesheetConditional = await fetch(stylesheetUrl!, {
        headers: { origin: consumerOrigin, 'if-none-match': stylesheetEtag! }
      })
      expect(stylesheetConditional.status).toBe(304)

      const assetUrls = [...standalone.matchAll(/\bsrc="(http:[^"]+\/assets\/[^"]+\/raw(?:\?[^"#]*)?(?:#[^"]*)?)"/g)]
        .map(match => match[1]!)
      expect(assetUrls.length).toBeGreaterThanOrEqual(6)
      expect(assetUrls.every(assetUrl => new URL(assetUrl).origin === haloOrigin)).toBe(true)
      const assetResponse = await fetch(assetUrls[0]!, { headers: { origin: consumerOrigin } })
      const assetEtag = assetResponse.headers.get('etag')
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('access-control-allow-origin')).toBe('*')
      expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff')
      expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
      expect(assetEtag).toMatch(/^"sha256-/)
      expect(await assetResponse.text()).toBe(assetBytes.toString())
      const assetConditional = await fetch(assetUrls[0]!, {
        headers: { origin: consumerOrigin, 'if-none-match': assetEtag! }
      })
      expect(assetConditional.status).toBe(304)
    } finally {
      await Promise.all([close(consumerServer), close(haloServer)])
    }
  })
})
