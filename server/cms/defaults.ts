import { ulid } from 'ulid'
import type { SchemaAst } from './types'

export function defaultArticleSchemaAst(): SchemaAst {
  const titleId = ulid()
  const bodyId = ulid()
  return {
    schemaKey: 'article',
    title: 'Article',
    description: 'Default article schema',
    fields: [
      {
        id: titleId,
        key: 'title',
        kind: 'string',
        title: 'Title',
        required: true
      },
      {
        id: bodyId,
        key: 'body',
        kind: 'richtext',
        title: 'Body',
        required: true,
        ui: { widget: 'u-editor' }
      }
    ],
    presentation: {
      contractVersion: 1,
      preset: 'article',
      collectionTemplate: 'cards',
      detailTemplate: 'article',
      slots: { title: titleId, body: bodyId }
    }
  }
}
