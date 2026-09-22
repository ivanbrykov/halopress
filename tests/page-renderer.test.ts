import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { h, reactive } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'

import SiteTextNode from '../app/components/site-document/SiteTextNode'
import { clonePageBlockAttrs } from '../app/editor/page/inspector-state'
import { commitPageBlockLink, createPageBlockLinkDrafts, movePageBlockLink } from '../app/editor/page/links'
import { pageBlockRegistry } from '../app/editor/page/registry'
import { normalizePageContent } from '../server/cms/page-content'
import {
  AUTHORED_DOCUMENT_MAX_TEXT_LENGTH,
  normalizeAuthoredDocument
} from '../shared/authored-document'
import { resolvePageBlock } from '../shared/page-blocks'

describe('page block registry', () => {
  it('exposes typed link controls for reviewed action-bearing blocks', () => {
    expect(pageBlockRegistry.byKey.pageHero.fields.some(field => field.type === 'link-list')).toBe(true)
    expect(pageBlockRegistry.byKey.pageSection.fields.some(field => field.type === 'link-list')).toBe(true)
    expect(pageBlockRegistry.byKey.pageCTA.fields.some(field => field.type === 'link-list')).toBe(true)
    expect(pageBlockRegistry.byKey.pageCard.fields.some(field => field.type === 'link-list')).toBe(false)
  })

  it('commits safe link drafts while preserving curated optional properties', () => {
    const [draft] = createPageBlockLinkDrafts([{
      label: 'Old',
      to: '/old',
      target: '_blank',
      icon: 'i-lucide-arrow-right',
      color: 'primary',
      unchecked: 'drop me'
    }])
    draft!.label = 'Docs'
    draft!.to = '/docs'
    draft!.target = '_self'

    expect(commitPageBlockLink([draft!.original], 0, draft!)).toEqual({
      links: [{
        label: 'Docs',
        to: '/docs',
        icon: 'i-lucide-arrow-right',
        color: 'primary'
      }]
    })
    expect(commitPageBlockLink([], 0, {
      label: 'Unsafe',
      to: 'javascript:alert(1)',
      target: '_self',
      original: {}
    })).toHaveProperty('error')
  })

  it('moves link drafts without revalidating or discarding incomplete input', () => {
    const drafts = createPageBlockLinkDrafts([
      { label: 'First', to: '/first' },
      { label: 'Second', to: '/second' }
    ])
    drafts[0]!.to = 'javascript:in-progress'

    const moved = movePageBlockLink(drafts, [
      { label: 'First', to: '/first' },
      { label: 'Second', to: '/second' }
    ], 0, 1)

    expect(moved?.drafts.map(draft => draft.to)).toEqual(['/second', 'javascript:in-progress'])
    expect(moved?.links).toEqual([
      { label: 'Second', to: '/second' },
      { label: 'First', to: '/first' }
    ])
  })

  it('clones reactive inspector state into a detached plain snapshot', () => {
    const editing = reactive({
      component: 'pageCard',
      props: { title: 'Reactive title', links: [{ label: 'Docs', to: '/docs' }] },
      advanced: { spacing: 'wide' },
      media: { url: '/assets/example/raw', alt: 'Example' }
    })

    const snapshot = clonePageBlockAttrs(editing)

    expect(snapshot).toEqual({
      component: 'pageCard',
      props: { title: 'Reactive title', links: [{ label: 'Docs', to: '/docs' }] },
      advanced: { spacing: 'wide' },
      media: { url: '/assets/example/raw', alt: 'Example' }
    })
    expect(snapshot.props).not.toBe(editing.props)
    expect(snapshot.media).not.toBe(editing.media)
  })

  it('updates inspector attributes without forcing editor focus or cached node positions', async () => {
    const root = resolve(import.meta.dirname, '..')
    const editor = await readFile(resolve(root, 'app/components/PageEditor.vue'), 'utf8')
    const inspector = await readFile(resolve(root, 'app/components/page-editor/PageBlockInspector.vue'), 'utf8')

    expect(inspector).toContain('@update:model-value="updateLink(index, \'label\', $event)"')
    expect(inspector).toContain('@update:model-value="updateLink(index, \'to\', $event)"')
    expect(inspector).toContain('if (samePageBlockAttrs(attrs)) return')
    expect(inspector).toContain('watch(editing, queueCommit, { deep: true, flush: \'sync\' })')
    expect(inspector).not.toContain('setTimeout')
    expect(editor).toContain('editor.commands.updatePageBlockAttributes(attrs)')
    expect(editor).not.toContain('.focus()')
    expect(editor).not.toContain('selectedBlock.value.pos')
  })

  it('resolves only code-owned components and strips unchecked properties', () => {
    const resolved = resolvePageBlock({
      component: 'pageCard',
      props: {
        title: 'Safe card',
        to: '/articles/1',
        target: '_blank',
        ui: { root: 'fixed inset-0' },
        class: 'fixed inset-0',
        onClick: 'alert(1)'
      },
      advanced: { is: 'script', onClick: 'alert(1)' },
      media: { url: '/assets/card/raw', alt: 'Card', class: 'fixed inset-0' }
    })

    expect(resolved).toEqual({
      status: 'known',
      key: 'pageCard',
      props: {
        title: 'Safe card',
        description: '',
        to: '/articles/1',
        target: '_blank'
      },
      media: { url: '/assets/card/raw', alt: 'Card' }
    })
  })

  it('uses deterministic fallbacks for unknown and malformed blocks', () => {
    expect(resolvePageBlock({ component: 'RetiredMarketingWidget', props: {} })).toEqual({
      status: 'unknown',
      key: 'RetiredMarketingWidget',
      reason: 'Unsupported page block'
    })
    expect(resolvePageBlock({
      component: 'pageCard',
      props: { title: 'Unsafe', to: 'javascript:alert(1)' }
    })).toEqual({
      status: 'malformed',
      key: 'pageCard',
      reason: 'Invalid page block properties'
    })
  })

  it('resolves reviewed composite blocks and strips unchecked nested properties', () => {
    expect(resolvePageBlock({
      component: 'pageFAQ',
      props: {
        title: 'Questions',
        items: [{ question: 'Is it safe?', answer: 'Yes.', class: 'fixed' }],
        onClick: 'alert(1)'
      },
      media: {}
    })).toEqual({
      status: 'known',
      key: 'pageFAQ',
      props: {
        title: 'Questions',
        items: [{ question: 'Is it safe?', answer: 'Yes.' }]
      },
      media: {}
    })
  })
})

