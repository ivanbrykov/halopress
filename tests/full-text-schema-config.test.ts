import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { syncSearchConfig } from '../server/cms/search-config'
import type { SchemaRegistry } from '../server/cms/types'
import { schemaAstSchema } from '../server/cms/zod'
import { searchConfig } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

function registry(fieldKey = 'body'): SchemaRegistry {
  return {
    schemaKey: 'article',
    version: 1,
    title: 'Article',
    fields: [
      {
        fieldId: 'stable-body',
        key: fieldKey,
        kind: 'richtext',
        search: { mode: 'off', fullText: true }
      },
      {
        fieldId: 'exact-title',
        key: 'title',
        kind: 'string',
        search: { mode: 'exact', filterable: true, sortable: true }
      }
    ],
    relations: []
  }
}

describe('full-text schema configuration', () => {
  it('persists the independent capability by stable field ID across rename', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      await syncSearchConfig({ db: fixture.db, schemaKey: 'article', registry: registry() })
      await syncSearchConfig({ db: fixture.db, schemaKey: 'article', registry: registry('content') })

      expect(await fixture.db.select().from(searchConfig)
        .where(eq(searchConfig.schemaKey, 'article'))).toEqual(expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'stable-body',
          fieldKey: 'content',
          searchMode: 'off',
          filterable: false,
          sortable: false,
          fullText: true
        }),
        expect.objectContaining({
          fieldId: 'exact-title',
          searchMode: 'exact',
          filterable: true,
          sortable: true,
          fullText: false
        })
      ]))
    } finally {
      fixture.close()
    }
  })

  it('rejects full-text on unsupported field kinds while accepting richtext', () => {
    const base = {
      schemaKey: 'article',
      title: 'Article'
    }
    expect(schemaAstSchema.safeParse({
      ...base,
      fields: [{
        id: 'body',
        key: 'body',
        kind: 'richtext',
        search: { mode: 'off', fullText: true }
      }]
    }).success).toBe(true)

    const unsupported = schemaAstSchema.safeParse({
      ...base,
      fields: [{
        id: 'cover',
        key: 'cover',
        kind: 'asset',
        search: { mode: 'off', fullText: true }
      }]
    })
    expect(unsupported.success).toBe(false)
    if (!unsupported.success) {
      expect(unsupported.error.issues[0]?.path).toEqual(['fields', 0, 'search', 'fullText'])
    }
  })
})
