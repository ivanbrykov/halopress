import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { and, desc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { compileSchemaAst } from '../server/cms/compiler'
import { validateContentJson } from '../server/cms/content-validation'
import { upsertContentListingSnapshot } from '../server/cms/content-listing'
import { parseContentJson } from '../server/cms/content-json'
import { getActiveSchema } from '../server/cms/repo'
import { syncContentRefs } from '../server/cms/ref-sync'
import { syncSearchConfig } from '../server/cms/search-config'
import { upsertContentSearchData, syncSearchIndexForSchema } from '../server/cms/search-index'
import {
  asset as assetTable,
  content as contentTable,
  contentListing,
  contentSearchData,
  schema as schemaTable,
  schemaActive,
  user,
  userRole
} from '../server/db/schema'
import type { SchemaAst, SchemaRegistry } from '../server/cms/types'
import { ensureAdminUser, ensureAnonymousSchemaRole, ensureBootstrapSchema, runMigrations, seedRoles } from '../server/utils/install'
import { newId } from '../server/utils/ids'
import { createTestSqliteDb } from './fixtures/sqlite'

async function publishSchema(db: any, ast: SchemaAst, createdBy: string, version = 1) {
  const compiled = compileSchemaAst(ast, version)
  const now = new Date()

  await db.insert(schemaTable).values({
    schemaKey: ast.schemaKey,
    version,
    title: ast.title,
    astJson: JSON.stringify(ast),
    jsonSchema: JSON.stringify(compiled.jsonSchema),
    uiSchema: JSON.stringify(compiled.uiSchema),
    registryJson: JSON.stringify(compiled.registry),
    diffJson: JSON.stringify({ from: version === 1 ? null : version - 1, to: version }),
    createdBy,
    createdAt: now,
    note: 'test'
  })

  await db
    .insert(schemaActive)
    .values({ schemaKey: ast.schemaKey, activeVersion: version, updatedAt: now })
    .onConflictDoUpdate({
      target: schemaActive.schemaKey,
      set: { activeVersion: version, updatedAt: now }
    })

  await ensureAnonymousSchemaRole(db, ast.schemaKey)
  await syncSearchConfig({ db, schemaKey: ast.schemaKey, registry: compiled.registry })
  await syncSearchIndexForSchema({ db, schemaKey: ast.schemaKey, registry: compiled.registry })

  return compiled
}

async function createContentRecord(args: {
  db: any
  schemaKey: string
  createdBy: string
  status?: string
  content: Record<string, unknown>
}) {
  const active = await getActiveSchema(args.db, args.schemaKey)
  if (!active?.registry) throw new Error(`Missing active schema: ${args.schemaKey}`)

  const now = new Date()
  const id = newId()
  const status = args.status ?? 'draft'
  const content = validateContentJson(active.jsonSchema, args.content)

  await args.db.insert(contentTable).values({
    id,
    schemaKey: args.schemaKey,
    schemaVersion: active.version,
    status,
    contentJson: JSON.stringify(content),
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now
  })

  await syncContentProjections({
    db: args.db,
    id,
    schemaKey: args.schemaKey,
    schemaVersion: active.version,
    registry: active.registry,
    status,
    content,
    createdAt: now,
    updatedAt: now
  })

  return id
}

async function updateContentRecord(args: {
  db: any
  id: string
  schemaKey: string
  status?: string
  content: Record<string, unknown>
}) {
  const active = await getActiveSchema(args.db, args.schemaKey)
  if (!active?.registry) throw new Error(`Missing active schema: ${args.schemaKey}`)

  const existing = await args.db
    .select()
    .from(contentTable)
    .where(eq(contentTable.id, args.id))
    .get()
  if (!existing) throw new Error(`Missing content: ${args.id}`)

  const now = new Date()
  const status = args.status ?? existing.status
  const content = validateContentJson(active.jsonSchema, args.content)

  await args.db
    .update(contentTable)
    .set({
      status,
      contentJson: JSON.stringify(content),
      schemaVersion: active.version,
      updatedAt: now
    })
    .where(eq(contentTable.id, args.id))

  await syncContentProjections({
    db: args.db,
    id: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: active.version,
    registry: active.registry,
    status,
    content,
    createdAt: existing.createdAt,
    updatedAt: now
  })
}

async function softDeleteContent(db: any, id: string) {
  const now = new Date()
  await db
    .update(contentTable)
    .set({ status: 'deleted', updatedAt: now })
    .where(eq(contentTable.id, id))
  await db
    .update(contentListing)
    .set({ status: 'deleted', updatedAt: now })
    .where(eq(contentListing.contentId, id))
}

async function syncContentProjections(args: {
  db: any
  id: string
  schemaKey: string
  schemaVersion: number
  registry: SchemaRegistry
  status: string
  content: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}) {
  await syncContentRefs({ db: args.db, contentId: args.id, registry: args.registry, content: args.content })
  await upsertContentListingSnapshot({
    db: args.db,
    registry: args.registry,
    content: args.content,
    contentId: args.id,
    schemaKey: args.schemaKey,
    schemaVersion: args.schemaVersion,
    status: args.status,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt
  })
  await upsertContentSearchData({
    db: args.db,
    contentId: args.id,
    registry: args.registry,
    content: args.content
  })
}

function photoSchemaAst(): SchemaAst {
  return {
    schemaKey: 'photo',
    title: 'Photos',
    description: 'Basic photo gallery',
    listing: {
      titleFieldKey: 'title',
      descriptionFieldKey: 'caption',
      imageFieldKey: 'image'
    },
    fields: [
      {
        id: 'photo_title',
        key: 'title',
        kind: 'string',
        title: 'Title',
        required: true,
        search: { mode: 'exact', filterable: true, sortable: true }
      },
      {
        id: 'photo_caption',
        key: 'caption',
        kind: 'text',
        title: 'Caption',
        search: { mode: 'exact', filterable: true }
      },
      {
        id: 'photo_image',
        key: 'image',
        kind: 'asset',
        title: 'Image',
        required: true
      }
    ]
  }
}

describe('setup CRUD regression', () => {
  it('creates a User, Article, and Photos site and keeps listing/search projections in sync', async () => {
    const dbPath = join(tmpdir(), `halopress-regression-${process.pid}-${Date.now()}.sqlite`)
    const fixture = await createTestSqliteDb({ path: dbPath })
    const { db } = fixture

    try {
      await runMigrations(db)
      await seedRoles(db)
      const adminId = await ensureAdminUser(db, {
        email: 'admin@example.com',
        name: 'Admin',
        password: 'password1234'
      })
      expect(adminId).toBeTruthy()
      const actor = `user:${adminId}`
      await ensureBootstrapSchema(db, actor)

      expect(existsSync(dbPath)).toBe(true)
      expect(await db.select().from(userRole)).toHaveLength(3)
      expect(await db.select().from(user)).toHaveLength(1)

      const articleActive = await getActiveSchema(db, 'article')
      expect(articleActive?.version).toBe(1)

      const bootstrapArticle = await db
        .select()
        .from(contentTable)
        .where(eq(contentTable.schemaKey, 'article'))
        .get()
      expect(parseContentJson(bootstrapArticle.contentJson).title).toBe('Welcome guide')

      const bootstrapListing = await db
        .select()
        .from(contentListing)
        .where(eq(contentListing.contentId, bootstrapArticle.id))
        .get()
      expect(bootstrapListing).toMatchObject({
        schemaKey: 'article',
        title: 'Welcome guide',
        status: 'published'
      })

      const searchableArticleAst = {
        ...articleActive!.ast,
        fields: articleActive!.ast.fields.map(field =>
          field.key === 'title'
            ? { ...field, search: { mode: 'exact' as const, filterable: true, sortable: true } }
            : field
        )
      }
      const articleCompiled = await publishSchema(db, searchableArticleAst, actor, 2)
      const articleTitleFieldId = articleCompiled.registry.fields.find(field => field.key === 'title')!.fieldId
      const bootstrapTitleIndex = await db
        .select()
        .from(contentSearchData)
        .where(and(
          eq(contentSearchData.contentId, bootstrapArticle.id),
          eq(contentSearchData.fieldId, articleTitleFieldId)
        ))
        .get()
      expect(bootstrapTitleIndex).toMatchObject({ dataType: 'text', text: 'Welcome guide' })

      const secondArticleId = await createContentRecord({
        db,
        schemaKey: 'article',
        createdBy: actor,
        status: 'published',
        content: {
          title: 'Second Article',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }]
          }
        }
      })

      let secondArticleListing = await db
        .select()
        .from(contentListing)
        .where(eq(contentListing.contentId, secondArticleId))
        .get()
      expect(secondArticleListing).toMatchObject({
        title: 'Second Article',
        status: 'published'
      })

      let secondArticleIndex = await db
        .select()
        .from(contentSearchData)
        .where(and(
          eq(contentSearchData.contentId, secondArticleId),
          eq(contentSearchData.fieldId, articleTitleFieldId)
        ))
        .get()
      expect(secondArticleIndex.text).toBe('Second Article')

      await updateContentRecord({
        db,
        id: secondArticleId,
        schemaKey: 'article',
        status: 'published',
        content: {
          title: 'Second Article Updated',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated body' }] }]
          }
        }
      })

      secondArticleListing = await db
        .select()
        .from(contentListing)
        .where(eq(contentListing.contentId, secondArticleId))
        .get()
      secondArticleIndex = await db
        .select()
        .from(contentSearchData)
        .where(and(
          eq(contentSearchData.contentId, secondArticleId),
          eq(contentSearchData.fieldId, articleTitleFieldId)
        ))
        .get()
      expect(secondArticleListing.title).toBe('Second Article Updated')
      expect(secondArticleIndex.text).toBe('Second Article Updated')

      await softDeleteContent(db, secondArticleId)
      secondArticleListing = await db
        .select()
        .from(contentListing)
        .where(eq(contentListing.contentId, secondArticleId))
        .get()
      expect(secondArticleListing.status).toBe('deleted')

      const assetId = newId()
      await db.insert(assetTable).values({
        id: assetId,
        kind: 'image',
        status: 'ready',
        objectKey: `assets/${assetId}/original`,
        mimeType: 'image/jpeg',
        sizeBytes: 1200,
        sha256: null,
        width: 1200,
        height: 800,
        durationMs: null,
        createdBy: actor,
        createdAt: new Date()
      })

      const photoCompiled = await publishSchema(db, photoSchemaAst(), actor)
      const photoTitleFieldId = photoCompiled.registry.fields.find(field => field.key === 'title')!.fieldId
      const photoId = await createContentRecord({
        db,
        schemaKey: 'photo',
        createdBy: actor,
        status: 'published',
        content: {
          title: 'Lobby Photo',
          caption: 'Front desk and lobby',
          image: assetId
        }
      })

      const photoListing = await db
        .select()
        .from(contentListing)
        .where(eq(contentListing.contentId, photoId))
        .get()
      expect(photoListing).toMatchObject({
        schemaKey: 'photo',
        title: 'Lobby Photo',
        description: 'Front desk and lobby',
        image: `/assets/${assetId}/raw`,
        status: 'published'
      })

      const photoIndex = await db
        .select()
        .from(contentSearchData)
        .where(and(
          eq(contentSearchData.contentId, photoId),
          eq(contentSearchData.fieldId, photoTitleFieldId)
        ))
        .get()
      expect(photoIndex).toMatchObject({ dataType: 'text', text: 'Lobby Photo' })

      const publishedListings = await db
        .select()
        .from(contentListing)
        .where(and(
          eq(contentListing.projectionScope, 'working'),
          eq(contentListing.status, 'published')
        ))
        .orderBy(desc(contentListing.updatedAt))
      expect(publishedListings.map(row => row.schemaKey).sort()).toEqual(['article', 'photo'])
    } finally {
      fixture.close()
      await rm(dbPath, { force: true })
    }
  })
})
