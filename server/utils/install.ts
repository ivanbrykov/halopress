import { and, eq, exists, gt, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { compileSchemaAst } from '../cms/compiler'
import { parseContentJson } from '../cms/content-json'
import { syncContentProjections } from '../cms/content-projections'
import { defaultArticleSchemaAst } from '../cms/defaults'
import { createInitialDocumentRevision } from '../cms/document-revisions'
import { getPublicationRevision, publicationRevisionValues } from '../cms/publication'
import { syncSearchConfig } from '../cms/search-config'
import {
  content,
  documentRevision,
  installation,
  publicationRevision,
  schema,
  schemaActive,
  schemaRole,
  siteMenuSet,
  user,
  userRole
} from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { newId } from './ids'
import { SETUP_SESSION_TTL_MILLISECONDS } from './install-session'
import { hashPassword } from './password'
import { ensureGlobalSiteMenu } from './site-menus'
import {
  BOOTSTRAP_CONTENT_ID,
  BOOTSTRAP_PUBLICATION_REVISION_ID,
  BOOTSTRAP_SCHEMA_KEY,
  BOOTSTRAP_SCHEMA_NOTE,
  BOOTSTRAP_SCHEMA_VERSION
} from './bootstrap'

export const INSTALLATION_KEY = 'singleton'
const INSTALL_LEASE_MILLISECONDS = 5 * 60 * 1000

export const REQUIRED_INSTALL_TABLES = [
  'asset',
  'content',
  'content_listing',
  'content_ref',
  'content_ref_list',
  'content_search_data',
  'document_asset_ref',
  'document_revision',
  'external_identity',
  'full_text_chunk',
  'full_text_control',
  'full_text_fts',
  'full_text_index_state',
  'full_text_job',
  'installation',
  'site_layout_reference',
  'site_layout_resource',
  'membership_invitation',
  'page',
  'publication_revision',
  'public_route',
  'registration_rate_limit',
  'schema',
  'schema_active',
  'schema_draft',
  'schema_role',
  'search_config',
  'settings',
  'site_menu_reference',
  'site_menu_set',
  'user',
  'user_role'
] as const

function splitStatements(raw: string) {
  return raw
    .split('--> statement-breakpoint')
    .map(part => part.trim())
    .filter(Boolean)
}

async function sha256Hex(text: string) {
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(text)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text).digest('hex')
}

type LoadedMigration = { name: string; when: number; hash: string; statements: string[] }

async function loadMigrations(): Promise<LoadedMigration[]> {
  if (!(import.meta as any).glob) {
    const { readMigrationFiles } = await import('drizzle-orm/migrator')
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const migrationsFolder = resolve(process.cwd(), 'server/db/migrations')
    const migrations = readMigrationFiles({
      migrationsFolder
    })
    const journal = JSON.parse(await readFile(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>
    }
    return migrations.map((migration, index) => ({
      name: `${journal.entries[index]?.tag || migration.folderMillis}.sql`,
      when: migration.folderMillis,
      hash: migration.hash,
      statements: migration.sql.map(statement => statement.trim()).filter(Boolean)
    }))
  }

  const journalModules = (import.meta as any).glob('../db/migrations/meta/_journal.json', {
    query: '?raw',
    import: 'default',
    eager: true
  })
  const journalRaw = Object.values(journalModules)[0] as string | undefined
  if (!journalRaw) throw new Error('Migration journal not found')

  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ tag: string; when: number; breakpoints: boolean }>
  }

  const sqlModules = (import.meta as any).glob('../db/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true
  })
  const entries: LoadedMigration[] = []

  for (const entry of journal.entries) {
    const fileKey = Object.keys(sqlModules).find(key => key.endsWith(`/${entry.tag}.sql`))
    if (!fileKey) throw new Error(`Missing migration file for ${entry.tag}`)
    const sqlText = sqlModules[fileKey] as string
    const hash = await sha256Hex(sqlText)
    entries.push({
      name: `${entry.tag}.sql`,
      when: entry.when,
      hash,
      statements: splitStatements(sqlText)
    })
  }

  return entries
}

async function ensureMigrationsTable(db: any) {
  await db.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)
  )
}

async function getAppliedMigrationTimestamps(db: any) {
  const rows = await db.values(
    sql.raw('SELECT created_at FROM __drizzle_migrations')
  )
  return new Set((rows ?? []).map((row: unknown[]) => Number(row[0])).filter(Number.isFinite))
}

