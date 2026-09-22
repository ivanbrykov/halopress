import { describe, expect, it } from 'vitest'

import { extractDocumentAssetIds } from '../server/cms/asset-refs'
import { getPublicationState, publicationMetadata, publicationRevisionValues } from '../server/cms/publication'

describe('publication state', () => {
  it('distinguishes never-published, published, draft-over-published, unpublished, and deleted', () => {
    expect(getPublicationState({ status: 'draft' })).toBe('never-published')
    expect(getPublicationState({ status: 'published', publishedRevisionId: 'rev-1' })).toBe('published')
    expect(getPublicationState({ status: 'draft', publishedRevisionId: 'rev-1' })).toBe('published-with-draft')
    expect(getPublicationState({ status: 'draft', firstPublishedAt: new Date(1) })).toBe('unpublished')
    expect(getPublicationState({ status: 'deleted', publishedRevisionId: 'rev-1' })).toBe('deleted')
  })

  it('returns minimal state metadata without exposing revision identifiers', () => {
    expect(publicationMetadata({
      status: 'draft',
      publishedRevisionId: 'secret-revision-id',
      publishedAt: new Date('2026-07-13T00:00:00.000Z')
    })).toEqual({
      publicationState: 'published-with-draft',
      hasPublishedRevision: true,
      hasDraftChanges: true,
      publishedAt: new Date('2026-07-13T00:00:00.000Z')
    })
  })

  it('builds immutable revision values from a working snapshot', () => {
    const content = { title: 'Published title' }
    expect(publicationRevisionValues({
      id: 'rev-1',
      documentKind: 'content',
      documentId: 'content-1',
      schemaKey: 'article',
      schemaVersion: 3,
      content,
      createdAt: new Date(1000)
    })).toMatchObject({
      id: 'rev-1',
      documentKind: 'content',
      documentId: 'content-1',
      schemaKey: 'article',
      schemaVersion: 3,
      contentJson: '{"title":"Published title"}'
    })
    expect(content).toEqual({ title: 'Published title' })
  })
})

describe('document asset retention', () => {
  it('finds nested same-origin asset paths deterministically without treating arbitrary URLs as assets', () => {
    expect(extractDocumentAssetIds({
      cover: '/assets/cover-1/raw',
      rich: {
        content: [
          { attrs: { src: '/assets/inline-2/raw?width=1200' } },
          { attrs: { src: 'https://example.com/assets/external/raw' } }
        ]
      },
      repeated: '/assets/cover-1/raw'
    })).toEqual(['cover-1', 'inline-2'])
  })

  it('keeps malformed encoded asset IDs extractable without failing a save', () => {
    expect(extractDocumentAssetIds({
      malformed: '/assets/bad%ZZ/raw',
      truncated: '/assets/%E0%A4%A/raw',
      encoded: '/assets/cover%20image/raw'
    })).toEqual(['%E0%A4%A', 'bad%ZZ', 'cover image'])
  })

  it('tracks only trusted-origin absolute asset URLs', () => {
    expect(extractDocumentAssetIds({
      html: '<img src="https://site.example/assets/hero%20image/raw?width=1200#preview">',
      markdown: '[file](https://site.example:443/assets/document-2/raw)',
      external: 'https://cdn.example/assets/external/raw',
      sibling: 'https://sub.site.example/assets/sibling/raw',
      downgrade: 'http://site.example/assets/insecure/raw',
      protocolRelative: '//site.example/assets/ambiguous/raw'
    }, { trustedOrigin: 'https://SITE.example' })).toEqual(['document-2', 'hero image'])
  })
})
