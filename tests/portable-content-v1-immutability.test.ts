import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  createPortablePageRendering,
  createPortableStructuredContentRendering
} from '../shared/portable-content'
import { portableContentFixture } from './fixtures/portable-content'

const origin = 'https://press.example'

function digest(value: unknown) {
  const bytes = JSON.stringify(value)
  return `${createHash('sha256').update(bytes).digest('hex')}:${bytes.length}`
}

describe('portable content v1 immutability', () => {
  it('matches origin/main bytes and outlines for representative and legacy boundaries', () => {
    const cases = {
      representative: createPortablePageRendering(portableContentFixture, { origin }),
      malformed: createPortablePageRendering({
        type: 'doc',
        content: [
          null,
          { type: 'heading', attrs: { level: 9, id: 'stored' }, content: [{ type: 'text', text: 'Repeated' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Repeated' }] },
          { type: 'image', attrs: { src: 'javascript:alert(1)' } },
          { type: 'pageBlock', attrs: { component: 'RetiredBlock', props: {} } }
        ]
      }, { origin }),
      legacy: createPortablePageRendering({
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: {
              title: 'Legacy',
              description: 'Description',
              links: [
                { label: 'Open', to: '/safe', icon: 'i-lucide-arrow-right' },
                { label: 'Bad', to: 'javascript:alert(1)' }
              ]
            },
            advanced: {},
            media: { url: '/asset/raw', alt: 'Hero' }
          }
        }]
      }, { origin }),
      structuralV1: createPortablePageRendering({
        type: 'doc',
        content: [{
          type: 'pageHero',
          attrs: { orientation: 'horizontal', reverse: true },
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Structural' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Copy' }] }
          ]
        }]
      }, { origin }),
      reviewBoundaries: createPortablePageRendering({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'https://tracker.example/pixel.png' } },
          { type: 'image', attrs: { src: '/api/private/image' } },
          { type: 'image', attrs: { src: '/assets/site-image/raw' } },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bare' }] }]
          },
          {
            type: 'blockquote',
            content: [{
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested bare' }] }]
            }]
          },
          {
            type: 'pageBlock',
            attrs: {
              component: 'pageHero',
              props: { title: 'Tracked block' },
              media: { url: 'https://tracker.example/block.png', alt: 'Tracker' }
            }
          },
          {
            type: 'pageBlock',
            attrs: {
              component: 'pageLogos',
              props: { title: 'Logos', items: [{ name: 'Private', src: '/api/private/logo' }] },
              media: {}
            }
          }
        ]
      }, { origin }),
      budget: createPortablePageRendering({
        type: 'doc',
        content: Array.from({ length: 8 }, () => ({
          type: 'paragraph',
          content: [{ type: 'text', text: 'bounded' }]
        }))
      }, { origin, limits: { maxNodes: 5 } }),
      structured: createPortableStructuredContentRendering({
        body: {
          type: 'doc',
          content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Body' }] }]
        },
        other: 'raw'
      }, [
        { fieldId: 'field-body', key: 'body', kind: 'richtext' },
        { fieldId: 'field-other', key: 'other', kind: 'text' }
      ], { origin })
    }

    expect(Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, digest(value)]))).toEqual({
      representative: '6c13628cb5980b291e0ea454174d09ed3f3a279ad32641d932df1ac4fd8b25ee:9108',
      malformed: '36ebcfd26f0f2c14b69866dff0ecabaf1b3bea2745c8d744a3452b4b09b051e9:887',
      legacy: 'c26c9ca1a2ad7dd93e56b53937b5c40feaf5b24f0e3b840c174ac26522192378:496',
      structuralV1: '30cdc342337f85d766ffbb30e6f557655dda70b4ff8e1cccb9a773e376541bb6:441',
      reviewBoundaries: '95fa232f55ef2e43028764d7910b5f8d6e486f43efa3c3e17267c8600ba469a4:1734',
      budget: '9eab5aabe0ea978f9137823874551988a0b4a08b0b1f006377042270dddf0dfe:463',
      structured: 'cd5f4bc46eb4d3b634656aebb194e450681a0ddf05224b5c4d6e1ce5fbcf37f7:653'
    })
  })
})