async function runMigrationsInternal(db: any) {
  await ensureMigrationsTable(db)
  const appliedTimestamps = await getAppliedMigrationTimestamps(db)
  const migrations = await loadMigrations()

  for (const migration of migrations) {
    if (appliedTimestamps.has(migration.when)) continue
    await db.transaction(async (tx: any) => {
      for (const statement of migration.statements) {
        await tx.run(sql.raw(statement))
      }
      await tx.run(
        sql`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (${migration.hash}, ${migration.when})`
      )
    })
    appliedTimestamps.add(migration.when)
  }
}

let migrationQueue: Promise<void> = Promise.resolve()

export async function runMigrations(db: any) {
  const migrationRun = migrationQueue.then(() => runMigrationsInternal(db))
  migrationQueue = migrationRun.catch(() => {})
  await migrationRun
}

const CLOUDFLARE_MIGRATIONS_TABLE = 'd1_migrations'

function cloudflareMigrationStatements(migration: LoadedMigration) {
  return migration.statements
    .filter(statement => !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*;?$/i.test(statement))
    .map((statement) => {
      if (/^PRAGMA\s+foreign_keys\s*=\s*OFF\s*;?$/i.test(statement)) {
        return 'PRAGMA defer_foreign_keys = ON'
      }
      return statement
    })
}

async function applyCloudflareMigration(db: any, migration: LoadedMigration) {
  const d1 = db.$client
  if (!d1 || typeof d1.prepare !== 'function' || typeof d1.batch !== 'function') {
    throw new Error('Cloudflare D1 client is unavailable')
  }

  const statements = cloudflareMigrationStatements(migration)
    .map(statement => d1.prepare(statement))
  statements.push(
    d1.prepare(`INSERT INTO ${CLOUDFLARE_MIGRATIONS_TABLE} (name) VALUES (?)`)
      .bind(migration.name)
  )
  await d1.batch(statements)
}

/**
 * Applies the bundled SQL through the Worker D1 binding while using the same
 * filename ledger as `wrangler d1 migrations apply`.
 */
