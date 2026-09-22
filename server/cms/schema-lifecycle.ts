import { and, eq, or, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

import type { Db } from '../db/db'
import {
  content as contentTable,
  contentListing,
  contentRef,
  contentRefList,
  contentSearchData,
  documentAssetRef,
  documentRevision,
  fullTextChunk,
  fullTextFts,
  fullTextIndexState,
  fullTextJob,
  layoutReference,
  publicationRevision,
  publicRoute,
  schema as schemaTable,
  schemaActive,
  schemaDraft,
  schemaRole,
  searchConfig
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { badRequest, conflict, notFound } from '../utils/http'

export type SchemaLifecycleStatus = 'active' | 'inactive' | 'never-published'
type SchemaCleanupGuard = 'empty' | 'inactive' | 'none'

type CountRow = { count: number | string | null }

function rowCount(row: CountRow | undefined) {
  return Number(row?.count ?? 0)
}

async function countWhere(db: Db, table: any, where: any) {
  const row = await db
    .select({ count: sql<number>`count(1)` })
    .from(table)
    .where(where)
    .get()
  return rowCount(row)
}

export async function getSchemaDependencyImpact(db: Db, schemaKey: string) {
  const lifecycle = await db
    .select()
    .from(schemaActive)
    .where(eq(schemaActive.schemaKey, schemaKey))
    .get()
  const draft = await db
    .select({ schemaKey: schemaDraft.schemaKey })
    .from(schemaDraft)
    .where(eq(schemaDraft.schemaKey, schemaKey))
    .get()
  const version = await db
    .select({ schemaKey: schemaTable.schemaKey })
    .from(schemaTable)
    .where(eq(schemaTable.schemaKey, schemaKey))
    .get()

  if (!lifecycle && !draft && !version) throw notFound('Schema not found')

  const contentByStatusRows = await db
    .select({ status: contentTable.status, count: sql<number>`count(1)` })
    .from(contentTable)
    .where(eq(contentTable.schemaKey, schemaKey))
    .groupBy(contentTable.status)
  const contentByStatus = Object.fromEntries(
    contentByStatusRows.map((row: { status: string, count: number | string }) => [row.status, Number(row.count)])
  )
  const contentTotal = Object.values(contentByStatus).reduce((total: number, count) => total + Number(count), 0)

  const ownedContent = sql`select ${contentTable.id} from ${contentTable} where ${contentTable.schemaKey} = ${schemaKey}`
  const [
    versions,
    drafts,
    inboundRefs,
    inboundRefListItems,
    outboundRefs,
    outboundRefListItems,
    listings,
    searchConfigRows,
    searchDataRows,
    permissions,
    publicationRevisions,
    documentRevisions,
    assetReferences,
    fullTextJobs,
    fullTextIndexStates,
    fullTextChunks,
    fullTextRows
  ] = await Promise.all([
    countWhere(db, schemaTable, eq(schemaTable.schemaKey, schemaKey)),
    countWhere(db, schemaDraft, eq(schemaDraft.schemaKey, schemaKey)),
    countWhere(db, contentRef, and(
      eq(contentRef.targetKind, 'content'),
      or(
        eq(contentRef.targetSchemaKey, schemaKey),
        sql`${contentRef.targetId} in (${ownedContent})`
      )
    )),
    countWhere(db, contentRefList, and(
      eq(contentRefList.itemKind, 'content'),
      or(
        eq(contentRefList.itemSchemaKey, schemaKey),
        sql`${contentRefList.itemId} in (${ownedContent})`
      )
    )),
    countWhere(db, contentRef, sql`${contentRef.contentId} in (${ownedContent})`),
    countWhere(db, contentRefList, sql`${contentRefList.ownerContentId} in (${ownedContent})`),
    countWhere(db, contentListing, eq(contentListing.schemaKey, schemaKey)),
    countWhere(db, searchConfig, eq(searchConfig.schemaKey, schemaKey)),
    countWhere(db, contentSearchData, sql`${contentSearchData.contentId} in (${ownedContent})`),
    countWhere(db, schemaRole, eq(schemaRole.schemaKey, schemaKey)),
    countWhere(db, publicationRevision, or(
      and(eq(publicationRevision.documentKind, 'content'), eq(publicationRevision.schemaKey, schemaKey)),
      and(eq(publicationRevision.documentKind, 'content'), sql`${publicationRevision.documentId} in (${ownedContent})`)
    )),
    countWhere(db, documentRevision, or(
      and(eq(documentRevision.documentKind, 'content'), eq(documentRevision.schemaKey, schemaKey)),
      and(eq(documentRevision.documentKind, 'schema-draft'), eq(documentRevision.documentId, schemaKey)),
      and(eq(documentRevision.documentKind, 'content'), sql`${documentRevision.documentId} in (${ownedContent})`)
    )),
    countWhere(db, documentAssetRef, and(
      eq(documentAssetRef.documentKind, 'content'),
      sql`${documentAssetRef.documentId} in (${ownedContent})`
    )),
    countWhere(db, fullTextJob, eq(fullTextJob.schemaKey, schemaKey)),
    countWhere(db, fullTextIndexState, eq(fullTextIndexState.schemaKey, schemaKey)),
    countWhere(db, fullTextChunk, eq(fullTextChunk.schemaKey, schemaKey)),
    countWhere(db, fullTextFts, eq(fullTextFts.schemaKey, schemaKey))
  ])

  const status = (lifecycle?.status ?? 'never-published') as SchemaLifecycleStatus
  const inboundReferences = inboundRefs + inboundRefListItems
  const outboundReferences = outboundRefs + outboundRefListItems
  const blockers = [
    ...(status === 'active' ? ['Deactivate the schema before deleting it.'] : []),
    ...(contentTotal > 0 ? [`Remove or purge ${contentTotal} content item${contentTotal === 1 ? '' : 's'}.`] : []),
    ...(inboundReferences > 0 ? [`Remove or purge ${inboundReferences} inbound reference projection${inboundReferences === 1 ? '' : 's'}.`] : [])
  ]

  return {
    schemaKey,
    status,
    activeVersion: lifecycle?.activeVersion ?? null,
    updatedAt: lifecycle?.updatedAt ?? null,
    deactivatedAt: lifecycle?.deactivatedAt ?? null,
    deactivatedBy: lifecycle?.deactivatedBy ?? null,
    reactivatedAt: lifecycle?.reactivatedAt ?? null,
    reactivatedBy: lifecycle?.reactivatedBy ?? null,
    counts: {
      contentTotal,
      contentByStatus,
      versions,
      drafts,
      inboundReferences,
      outboundReferences,
      listings,
      searchConfig: searchConfigRows,
      searchProjections: searchDataRows,
      permissions,
      publicationRevisions,
      documentRevisions,
      assetReferences,
      fullTextJobs,
      fullTextIndexStates,
      fullTextChunks,
      fullTextRows
    },
    blockers,
    canDelete: blockers.length === 0,
    canPurge: status === 'inactive'
  }
}

export async function deactivateSchema(db: Db, schemaKey: string, actorId: string | null) {
  const lifecycle = await getSchemaDependencyImpact(db, schemaKey)
  if (lifecycle.status === 'never-published') throw conflict('Schema has never been published')
  if (lifecycle.status === 'inactive') return lifecycle

  const now = new Date()
  await db
    .update(schemaActive)
    .set({ status: 'inactive', deactivatedAt: now, deactivatedBy: actorId, updatedAt: now })
    .where(eq(schemaActive.schemaKey, schemaKey))

  return await getSchemaDependencyImpact(db, schemaKey)
}

export async function reactivateSchema(db: Db, schemaKey: string, actorId: string | null) {
  const lifecycle = await getSchemaDependencyImpact(db, schemaKey)
  if (lifecycle.status === 'never-published') throw conflict('Publish the schema before activating it')
  if (lifecycle.status === 'active') return lifecycle

  const now = new Date()
  await db
    .update(schemaActive)
    .set({ status: 'active', reactivatedAt: now, reactivatedBy: actorId, updatedAt: now })
    .where(eq(schemaActive.schemaKey, schemaKey))

  return await getSchemaDependencyImpact(db, schemaKey)
}

function cleanupGuard(schemaKey: string, guard: SchemaCleanupGuard) {
  if (guard === 'inactive') {
    return sql`exists (
      select 1 from ${schemaActive}
      where ${schemaActive.schemaKey} = ${schemaKey}
        and ${schemaActive.status} = 'inactive'
    )`
  }
  if (guard === 'empty') {
    return sql`not exists (
      select 1 from ${contentTable}
      where ${contentTable.schemaKey} = ${schemaKey}
    ) and not exists (
      select 1 from ${contentRef}
      where ${contentRef.targetKind} = 'content'
        and (
          ${contentRef.targetSchemaKey} = ${schemaKey}
          or ${contentRef.targetId} in (
            select ${contentTable.id} from ${contentTable}
            where ${contentTable.schemaKey} = ${schemaKey}
          )
        )
    ) and not exists (
      select 1 from ${contentRefList}
      where ${contentRefList.itemKind} = 'content'
        and (
          ${contentRefList.itemSchemaKey} = ${schemaKey}
          or ${contentRefList.itemId} in (
            select ${contentTable.id} from ${contentTable}
            where ${contentTable.schemaKey} = ${schemaKey}
          )
        )
    ) and not exists (
      select 1 from ${schemaActive}
      where ${schemaActive.schemaKey} = ${schemaKey}
        and ${schemaActive.status} <> 'inactive'
    )`
  }
  return undefined
}

function guardedWhere(condition: any, guard: ReturnType<typeof cleanupGuard>) {
  return guard ? and(guard, condition) : condition
}

async function schemaIdentityExists(db: Db, schemaKey: string) {
  const [lifecycle, draft, version] = await Promise.all([
    db.select({ schemaKey: schemaActive.schemaKey }).from(schemaActive).where(eq(schemaActive.schemaKey, schemaKey)).get(),
    db.select({ schemaKey: schemaDraft.schemaKey }).from(schemaDraft).where(eq(schemaDraft.schemaKey, schemaKey)).get(),
    db.select({ schemaKey: schemaTable.schemaKey }).from(schemaTable).where(eq(schemaTable.schemaKey, schemaKey)).get()
  ])
  return Boolean(lifecycle || draft || version)
}

export async function deleteSchemaResidue(
  event: H3Event,
  db: Db,
  schemaKey: string,
  options: { guard?: SchemaCleanupGuard } = {}
) {
  const ownedContent = sql`select ${contentTable.id} from ${contentTable} where ${contentTable.schemaKey} = ${schemaKey}`
  const guard = cleanupGuard(schemaKey, options.guard ?? 'none')

  await withDbTransaction(event, db, async (tx: Db, statements) => {
    // Draft and every historical published Schema-version reference share the
    // Schema identity. Remove them only inside the same guarded cleanup group
    // as the version rows so a concurrent Layout delete cannot observe a
    // half-purged Schema.
    await executeDbStatement(tx.delete(layoutReference)
      .where(guardedWhere(and(
        eq(layoutReference.ownerType, 'schema'),
        eq(layoutReference.ownerId, schemaKey)
      ), guard)), statements)
    await executeDbStatement(tx.delete(publicRoute)
      .where(guardedWhere(eq(publicRoute.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(contentSearchData)
      .where(guardedWhere(sql`${contentSearchData.contentId} in (${ownedContent})`, guard)), statements)
    await executeDbStatement(tx.delete(fullTextFts)
      .where(guardedWhere(eq(fullTextFts.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(fullTextChunk)
      .where(guardedWhere(eq(fullTextChunk.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(fullTextIndexState)
      .where(guardedWhere(eq(fullTextIndexState.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(fullTextJob)
      .where(guardedWhere(eq(fullTextJob.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(contentRef)
      .where(guardedWhere(or(
        sql`${contentRef.contentId} in (${ownedContent})`,
        and(eq(contentRef.targetKind, 'content'), or(
          eq(contentRef.targetSchemaKey, schemaKey),
          sql`${contentRef.targetId} in (${ownedContent})`
        ))
      ), guard)), statements)
    await executeDbStatement(tx.delete(contentRefList)
      .where(guardedWhere(or(
        sql`${contentRefList.ownerContentId} in (${ownedContent})`,
        and(eq(contentRefList.itemKind, 'content'), or(
          eq(contentRefList.itemSchemaKey, schemaKey),
          sql`${contentRefList.itemId} in (${ownedContent})`
        ))
      ), guard)), statements)
    await executeDbStatement(tx.delete(documentAssetRef)
      .where(guardedWhere(and(
        eq(documentAssetRef.documentKind, 'content'),
        sql`${documentAssetRef.documentId} in (${ownedContent})`
      ), guard)), statements)
    await executeDbStatement(tx.delete(contentListing)
      .where(guardedWhere(eq(contentListing.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(publicationRevision)
      .where(guardedWhere(or(
        and(eq(publicationRevision.documentKind, 'content'), eq(publicationRevision.schemaKey, schemaKey)),
        and(eq(publicationRevision.documentKind, 'content'), sql`${publicationRevision.documentId} in (${ownedContent})`)
      ), guard)), statements)
    await executeDbStatement(tx.delete(documentRevision)
      .where(guardedWhere(or(
        and(eq(documentRevision.documentKind, 'content'), eq(documentRevision.schemaKey, schemaKey)),
        and(eq(documentRevision.documentKind, 'schema-draft'), eq(documentRevision.documentId, schemaKey)),
        and(eq(documentRevision.documentKind, 'content'), sql`${documentRevision.documentId} in (${ownedContent})`)
      ), guard)), statements)
    await executeDbStatement(tx.delete(contentTable)
      .where(guardedWhere(eq(contentTable.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(searchConfig)
      .where(guardedWhere(eq(searchConfig.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(schemaRole)
      .where(guardedWhere(eq(schemaRole.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(schemaDraft)
      .where(guardedWhere(eq(schemaDraft.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(schemaTable)
      .where(guardedWhere(eq(schemaTable.schemaKey, schemaKey), guard)), statements)
    await executeDbStatement(tx.delete(schemaActive)
      .where(guardedWhere(eq(schemaActive.schemaKey, schemaKey), guard)), statements)
  })
}

export async function deleteEmptySchema(event: H3Event, db: Db, schemaKey: string) {
  const impact = await getSchemaDependencyImpact(db, schemaKey)
  if (!impact.canDelete) {
    throw conflict('Schema is not empty', { impact })
  }

  await deleteSchemaResidue(event, db, schemaKey, { guard: 'empty' })
  if (await schemaIdentityExists(db, schemaKey)) {
    throw conflict('Schema is no longer empty', { impact: await getSchemaDependencyImpact(db, schemaKey) })
  }
  return impact
}

export async function purgeSchema(event: H3Event, db: Db, schemaKey: string, confirmation: string) {
  if (confirmation !== schemaKey) throw badRequest('Type the schema key to confirm purge')
  const impact = await getSchemaDependencyImpact(db, schemaKey)
  if (!impact.canPurge) throw conflict('Deactivate the schema before purging it', { impact })

  await deleteSchemaResidue(event, db, schemaKey, { guard: 'inactive' })
  if (await schemaIdentityExists(db, schemaKey)) {
    throw conflict('Schema lifecycle changed before purge completed', {
      impact: await getSchemaDependencyImpact(db, schemaKey)
    })
  }
  return impact
}