describe('page document renderer', () => {
  const fixture = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, class: 'unchecked' },
        content: [{ type: 'text', text: 'Ordinary heading', marks: [{ type: 'bold' }] }]
      },
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Unsafe link becomes plain text',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', class: 'unchecked' } }]
        }]
      },
      {
        type: 'pageBlock',
        attrs: { component: 'pageHero', props: { title: 'Hero' }, advanced: { class: 'unchecked' } }
      },
      {
        type: 'pageBlock',
        attrs: { component: 'RetiredBlock', props: { preserved: true } }
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'After blocks' }] }
    ]
  }

  it('normalizes ordinary Tiptap nodes and Page blocks without mutating canonical JSON', () => {
    const before = JSON.stringify(fixture)
    const first = normalizeAuthoredDocument(fixture, { allowPageBlocks: true, allowPageHero: true })
    const second = normalizeAuthoredDocument(fixture, { allowPageBlocks: true, allowPageHero: true })

    expect(first).toEqual(second)
    expect(first.content.map(node => node.type)).toEqual(['heading', 'paragraph', 'pageBlock', 'pageBlock', 'paragraph'])
    expect(first.content[0]).toMatchObject({
      type: 'heading',
      id: 'halo-heading-ordinary-heading',
      content: [{ type: 'text', text: 'Ordinary heading', marks: [{ type: 'bold' }] }]
    })
    expect(first.content[1]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', marks: [] }]
    })
    expect(first.content[3]).toMatchObject({
      type: 'pageBlock',
      attrs: { component: 'RetiredBlock', props: { preserved: true } }
    })
    expect(JSON.stringify(first)).not.toContain('javascript:')
    expect(JSON.stringify(first)).not.toContain('unchecked')
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('sanitizes arbitrary Tiptap attributes and unsafe media', () => {
    const sanitized = normalizeAuthoredDocument({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'data:text/html;base64,WA==', class: 'fixed' } },
        { type: 'paragraph', attrs: { class: 'fixed', textAlign: 'center' }, content: [{ type: 'text', text: '<safe>' }] }
      ]
    })
    expect(sanitized).toMatchObject({
      type: 'doc',
      content: [
        { type: 'fallback', message: '[Unsupported content: image]' },
        { type: 'paragraph', textAlign: 'center', content: [{ type: 'text', text: '<safe>', marks: [] }] }
      ],
      truncated: false
    })
  })

  it('renders only canonical site-owned assets in native rich text', () => {
    const normalized = normalizeAuthoredDocument({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://tracker.example/pixel.png' } },
        { type: 'image', attrs: { src: 'http://127.0.0.1/private.png' } },
        { type: 'image', attrs: { src: '/api/private/image' } },
        { type: 'image', attrs: { src: '/assets/native-image/raw?revision=2#preview', alt: 'Native image' } }
      ]
    })

    expect(normalized.content).toEqual([
      { type: 'fallback', message: '[Unsupported content: image]' },
      { type: 'fallback', message: '[Unsupported content: image]' },
      { type: 'fallback', message: '[Unsupported content: image]' },
      {
        type: 'image',
        src: '/assets/native-image/raw?revision=2#preview',
        alt: 'Native image'
      }
    ])
  })

  it('filters every non-canonical native Page-block image without mutating raw JSON', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: { title: 'Tracked media' },
            media: { url: 'https://tracker.example/pixel.png', alt: 'Tracker' }
          }
        },
        {
          type: 'pageBlock',
          attrs: {
            component: 'pageLogos',
            props: {
              title: 'Logos',
              items: [
                { name: 'Private', src: '/api/private/logo', alt: 'Private logo' },
                { name: 'Owned', src: '/assets/owned-logo/raw', alt: 'Owned logo' }
              ]
            },
            media: {}
          }
        }
      ]
    }
    const before = structuredClone(document)
    const normalized = normalizeAuthoredDocument(document, { allowPageBlocks: true })

    expect(document).toEqual(before)
    expect(normalized.content[0]).toMatchObject({
      type: 'pageBlock',
      attrs: {
        component: 'pageHero',
        props: { title: 'Tracked media' },
        media: { alt: 'Tracker' }
      }
    })
    expect(normalized.content[1]).toMatchObject({
      type: 'pageBlock',
      attrs: {
        component: 'pageLogos',
        props: {
          items: [
            { name: 'Private', alt: 'Private logo' },
            { name: 'Owned', src: '/assets/owned-logo/raw', alt: 'Owned logo' }
          ]
        }
      }
    })
    expect(JSON.stringify(normalized)).not.toContain('tracker.example')
    expect(JSON.stringify(normalized)).not.toContain('/api/private/logo')
  })

  it('accepts listItem only as a direct child of a list', () => {
    const item = {
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }]
    }
    const normalized = normalizeAuthoredDocument({
      type: 'doc',
      content: [
        item,
        { type: 'blockquote', content: [structuredClone(item)] },
        { type: 'bulletList', content: [structuredClone(item)] }
      ]
    })

    expect(normalized.content[0]).toEqual({
      type: 'fallback',
      message: '[Unsupported content: listItem]'
    })
    expect(normalized.content[1]).toEqual({
      type: 'blockquote',
      content: [{ type: 'fallback', message: '[Unsupported content: listItem]' }]
    })
    expect(normalized.content[2]).toEqual({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item', marks: [] }] }]
      }]
    })
  })

  it('keeps malformed child fallbacks context-valid without traversing hidden subtrees', () => {
    const hiddenChildren = Array.from({ length: 2_100 }, (_, index) => ({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: `Hidden ${index}` }]
    }))
    const normalized = normalizeAuthoredDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before' },
            { type: 'mystery', content: hiddenChildren },
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Nested' }] }
          ]
        },
        {
          type: 'bulletList',
          content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Not a list item' }] }]
        },
        {
          type: 'codeBlock',
          content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Not code text' }] }]
        }
      ]
    })

    expect(normalized.truncated).toBe(false)
    expect(normalized.outline).toEqual([])
    expect(normalized.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Before', marks: [] },
        { type: 'text', text: '[Unsupported content: mystery]', marks: [] },
        { type: 'text', text: '[Unsupported content: heading]', marks: [] }
      ]
    })
    expect(normalized.content[1]).toEqual({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: '[Unsupported content: heading]', marks: [] }]
        }]
      }]
    })
    expect(normalized.content[2]).toEqual({
      type: 'codeBlock',
      content: [{ type: 'text', text: '[Unsupported content: heading]', marks: [] }]
    })
  })

  it('deduplicates adversarial marks before native Vue SSR', async () => {
    const normalized = normalizeAuthoredDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Bounded marks',
          marks: Array.from({ length: 4_096 }, () => ({ type: 'bold' }))
        }]
      }]
    })
    const paragraph = normalized.content[0]
    if (paragraph?.type !== 'paragraph') throw new Error('Expected a normalized paragraph')
    const text = paragraph.content[0]
    if (text?.type !== 'text') throw new Error('Expected normalized text')

    expect(text.marks).toEqual([{ type: 'bold' }])
    await expect(renderToString(h(SiteTextNode, { node: text }))).resolves.toBe('<strong>Bounded marks</strong>')
  })

  it('falls back when one authored text node exceeds the shared rendering ceiling', () => {
    const normalized = normalizeAuthoredDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'x'.repeat(AUTHORED_DOCUMENT_MAX_TEXT_LENGTH + 1) }]
      }]
    })

    expect(normalized).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Content exceeds rendering limits', marks: [] }]
      }],
      outline: [],
      truncated: true
    })
  })

  it('applies the same text ceiling to legacy strings without changing reasonable content', () => {
    expect(normalizeAuthoredDocument('Reasonable legacy content')).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Reasonable legacy content', marks: [] }]
      }],
      outline: [],
      truncated: false
    })

    expect(normalizeAuthoredDocument('x'.repeat(AUTHORED_DOCUMENT_MAX_TEXT_LENGTH + 1))).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Content exceeds rendering limits', marks: [] }]
      }],
      outline: [],
      truncated: true
    })
  })

  it('preserves unknown blocks at storage validation while rejecting non-documents', () => {
    const unknown = {
      type: 'doc',
      content: [{ type: 'pageBlock', attrs: { component: 'RetiredBlock', props: { legacy: true } } }]
    }
    expect(normalizePageContent(unknown)).toEqual(unknown)
    expect(() => normalizePageContent({ type: 'script', content: [] })).toThrow('Page content must be a Tiptap document')
  })

  it('keeps editor-only selection state outside the shared view and public renderer', async () => {
    const root = resolve(import.meta.dirname, '..')
    const view = await readFile(resolve(root, 'app/editor/page/PageBlockView.vue'), 'utf8')
    const nodeView = await readFile(resolve(root, 'app/editor/page/PageBlockNodeView.vue'), 'utf8')
    const renderer = await readFile(resolve(root, 'app/components/PageDocumentRenderer.vue'), 'utf8')

    expect(view).not.toContain('selected')
    expect(view).not.toContain('ring-2')
    expect(nodeView).toContain('props.selected')
    expect(nodeView).toContain('<PageBlockView')
    expect(renderer).toContain('normalizeAuthoredDocument')
    expect(renderer).toContain('data-site-document-renderer')
    expect(renderer).toContain('<SiteDocumentNode')
    expect(renderer).toContain('<PageBlockView')
    expect(renderer).toContain(':id="node.anchorId"')
    expect(renderer).not.toContain('v-html')
    expect(renderer).not.toContain('portable-content')
    expect(renderer).not.toContain('PageBlockNodeView')
    expect(renderer).not.toContain('ring-2')
  })

  it('uses the native renderer for editor preview without a standalone compatibility mode', async () => {
    const root = resolve(import.meta.dirname, '..')
    const renderer = await readFile(resolve(root, 'app/components/PageDocumentRenderer.vue'), 'utf8')
    const editor = await readFile(resolve(root, 'app/components/PageEditor.vue'), 'utf8')

    expect(renderer).not.toContain('isolated')
    expect(renderer).not.toContain('<iframe')
    expect(renderer).not.toContain('srcdoc')
    expect(renderer).not.toContain('v-html')
    expect(editor).toContain('<PageDocumentRenderer')
    expect(editor).not.toMatch(/<PageDocumentRenderer[\s\S]{0,200}\sisolated(?:\s|>)/)
  })

  it('maps rich atomic blocks to code-owned renderers and visible media placeholders', async () => {
    const root = resolve(import.meta.dirname, '..')
    const view = await readFile(resolve(root, 'app/editor/page/PageBlockView.vue'), 'utf8')
    const media = await readFile(resolve(root, 'app/components/page-blocks/PageBlockMedia.vue'), 'utf8')

    expect(view).toContain('resolved.key === \'pageTestimonial\'')
    expect(view).toContain('resolved.key === \'pageLogos\'')
    expect(view).toContain('resolved.key === \'pageFAQ\'')
    expect(media).toContain('data-page-block-media-placeholder')
    expect(media).toContain('Media required')
  })
})
