import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  createPortablePageRendering,
  PORTABLE_CONTENT_STYLESHEET_PATH,
  PORTABLE_CONTENT_STYLESHEET_REVISION
} from '../shared/portable-content'
import { createStrongEtag } from '../server/utils/portable-content-delivery'
import { createStandalonePageRendering } from '../server/utils/standalone-document-renderer'
import {
  STANDALONE_DOCUMENT_STYLESHEET_PATH,
  STANDALONE_DOCUMENT_STYLESHEET_REVISION
} from '../shared/standalone-document'
import { portableContentFixture } from './fixtures/portable-content'

type Handler = (event: any) => unknown | Promise<unknown>

vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
vi.stubGlobal('useStorage', () => ({
  getItem: () => readFile(resolve(import.meta.dirname, '../server/assets/portable-content-v1.css'), 'utf8')
}))

function requestEvent(headers: Record<string, string> = {}) {
  const responseHeaders = new Map<string, unknown>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      responseHeaders.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    }
  }
  return {
    event: {
      context: {},
      node: { req: { headers }, res: response }
    },
    header: (name: string) => responseHeaders.get(name.toLowerCase()),
    status: () => response.statusCode
  }
}

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('portable content v1 stylesheet', () => {
  it('serves content-addressed CSS with cross-origin, immutable, nosniff, and content-derived ETag headers', async () => {
    const handler = (await import('../server/routes/_halo/content/v1/dfea71d319d9c7d0a48d19346c115d3bd32a51e0b88f30e4c344cb454b9ea3f1.css.get')).default as Handler
    const request = requestEvent()
    const stylesheet = await handler(request.event)

    expect(stylesheet).toEqual(expect.any(String))
    expect(request.header('content-type')).toBe('text/css; charset=utf-8')
    expect(request.header('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(request.header('access-control-allow-origin')).toBe('*')
    expect(request.header('cross-origin-resource-policy')).toBe('cross-origin')
    expect(request.header('x-content-type-options')).toBe('nosniff')
    expect(request.header('etag')).toBe(createStrongEtag(stylesheet as string))
    expect(request.header('vary')).toBeUndefined()
  })

  it('returns 304 for a matching strong validator and changes identity with content', async () => {
    const handler = (await import('../server/routes/_halo/content/v1/dfea71d319d9c7d0a48d19346c115d3bd32a51e0b88f30e4c344cb454b9ea3f1.css.get')).default as Handler
    const initial = requestEvent()
    const stylesheet = await handler(initial.event) as string
    const etag = String(initial.header('etag'))
    const conditional = requestEvent({ 'if-none-match': etag })

    expect(await handler(conditional.event)).toBeUndefined()
    expect(conditional.status()).toBe(304)
    expect(conditional.header('etag')).toBe(etag)
    expect(createStrongEtag(`${stylesheet}\n.changed`)).not.toBe(etag)
  })

  it('contains deterministic light/dark tokens, responsive behavior, focus, reduced-motion, and print rules', async () => {
    const root = resolve(import.meta.dirname, '..')
    const stylesheet = await readFile(resolve(root, 'server/assets/portable-content-v1.css'), 'utf8')

    expect(stylesheet).toContain('.halo-content {')
    expect(stylesheet).toContain('.halo-content[data-halo-color-mode="dark"]')
    expect(stylesheet).toContain('@media (min-width: 52rem)')
    expect(stylesheet).toContain(':focus-visible')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesheet).toContain('@media print')
    expect(stylesheet).not.toMatch(/@tailwind|@apply|@nuxt\/ui|--ui-/i)
  })

  it('changes the immutable URL whenever stylesheet bytes change and styles every authored color and variant', async () => {
    const root = resolve(import.meta.dirname, '..')
    const stylesheet = await readFile(resolve(root, 'server/assets/portable-content-v1.css'), 'utf8')
    const digest = createHash('sha256').update(stylesheet).digest('hex')

    expect(PORTABLE_CONTENT_STYLESHEET_REVISION).toBe(digest)
    expect(PORTABLE_CONTENT_STYLESHEET_PATH).toBe(`/_halo/content/v1/${digest}.css`)
    expect(createHash('sha256').update(`${stylesheet}\nchanged`).digest('hex')).not.toBe(digest)
    for (const color of ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']) {
      expect(stylesheet).toContain(`[data-halo-color="${color}"]`)
      expect(stylesheet).toContain(`[data-halo-highlight-color="${color}"]`)
      expect(stylesheet).toContain(`[data-halo-spotlight-color="${color}"]`)
    }
    for (const variant of ['solid', 'outline', 'soft', 'subtle', 'ghost', 'naked']) {
      expect(stylesheet).toContain(`.halo-action[data-halo-variant="${variant}"]`)
      expect(stylesheet).toContain(`.halo-card[data-halo-variant="${variant}"]`)
      expect(stylesheet).toContain(`.halo-cta[data-halo-variant="${variant}"]`)
    }
  })

  it('statically guards the portable dependency boundary and generated output', async () => {
    const root = resolve(import.meta.dirname, '..')
    const portableFiles = [
      'shared/portable-content.ts',
      'shared/site-theme.ts',
      'shared/page-blocks.ts',
      'server/utils/portable-content-delivery.ts',
      'server/utils/site-theme-settings.ts',
      'server/api/delivery/site-theme.get.ts',
      'server/routes/_halo/theme/v1/[revision].css.get.ts',
      `server/routes${PORTABLE_CONTENT_STYLESHEET_PATH}.get.ts`,
      'server/assets/portable-content-v1.css',
      'app/components/PageDocumentRenderer.vue',
      'examples/portable-content/index.html'
    ]
    const sources = (await Promise.all(portableFiles.map(file => readFile(resolve(root, file), 'utf8')))).join('\n')
    const standaloneExample = await readFile(resolve(root, 'examples/portable-content/index.html'), 'utf8')
    const output = createPortablePageRendering(portableContentFixture, {
      origin: 'https://press.example.com'
    }).html

    for (const forbidden of [
      'app/layouts/',
      'desk.vue',
      'SiteWorkspaceShell',
      '@nuxt/ui',
      'UPage',
      '__nuxt',
      '@tailwind',
      '@apply'
    ]) {
      expect(sources, forbidden).not.toContain(forbidden)
      expect(output, forbidden).not.toContain(forbidden)
    }
    expect(output).not.toMatch(/class="(?:fixed|absolute|relative|grid|flex|[mp][trblxy]?-[0-9]|(?:sm|md|lg|xl):)/)
    expect(standaloneExample).toContain('data-halopress-origin="https://site.example"')
    expect(standaloneExample).not.toContain('searchParams')
    expect(standaloneExample).not.toContain('endpoint.value')
  })
})

describe('standalone document v2 stylesheet', () => {
  it('serves the pinned transparent v2 artifact without changing the retained v1 route', async () => {
    const root = resolve(import.meta.dirname, '..')
    vi.stubGlobal('useStorage', () => ({
      getItem: () => readFile(resolve(root, 'server/assets/standalone-document-v2.css'), 'utf8')
    }))
    const handler = (await import('../server/routes/_halo/content/v2/6d010ca6e3a8523dfa95f6173f8896c6347663a32f85d498273dfa831bfd3fa6.css.get')).default as Handler
    const request = requestEvent()
    const stylesheet = await handler(request.event) as string
    const digest = createHash('sha256').update(stylesheet).digest('hex')

    expect(STANDALONE_DOCUMENT_STYLESHEET_REVISION).toBe(digest)
    expect(STANDALONE_DOCUMENT_STYLESHEET_PATH).toBe(`/_halo/content/v2/${digest}.css`)
    expect(request.header('content-type')).toBe('text/css; charset=utf-8')
    expect(request.header('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(request.header('etag')).toBe(createStrongEtag(stylesheet))
  })

  it('leaves the document root, ordinary text, and color mode to the consumer', async () => {
    const stylesheet = await readFile(resolve(import.meta.dirname, '../server/assets/standalone-document-v2.css'), 'utf8')
    const rootRule = stylesheet.match(/\.halo-content \{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(rootRule).not.toMatch(/^\s*(?:color|background|font(?:-family|-size|-style|-weight)?|line-height|width|max-width|margin|padding)\s*:/m)
    expect(stylesheet).not.toContain('color-scheme')
    expect(stylesheet).not.toContain('data-halo-color-mode')
    expect(stylesheet).not.toMatch(/\.halo-content :where\(h1, h2, h3, h4\)[^{]*\{[^}]*color:/s)
    expect(stylesheet).not.toMatch(/\.halo-content \.halo-list\s*\{[^}]*color:/s)
    expect(stylesheet).not.toMatch(/@tailwind|@apply|@nuxt\/ui|--ui-/i)
  })

  it('inherits computed foreground and background for ordinary content and structural heroes', async () => {
    const stylesheet = await readFile(resolve(import.meta.dirname, '../server/assets/standalone-document-v2.css'), 'utf8')
    const window = new Window()
    const style = window.document.createElement('style')
    style.textContent = stylesheet
    window.document.head.append(style)
    window.document.body.innerHTML = `<main style="color: rgb(12, 34, 56); background: rgb(240, 241, 242)">
      <article class="halo-content">
        <h2 id="ordinary">Inherited heading</h2>
        <section id="structural" class="halo-block halo-hero" data-halo-block="hero" data-halo-orientation="vertical">
          <div class="halo-block-content"><h1>Hero heading</h1><p>Hero copy</p></div>
        </section>
        <section id="legacy" class="halo-block halo-hero" data-halo-block="hero" data-halo-legacy-block="true" data-halo-orientation="vertical">
          <div class="halo-block-content"><header class="halo-block-header"><h1>Legacy hero</h1></header></div>
        </section>
      </article>
    </main>`

    const transparentValues = ['', 'transparent', 'rgba(0, 0, 0, 0)']
    expect(window.getComputedStyle(window.document.querySelector('.halo-content')!).color).toBe('rgb(12, 34, 56)')
    expect(transparentValues).toContain(window.getComputedStyle(window.document.querySelector('.halo-content')!).backgroundColor)
    expect(window.getComputedStyle(window.document.querySelector('#ordinary')!).color).toBe('rgb(12, 34, 56)')
    expect(['rgb(12, 34, 56)', 'inherit']).toContain(
      window.getComputedStyle(window.document.querySelector('#structural')!).color
    )
    expect(transparentValues).toContain(window.getComputedStyle(window.document.querySelector('#structural')!).backgroundColor)
    expect(stylesheet).toMatch(/\.halo-content \.halo-hero \{[\s\S]*?radial-gradient/)
    expect(stylesheet).toContain('.halo-content .halo-hero:not([data-halo-legacy-block="true"])')
    window.close()
  })

  it('generates deterministic v2 fragments without Theme or color-mode inputs', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Inherited heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Inherited body' }] }
      ]
    }
    const first = createStandalonePageRendering(document, { origin: 'https://press.example.com' })
    const second = createStandalonePageRendering(structuredClone(document), { origin: 'https://press.example.com' })

    expect(second).toEqual(first)
    expect(first.contractVersion).toBe(2)
    expect(first.stylesheets).toEqual([`https://press.example.com${STANDALONE_DOCUMENT_STYLESHEET_PATH}`])
    expect(first.html).toContain('data-halo-contract-version="2"')
    expect(first.html).not.toContain('data-halo-color-mode')
    expect(first).not.toHaveProperty('themeRevision')
    expect(first).not.toHaveProperty('themeColorMode')
  })
})
