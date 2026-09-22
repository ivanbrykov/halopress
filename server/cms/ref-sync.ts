import { and, eq, sql } from 'drizzle-orm'
import type { QueryBuilder } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db/db'
import { content as contentTable, contentRef, contentRefList } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import type { DbStatement } from '../db/transaction'
import type { SchemaRegistry } from './types'

type TargetKind = 'content' | 'user' | 'asset'

export async function syncContentRefs(args: {
  db: Db
  contentId: string
  registry: SchemaRegistry
  content: Record<string, unknown>
  projectionScope?: 'working' | 'published'
  statements?: DbStatement[]
}) {
  const { db, contentId, registry, content, statements } = args
  const projectionScope = args.projectionScope ?? 'working'

  const relations = registry.relations
  await executeDbStatement(db
    .delete(contentRef)
    .where(and(eq(contentRef.contentId, contentId), eq(contentRef.projectionScope, projectionScope))), statements)
  await executeDbStatement(db
    .delete(contentRefList)
    .where(and(eq(contentRefList.ownerContentId, contentId), eq(contentRefList.projectionScope, projectionScope))), statements)

  // Insert current refs (MVP: top-level fields only).
  for (const rel of relations) {
    const value = (content as any)?.[rel.fieldKey]
    if (!value) continue

    const targetKind = rel.targetKind as TargetKind
    const targetSchemaKey = rel.targetSchemaKey ?? null
    const insertedSetIds = new Set<string>()

    const pushOne = async (targetId: string, position?: number, meta?: Record<string, unknown>) => {
      const guardedContentTarget = targetKind === 'content'
      if (!insertedSetIds.has(targetId)) {
        const refStatement = guardedContentTarget
          ? db.insert(contentRef).select((qb: QueryBuilder) => {
              const selection = qb.select({
                contentId: sql<string>`${contentId}`.as('content_id'),
                projectionScope: sql<string>`${projectionScope}`.as('projection_scope'),
                fieldPath: sql<string>`${rel.fieldKey}`.as('field_path'),
                targetKind: sql<string>`${targetKind}`.as('target_kind'),
                targetSchemaKey: sql<string | null>`${targetSchemaKey}`.as('target_schema_key'),
                targetId: sql<string>`${targetId}`.as('target_id')
              })
              return selection.from(contentTable).where(targetSchemaKey
                ? and(eq(contentTable.id, targetId), eq(contentTable.schemaKey, targetSchemaKey))
                : eq(contentTable.id, targetId)).limit(1)
            })
          : db.insert(contentRef).values({
              contentId,
              projectionScope,
              fieldPath: rel.fieldKey,
              targetKind,
              targetSchemaKey,
              targetId
            })
        await executeDbStatement(refStatement, statements)
        insertedSetIds.add(targetId)
      }
      if (typeof position === 'number') {
        const itemId = targetKind === 'asset' ? null : targetId
        const assetId = targetKind === 'asset' ? targetId : null
        const metaJson = meta && Object.keys(meta).length ? JSON.stringify(meta) : null
        const listStatement = guardedContentTarget
          ? db.insert(contentRefList).select((qb: QueryBuilder) => {
              const selection = qb.select({
                ownerContentId: sql<string>`${contentId}`.as('owner_content_id'),
                projectionScope: sql<string>`${projectionScope}`.as('projection_scope'),
                fieldKey: sql<string>`${rel.fieldKey}`.as('field_key'),
                position: sql<number>`${position}`.as('position'),
                itemKind: sql<string>`${targetKind}`.as('item_kind'),
                itemSchemaKey: sql<string | null>`${targetSchemaKey}`.as('item_schema_key'),
                itemId: sql<string | null>`${itemId}`.as('item_id'),
                assetId: sql<string | null>`${assetId}`.as('asset_id'),
                metaJson: sql<string | null>`${metaJson}`.as('meta_json')
              })
              return selection.from(contentTable).where(targetSchemaKey
                ? and(eq(contentTable.id, targetId), eq(contentTable.schemaKey, targetSchemaKey))
                : eq(contentTable.id, targetId)).limit(1)
            })
          : db.insert(contentRefList).values({
              ownerContentId: contentId,
              projectionScope,
              fieldKey: rel.fieldKey,
              position,
              itemKind: targetKind,
              itemSchemaKey: targetSchemaKey,
              itemId,
              assetId,
              metaJson
            })
        await executeDbStatement(listStatement, statements)
      }
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i]
        if (typeof v === 'string' && v) await pushOne(v, i)
        else if (v && typeof v === 'object' && typeof (v as any).assetId === 'string') {
          const { assetId, alt, caption } = v as { assetId: string; alt?: unknown; caption?: unknown }
          const meta = {
            ...(typeof alt === 'string' && alt ? { alt } : {}),
            ...(typeof caption === 'string' && caption ? { caption } : {})
          }
          await pushOne(assetId, i, meta)
        }
      }
    } else if (typeof value === 'string') {
      await pushOne(value)
    }
  }
}
