import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useHalopressContent } from '../app/composables/useHalopressContent'

describe('useHalopressContent schema version', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the schema bundled with the authoritative content revision', async () => {
    const requests: Array<{ url: string; query: Record<string, unknown> }> = []
    vi.stubGlobal('useFetch', vi.fn(async (url: () => string, options: any) => {
      requests.push({ url: url(), query: options.query.value })
      return {
        data: ref({
          id: 'article-1',
          schemaKey: 'article',
          schemaVersion: 1,
          title: 'Legacy article',
          status: 'published',
          content: { legacyBody: 'Still public' },
          schema: {
            schemaKey: 'article',
            version: 1,
            jsonSchema: {
              type: 'object',
              properties: { legacyBody: { type: 'string' } },
              required: ['legacyBody'],
              additionalProperties: false
            },
            registry: {
              fields: [{ fieldId: 'legacy-body', key: 'legacyBody', kind: 'string' }],
              relations: []
            }
          },
          surroundings: { prev: null, next: null }
        }),
        refresh: vi.fn(),
        pending: ref(false),
        error: ref(null)
      }
    }))

    const result = await useHalopressContent('article', { id: 'article-1' })

    expect(requests).toEqual([{
      url: '/api/content/article/article-1',
      query: {
        order: undefined,
        status: undefined,
        surroundings: '1',
        includeSchema: '1'
      }
    }])
    expect(result.schema.value).toMatchObject({ version: 1 })
    expect(result.content.value).toMatchObject({
      schemaVersion: 1,
      content: { legacyBody: 'Still public' },
      extra: { legacyBody: 'Still public' }
    })
    expect(result.content.value).not.toHaveProperty('schema')
  })
})