async function runCloudflareMigrationsInternal(db: any) {
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS ${CLOUDFLARE_MIGRATIONS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`))

  const appliedRows = await db.values(
    sql.raw(`SELECT name FROM ${CLOUDFLARE_MIGRATIONS_TABLE} ORDER BY id`)
  )
  const appliedNames = new Set((appliedRows ?? []).map((row: unknown[]) => String(row[0])))

  for (const migration of await loadMigrations()) {
    if (appliedNames.has(migration.name)) continue

    try {
      await applyCloudflareMigration(db, migration)
    } catch (error) {
      // Another Worker isolate may have completed the same migration while this
      // request was queued by D1. Treat that race as success only when Wrangler's
      // filename ledger now proves the migration was applied.
      const racedRows = await db.values(
        sql`SELECT name FROM d1_migrations WHERE name = ${migration.name} LIMIT 1`
      )
      if (!racedRows?.length) throw error
    }
    appliedNames.add(migration.name)
  }
}

let cloudflareMigrationQueue: Promise<void> = Promise.resolve()

export async function runCloudflareMigrations(db: any) {
  const migrationRun = cloudflareMigrationQueue.then(() => runCloudflareMigrationsInternal(db))
  cloudflareMigrationQueue = migrationRun.catch(() => {})
  await migrationRun
}

export type UserRoleSeed = { roleKey: string; title: string; level: number }

const defaultRoles: UserRoleSeed[] = [
  { roleKey: 'admin', title: 'Admin', level: 100 },
  { roleKey: 'user', title: 'User', level: 50 },
  { roleKey: 'anonymous', title: 'Anonymous', level: 0 }
]

export async function seedRoles(db: any, roles: UserRoleSeed[] = defaultRoles) {
  await db
    .insert(userRole)
    .values(roles)
    .onConflictDoNothing()
}

export async function ensureAnonymousSchemaRole(db: any, schemaKey: string) {
  await db
    .insert(schemaRole)
    .values({
      schemaKey,
      roleKey: 'anonymous',
      canRead: true,
      canWrite: false,
      canAdmin: false
    })
    .onConflictDoNothing()
}

export async function ensureAdminUser(db: any, payload: { email: string; name?: string; password: string }) {
  const email = payload.email.trim().toLowerCase()
  const existing = await db.select({ id: user.id }).from(user).limit(1)
  if (existing.length) return null

  const { hash, salt } = await hashPassword(payload.password)
  const id = newId()
  await db.insert(user).values({
    id,
    email,
    name: payload.name?.trim() || null,
    roleKey: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    status: 'active',
    createdAt: new Date()
  })
  return id
}

export type InstallationClaim = {
  leaseToken: string
  leaseExpiresAt: Date
}

export type InstallationSessionAccess = {
  owned: boolean
  locked: boolean
  state: string | null
  retryAfterSeconds?: number
}

function retryAfterSeconds(now: Date, dates: Array<Date | null | undefined>) {
  const retryAt = Math.max(now.getTime(), ...dates.filter(Boolean).map(date => date!.getTime()))
  const seconds = Math.ceil((retryAt - now.getTime()) / 1000)
  return seconds > 0 ? seconds : undefined
}

export async function getInstallationSessionAccess(
  db: any,
  setupSessionHash: string | null,
  now = new Date()
): Promise<InstallationSessionAccess> {
  const row = await db
    .select({
      state: installation.state,
      setupSessionHash: installation.setupSessionHash,
      setupSessionExpiresAt: installation.setupSessionExpiresAt,
      leaseToken: installation.leaseToken,
      leaseExpiresAt: installation.leaseExpiresAt
    })
    .from(installation)
    .where(eq(installation.key, INSTALLATION_KEY))
    .get()

  if (!row || row.state === 'complete') {
    return { owned: false, locked: false, state: row?.state ?? null }
  }

  const setupSessionActive = Boolean(
    row.setupSessionHash
    && row.setupSessionExpiresAt
    && row.setupSessionExpiresAt.getTime() > now.getTime()
  )
  const installLeaseActive = Boolean(
    row.state === 'installing'
    && row.leaseToken
    && row.leaseExpiresAt
    && row.leaseExpiresAt.getTime() > now.getTime()
  )
  const owned = Boolean(
    setupSessionHash
    && setupSessionActive
    && row.setupSessionHash === setupSessionHash
  )
  const locked = !owned && (setupSessionActive || installLeaseActive)

  return {
    owned,
    locked,
    state: row.state,
    retryAfterSeconds: locked
      ? retryAfterSeconds(now, [row.setupSessionExpiresAt, row.leaseExpiresAt])
      : undefined
  }
}

export async function refreshInstallationSession(
  db: any,
  setupSessionHash: string,
  now = new Date()
) {
  const setupSessionExpiresAt = new Date(now.getTime() + SETUP_SESSION_TTL_MILLISECONDS)
  const refreshed = await db
    .update(installation)
    .set({ setupSessionExpiresAt, updatedAt: now })
    .where(and(
      eq(installation.key, INSTALLATION_KEY),
      ne(installation.state, 'complete'),
      eq(installation.setupSessionHash, setupSessionHash),
      gt(installation.setupSessionExpiresAt, now)
    ))
    .returning({ key: installation.key })
  return Boolean(refreshed?.length)
}

export async function reserveInstallationSession(
  db: any,
  setupSessionHash: string,
  now = new Date()
) {
  const setupSessionExpiresAt = new Date(now.getTime() + SETUP_SESSION_TTL_MILLISECONDS)
  const reserved = await db
    .insert(installation)
    .values({
      key: INSTALLATION_KEY,
      state: 'reserved',
      owner: `browser:${setupSessionHash.slice(0, 16)}`,
      setupSessionHash,
      setupSessionExpiresAt,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: null,
      updatedAt: now,
      lastError: null
    })
    .onConflictDoUpdate({
      target: installation.key,
      set: {
        state: 'reserved',
        owner: `browser:${setupSessionHash.slice(0, 16)}`,
        setupSessionHash,
        setupSessionExpiresAt,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
        lastError: null
      },
      setWhere: and(
        ne(installation.state, 'complete'),
        or(
          isNull(installation.setupSessionHash),
          isNull(installation.setupSessionExpiresAt),
          lte(installation.setupSessionExpiresAt, now)
        ),
        or(
          ne(installation.state, 'installing'),
          isNull(installation.leaseToken),
          isNull(installation.leaseExpiresAt),
          lte(installation.leaseExpiresAt, now)
        )
      )
    })
    .returning({ key: installation.key })
  return Boolean(reserved?.length)
}

export async function beginInstallation(
  db: any,
  setupSessionHash: string,
  options: { now?: Date; leaseMilliseconds?: number; leaseToken?: string } = {}
): Promise<InstallationClaim | null> {
  const now = options.now ?? new Date()
  const leaseToken = options.leaseToken ?? newId()
  const leaseExpiresAt = new Date(now.getTime() + (options.leaseMilliseconds ?? INSTALL_LEASE_MILLISECONDS))
  const claimed = await db
    .update(installation)
    .set({
      state: 'installing',
      leaseToken,
      leaseExpiresAt,
      updatedAt: now,
      lastError: null
    })
    .where(and(
      eq(installation.key, INSTALLATION_KEY),
      ne(installation.state, 'complete'),
      eq(installation.setupSessionHash, setupSessionHash),
      gt(installation.setupSessionExpiresAt, now),
      or(
        ne(installation.state, 'installing'),
        isNull(installation.leaseToken),
        isNull(installation.leaseExpiresAt),
        lte(installation.leaseExpiresAt, now)
      )
    ))
    .returning({ leaseToken: installation.leaseToken, leaseExpiresAt: installation.leaseExpiresAt })

  const row = claimed?.[0]
  if (!row?.leaseToken || !row.leaseExpiresAt) return null
  return { leaseToken: row.leaseToken, leaseExpiresAt: row.leaseExpiresAt }
}

export async function failInstallation(db: any, leaseToken: string, error: unknown, now = new Date()) {
  const message = (error instanceof Error ? error.message : String(error || 'Installation failed')).slice(0, 1000)
  await db
    .update(installation)
    .set({
      state: 'reserved',
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
      lastError: message
    })
    .where(and(
      eq(installation.key, INSTALLATION_KEY),
      eq(installation.leaseToken, leaseToken),
      ne(installation.state, 'complete')
    ))
}

export async function completeInstallation(
  db: any,
  leaseToken: string,
  owner: string,
  event?: H3Event,
  now = new Date()
) {
  const transactionEvent = event ?? ({ context: {} } as H3Event)
  await ensureGlobalSiteMenu(transactionEvent, db, { repairReference: true })

  // Migration 0001 marks legacy databases with users/roles complete, so this
  // browser-setup completion path is fresh-install-only (including retries).
  // Complete the installation and transfer Global to the named-menu owner in
  // one transaction/batch. Keep the exact lease token as a permanent internal
  // completion marker: owner and timestamp are not unique enough to authorize
  // finalization when two attempts share the same actor and stored second, and
  // retaining it makes response-loss and duplicate same-token retries
  // idempotent. Complete rows never expose or treat this token as an active
  // lease because every lease path also requires state = installing.
  // Rolling upgrades remain bootstrap-owned and keep reconciling old-Worker
  // writes until their first named-menu save.
  await withDbTransaction(transactionEvent, db, async (tx, statements) => {
    await executeDbStatement(tx.update(installation).set({
      state: 'complete',
      owner,
      setupSessionHash: null,
      setupSessionExpiresAt: null,
      leaseToken,
      leaseExpiresAt: null,
      completedAt: now,
      updatedAt: now,
      lastError: null
    }).where(and(
      eq(installation.key, INSTALLATION_KEY),
      eq(installation.leaseToken, leaseToken),
      eq(installation.state, 'installing'),
      exists(tx.select({ id: siteMenuSet.id }).from(siteMenuSet)
        .where(eq(siteMenuSet.id, 'global-navigation')))
    )), statements)

    await executeDbStatement(tx.update(siteMenuSet).set({
      bootstrapOwned: false,
      bootstrapSourceUpdatedAt: null,
      updatedBy: owner,
      updatedAt: now
    }).where(and(
      eq(siteMenuSet.id, 'global-navigation'),
      eq(siteMenuSet.bootstrapOwned, true),
      exists(tx.select({ key: installation.key }).from(installation).where(and(
        eq(installation.key, INSTALLATION_KEY),
        eq(installation.state, 'complete'),
        eq(installation.owner, owner),
        eq(installation.leaseToken, leaseToken)
      )))
    )), statements)
  })

  const completed = await db.select({
    state: installation.state,
    owner: installation.owner,
    leaseToken: installation.leaseToken
  }).from(installation).where(eq(installation.key, INSTALLATION_KEY)).get()
  if (completed?.state !== 'complete'
    || completed.owner !== owner
    || completed.leaseToken !== leaseToken) {
    throw new Error('Installation lease is no longer owned by this request')
  }
  const globalMenu = await db.select({ bootstrapOwned: siteMenuSet.bootstrapOwned })
    .from(siteMenuSet).where(eq(siteMenuSet.id, 'global-navigation')).get()
  if (!globalMenu || globalMenu.bootstrapOwned) throw new Error('Global navigation ownership was not finalized')
}

export async function ensureBootstrapSchema(db: any, createdBy: string, event?: H3Event) {
  const now = new Date()
  const ast = defaultArticleSchemaAst()
  if (ast.schemaKey !== BOOTSTRAP_SCHEMA_KEY) throw new Error('Default Article schema key does not match the bootstrap schema key')
  const version = BOOTSTRAP_SCHEMA_VERSION
  const compiled = compileSchemaAst(ast, version)

  await db
    .insert(schema)
    .values({
      schemaKey: ast.schemaKey,
      version,
      title: ast.title,
      astJson: JSON.stringify(ast),
      jsonSchema: JSON.stringify(compiled.jsonSchema),
      uiSchema: JSON.stringify(compiled.uiSchema),
      registryJson: JSON.stringify(compiled.registry),
      diffJson: JSON.stringify({ from: null, to: 1 }),
      createdBy,
      createdAt: now,
      note: BOOTSTRAP_SCHEMA_NOTE
    })
    .onConflictDoNothing()

  const storedSchema = await db
    .select({
      registryJson: schema.registryJson,
      note: schema.note
    })
    .from(schema)
    .where(and(eq(schema.schemaKey, ast.schemaKey), eq(schema.version, version)))
    .get()

  if (!storedSchema || storedSchema.note !== BOOTSTRAP_SCHEMA_NOTE) return null

  await db
    .insert(schemaActive)
    .values({
      schemaKey: ast.schemaKey,
      activeVersion: 1,
      updatedAt: now
    })
    .onConflictDoNothing()

  const active = await db
    .select({ activeVersion: schemaActive.activeVersion })
    .from(schemaActive)
    .where(eq(schemaActive.schemaKey, ast.schemaKey))
    .get()
  if (!active || active.activeVersion !== version) return null

  const registry = storedSchema.registryJson
    ? JSON.parse(storedSchema.registryJson)
    : compiled.registry

  await ensureAnonymousSchemaRole(db, ast.schemaKey)
  await syncSearchConfig({ db, schemaKey: ast.schemaKey, registry })

  const bootstrapContent = {
    title: 'Welcome guide',
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome to Halopress' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This guide helps you explore the Article schema created during setup.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Next, create your own schemas and start publishing content from the desk.'
            }
          ]
        }
      ]
    }
  }

  const existingContent = await db
    .select({ id: content.id })
    .from(content)
    .where(eq(content.id, BOOTSTRAP_CONTENT_ID))
    .get()

  if (!existingContent) {
    await withDbTransaction(event ?? ({ context: {} } as H3Event), db, async (tx, statements) => {
      await executeDbStatement(tx.insert(content).values({
        id: BOOTSTRAP_CONTENT_ID,
        schemaKey: ast.schemaKey,
        schemaVersion: 1,
        status: 'published',
        contentJson: JSON.stringify(bootstrapContent),
        currentRevision: 1,
        createdBy,
        createdAt: now,
        updatedAt: now
      }), statements)
      await createInitialDocumentRevision({
        tx,
        statements,
        documentKind: 'content',
        documentId: BOOTSTRAP_CONTENT_ID,
        schemaKey: ast.schemaKey,
        state: { snapshot: bootstrapContent, status: 'published', schemaVersion: 1 },
        actorId: createdBy,
        createdAt: now
      })
    })
  }

  const storedContent = await db
    .select()
    .from(content)
    .where(eq(content.id, BOOTSTRAP_CONTENT_ID))
    .get()
  if (!storedContent || storedContent.schemaKey !== ast.schemaKey) return null
  const storedContentJson = parseContentJson(storedContent.contentJson)

  if (existingContent) {
    const initialRevision = await db.select({ id: documentRevision.id })
      .from(documentRevision)
      .where(and(
        eq(documentRevision.documentKind, 'content'),
        eq(documentRevision.documentId, storedContent.id),
        eq(documentRevision.revision, 1)
      ))
      .get()
    if (!initialRevision) {
      await createInitialDocumentRevision({
        tx: db,
        documentKind: 'content',
        documentId: storedContent.id,
        schemaKey: storedContent.schemaKey,
        action: 'backfill',
        state: {
          snapshot: storedContentJson,
          status: storedContent.status,
          schemaVersion: storedContent.schemaVersion
        },
        actorId: storedContent.createdBy,
        createdAt: storedContent.createdAt
      })
    }
  }

  let publishedRevision = await getPublicationRevision(
    db,
    'content',
    storedContent.id,
    storedContent.publishedRevisionId
  )
  if (!publishedRevision && storedContent.status === 'published') {
    await db
      .insert(publicationRevision)
      .values(publicationRevisionValues({
        id: BOOTSTRAP_PUBLICATION_REVISION_ID,
        documentKind: 'content',
        documentId: storedContent.id,
        schemaKey: storedContent.schemaKey,
        schemaVersion: storedContent.schemaVersion,
        content: storedContentJson,
        createdBy,
        createdAt: now
      }))
      .onConflictDoNothing()

    publishedRevision = await getPublicationRevision(
      db,
      'content',
      storedContent.id,
      BOOTSTRAP_PUBLICATION_REVISION_ID
    )
    if (!publishedRevision) throw new Error('Bootstrap publication revision ID is already in use')

    await db
      .update(content)
      .set({
        publishedRevisionId: BOOTSTRAP_PUBLICATION_REVISION_ID,
        firstPublishedAt: storedContent.firstPublishedAt ?? now,
        publishedAt: storedContent.publishedAt ?? now,
        updatedAt: now
      })
      .where(eq(content.id, storedContent.id))
  }

  await syncContentProjections({
    db,
    registry,
    content: storedContentJson,
    contentId: storedContent.id,
    schemaKey: storedContent.schemaKey,
    schemaVersion: storedContent.schemaVersion,
    status: storedContent.status,
    createdAt: storedContent.createdAt,
    updatedAt: storedContent.updatedAt,
    projectionScope: 'working'
  })

  if (publishedRevision) {
    await syncContentProjections({
      db,
      registry,
      content: parseContentJson(publishedRevision.contentJson),
      contentId: storedContent.id,
      schemaKey: storedContent.schemaKey,
      schemaVersion: publishedRevision.schemaVersion ?? storedContent.schemaVersion,
      status: 'published',
      createdAt: storedContent.createdAt,
      updatedAt: publishedRevision.createdAt,
      projectionScope: 'published'
    })
  }

  return ast.schemaKey
}

export type InstallPhase =
  | 'migration_required'
  | 'ready_for_setup'
  | 'installing'
  | 'resume_required'
  | 'complete'

export async function getInstallStatus(db: any, now = new Date()) {
  const requiredTables = [...REQUIRED_INSTALL_TABLES]
  const rows = await db.values(
    sql.raw(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables
        .map(name => `'${name}'`)
        .join(', ')})`
    )
  )
  const existingTables = new Set((rows ?? []).map((row: any[]) => row?.[0]).filter(Boolean))
  const missingTables = requiredTables.filter(name => !existingTables.has(name))

  if (missingTables.length) {
    return {
      ready: false,
      canInstall: false,
      phase: 'migration_required' as const,
      missingTables
    }
  }

  const roleCountRows = await db.values(sql.raw('SELECT COUNT(1) FROM user_role'))
  const userCountRows = await db.values(sql.raw('SELECT COUNT(1) FROM user'))
  const schemaCountRows = await db.values(sql.raw('SELECT COUNT(1) FROM schema'))
  const roleCount = Number(roleCountRows?.[0]?.[0] ?? 0)
  const userCount = Number(userCountRows?.[0]?.[0] ?? 0)
  const schemaCount = Number(schemaCountRows?.[0]?.[0] ?? 0)

  const installRow = await db
    .select({
      state: installation.state,
      leaseToken: installation.leaseToken,
      leaseExpiresAt: installation.leaseExpiresAt,
      lastError: installation.lastError
    })
    .from(installation)
    .where(eq(installation.key, INSTALLATION_KEY))
    .get()

  const complete = installRow?.state === 'complete'
  const leaseActive = installRow?.state === 'installing'
    && Boolean(installRow.leaseToken)
    && Boolean(installRow.leaseExpiresAt && installRow.leaseExpiresAt.getTime() > now.getTime())
  const phase: InstallPhase = complete
    ? 'complete'
    : leaseActive
      ? 'installing'
      : userCount > 0
        ? 'resume_required'
        : 'ready_for_setup'

  return {
    ready: complete,
    canInstall: phase === 'ready_for_setup' || phase === 'resume_required',
    phase,
    missingTables: [],
    roleCount,
    userCount,
    schemaCount,
    hasLastError: Boolean(installRow?.lastError)
  }
}

export async function getRuntimeInstallStatus(db: any, now?: Date) {
  return await getInstallStatus(db, now)
}
