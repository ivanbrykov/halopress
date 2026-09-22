import { eq, sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  GLOBAL_SITE_MENU_ID,
  SITE_MENU_ICONS,
  publicSiteMenuDocumentSchema,
  siteMenuDocumentSchema,
  siteMenuItemValue,
  siteMenuNameKey,
  type SiteMenuDocument
} from '../shared/site-menu'
import { defaultSitePresentation } from '../shared/site-presentation'
import {
  page,
  publicationRevision,
  publicRoute,
  settings,
  siteMenuReference,
  siteMenuSet
} from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => {
  vi.restoreAllMocks()
})

function document(items: SiteMenuDocument['items']): SiteMenuDocument {
  return { version: 1, items }
}

const aboutItem = {
  id: 'about-item',
  label: 'About',
  destination: { type: 'page' as const, pageId: 'about-page' },
  value: 'about-stable',
  icon: SITE_MENU_ICONS[0],
  badge: 'New',
  children: [{
    id: 'about-team',
    label: 'Team',
    destination: { type: 'content' as const, schemaKey: 'people', contentId: 'team-content' }
  }]
}

describe('Site menu contracts', () => {
  it('accepts only the HaloPress-owned serializable one-level subset', () => {
    expect(siteMenuDocumentSchema.parse(document([aboutItem]))).toEqual(document([aboutItem]))
    expect(siteMenuItemValue(aboutItem)).toBe('about-stable')
    expect(siteMenuItemValue({ ...aboutItem, value: undefined })).toBe('about-item')

    const rejected = [
      { ...aboutItem, onSelect: () => {} },
      { ...aboutItem, to: { name: 'unsafe-router-object' } },
      { ...aboutItem, class: 'text-red-500' },
      { ...aboutItem, ui: { link: 'unsafe' } },
      { ...aboutItem, icon: 'i-lucide-not-in-the-allowlist' },
      { ...aboutItem, badge: { color: 'error' } },
      { ...aboutItem, destination: { type: 'external', url: 'javascript:alert(1)', newWindow: false } },
      { ...aboutItem, children: [{ ...aboutItem.children[0], children: [] }] }
    ]
    for (const item of rejected) {
      expect(siteMenuDocumentSchema.safeParse(document([item as any])).success).toBe(false)
    }

    expect(siteMenuDocumentSchema.safeParse(document([
      aboutItem,
      { ...aboutItem, id: 'other-id', value: 'about-stable', children: [] }
    ])).success).toBe(false)
    expect(siteMenuDocumentSchema.safeParse(document([
      aboutItem,
      { ...aboutItem, value: 'other-value', children: [{ ...aboutItem.children[0] }] }
    ])).success).toBe(false)

    const resolvedDocument = {
      version: 1 as const,
      items: [{
        id: 'about-item',
        label: 'About',
        to: '/company/about',
        value: 'about-stable',
        icon: SITE_MENU_ICONS[0],
        badge: 'New',
        children: []
      }]
    }
    expect(publicSiteMenuDocumentSchema.parse(resolvedDocument)).toEqual(resolvedDocument)
    expect(siteMenuDocumentSchema.safeParse(resolvedDocument).success).toBe(false)
    expect(publicSiteMenuDocumentSchema.safeParse(document([aboutItem])).success).toBe(false)
  })

  it('derives a Unicode-normalized full case-folded name identity', () => {
    expect(siteMenuNameKey('  Älpha  ')).toBe('älpha')
    expect(siteMenuNameKey('Café')).toBe(siteMenuNameKey('Cafe\u0301'))
    expect(siteMenuNameKey('Straße')).toBe(siteMenuNameKey('STRASSE'))
    expect(siteMenuNameKey('Σ')).toBe(siteMenuNameKey('ς'))
    expect(siteMenuNameKey('σ')).toBe(siteMenuNameKey('ς'))
    expect(siteMenuNameKey('\u1FC3')).toBe('ηι')
    expect(siteMenuNameKey('\u03B7\u0345')).toBe('ηι')
  })
})

describe('Site menu persistence', () => {
  it('supports audited CRUD, atomic validation, unique names, and actionable deletion guards', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const {
        SiteMenuInUseError,
        SiteMenuNameConflictError,
        SiteMenuValidationError,
        createSiteMenu,
        deleteSiteMenu,
        listSiteMenus,
        updateSiteMenu
      } = await import('../server/utils/site-menus')

      const initial = await listSiteMenus({} as any)
      expect(initial.defaultMenuId).toBe(GLOBAL_SITE_MENU_ID)
      expect(initial.items).toEqual([
        expect.objectContaining({
          id: GLOBAL_SITE_MENU_ID,
          name: 'Global navigation',
          document: { version: 1, items: [] },
          canDelete: false,
          usage: [{
            resourceType: 'public-site-shell',
            resourceId: 'default-public-site',
            label: 'Built-in public Site navigation'
          }]
        })
      ])

      const created = await createSiteMenu({} as any, { name: 'Footer links' }, 'admin-1')
      expect(created).toMatchObject({ name: 'Footer links', createdBy: 'admin-1', updatedBy: 'admin-1', canDelete: true })
      await expect(createSiteMenu({} as any, { name: 'footer LINKS' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)

      const unicode = await createSiteMenu({} as any, { name: 'Älpha' }, 'admin-1')
      expect(unicode.name).toBe('Älpha')
      await expect(createSiteMenu({} as any, { name: 'älpha' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)
      await createSiteMenu({} as any, { name: 'Café' }, 'admin-1')
      await expect(createSiteMenu({} as any, { name: 'Cafe\u0301' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)
      await createSiteMenu({} as any, { name: 'Straße links' }, 'admin-1')
      await expect(createSiteMenu({} as any, { name: 'STRASSE LINKS' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)
      await createSiteMenu({} as any, { name: 'Σ menu' }, 'admin-1')
      await expect(createSiteMenu({} as any, { name: 'ς MENU' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)

      const saved = await updateSiteMenu({} as any, created.id, {
        name: 'Company links',
        document: document([aboutItem])
      }, 'admin-2')
      expect(saved).toMatchObject({
        id: created.id,
        name: 'Company links',
        updatedBy: 'admin-2',
        document: document([aboutItem])
      })
      const storedBeforeFailure = await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, created.id)).get()

      await expect(updateSiteMenu({} as any, created.id, {
        name: 'Partially invalid',
        document: document([
          aboutItem,
          { ...aboutItem, id: 'other', value: aboutItem.value, children: [] }
        ])
      }, 'admin-3')).rejects.toMatchObject({
        name: SiteMenuValidationError.name,
        issues: [expect.objectContaining({
          path: 'document.items.1.value',
          message: expect.stringContaining('must be unique')
        })]
      })

      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, created.id)).get())
        .toEqual(storedBeforeFailure)
      await expect(deleteSiteMenu({} as any, GLOBAL_SITE_MENU_ID)).rejects.toMatchObject({
        name: SiteMenuInUseError.name,
        usage: [expect.objectContaining({ resourceType: 'public-site-shell' })]
      })

      const referenceTime = new Date('2026-07-18T00:00:00.000Z')
      await fixture.db.insert(siteMenuReference).values({
        ownerType: 'site-layout',
        ownerId: 'layout-1',
        slot: 'header',
        menuSetId: created.id,
        label: 'Marketing layout header',
        createdAt: referenceTime,
        updatedAt: referenceTime
      })
      await expect(deleteSiteMenu({} as any, created.id)).rejects.toMatchObject({
        name: SiteMenuInUseError.name,
        usage: [{
          resourceType: 'site-layout',
          resourceId: 'layout-1',
          label: 'Marketing layout header'
        }]
      })
      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, created.id)).get()).toBeTruthy()
      await fixture.db.delete(siteMenuReference).where(eq(siteMenuReference.menuSetId, created.id))
      await expect(deleteSiteMenu({} as any, created.id)).resolves.toEqual({ deleted: true, id: created.id })
      expect(await fixture.db.select().from(siteMenuSet).where(eq(siteMenuSet.id, created.id))).toEqual([])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('repairs a malformed persisted name key deterministically without changing the Unicode display name', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createSiteMenu, listSiteMenus } = await import('../server/utils/site-menus')
      const created = await createSiteMenu({} as any, { name: 'Straße archive' }, 'admin-1')
      await fixture.db.update(siteMenuSet).set({ nameKey: 'malformed-legacy-key' })
        .where(eq(siteMenuSet.id, created.id))

      const listed = await listSiteMenus({} as any)
      expect(listed.items.find(item => item.id === created.id)?.name).toBe('Straße archive')
      expect(await fixture.db.select({ name: siteMenuSet.name, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, created.id)).get()).toEqual({
        name: 'Straße archive',
        nameKey: 'strasse archive'
      })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('atomically repairs swapped normalized keys through collision-free temporary keys', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createSiteMenu, listSiteMenus } = await import('../server/utils/site-menus')
      const alpha = await createSiteMenu({} as any, { name: 'Alpha' }, 'admin-1')
      const beta = await createSiteMenu({} as any, { name: 'Beta' }, 'admin-1')
      await fixture.db.update(siteMenuSet).set({ nameKey: 'temporary-swap-key' })
        .where(eq(siteMenuSet.id, alpha.id))
      await fixture.db.update(siteMenuSet).set({ nameKey: 'alpha' })
        .where(eq(siteMenuSet.id, beta.id))
      await fixture.db.update(siteMenuSet).set({ nameKey: 'beta' })
        .where(eq(siteMenuSet.id, alpha.id))

      await expect(listSiteMenus({} as any)).resolves.toEqual(expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: alpha.id, name: 'Alpha' }),
          expect.objectContaining({ id: beta.id, name: 'Beta' })
        ])
      }))
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, alpha.id)).get()).toEqual({ id: alpha.id, nameKey: 'alpha' })
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, beta.id)).get()).toEqual({ id: beta.id, nameKey: 'beta' })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('repairs full-case-fold duplicates deterministically until either resource is renamed', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const {
        SiteMenuNameConflictError,
        createSiteMenu,
        listSiteMenus,
        updateSiteMenu
      } = await import('../server/utils/site-menus')
      const first = await createSiteMenu({} as any, { name: 'Straße' }, 'admin-1')
      const second = await createSiteMenu({} as any, { name: 'Temporary name' }, 'admin-1')
      await fixture.db.update(siteMenuSet).set({ nameKey: 'legacy-first-key' })
        .where(eq(siteMenuSet.id, first.id))
      await fixture.db.update(siteMenuSet).set({
        name: 'STRASSE',
        nameKey: 'legacy-second-key'
      }).where(eq(siteMenuSet.id, second.id))

      const duplicated = await listSiteMenus({} as any)
      expect(duplicated.items.filter(item => [first.id, second.id].includes(item.id)).map(item => item.name))
        .toEqual(expect.arrayContaining(['Straße', 'STRASSE']))
      const conflictRows = await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet)
      const firstConflictKey = conflictRows.find(row => row.id === first.id)!.nameKey
      const secondConflictKey = conflictRows.find(row => row.id === second.id)!.nameKey
      expect(firstConflictKey).not.toBe(secondConflictKey)
      expect(firstConflictKey.startsWith('halopress:reserved:site-menu-name-conflict:')).toBe(true)
      expect(secondConflictKey.startsWith('halopress:reserved:site-menu-name-conflict:')).toBe(true)

      await expect(createSiteMenu({} as any, { name: 'strasse' }, 'admin-2'))
        .rejects.toBeInstanceOf(SiteMenuNameConflictError)
      await updateSiteMenu({} as any, first.id, {
        name: 'Renamed unique menu',
        document: first.document
      }, 'admin-2')

      await listSiteMenus({} as any)
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, first.id)).get())
        .toEqual({ id: first.id, nameKey: 'renamed unique menu' })
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, second.id)).get())
        .toEqual({ id: second.id, nameKey: 'strasse' })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rolls back every key move when a later repair statement fails', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { createSiteMenu, listSiteMenus } = await import('../server/utils/site-menus')
      const alpha = await createSiteMenu({} as any, { name: 'Alpha rollback' }, 'admin-1')
      const beta = await createSiteMenu({} as any, { name: 'Beta rollback' }, 'admin-1')
      await fixture.db.update(siteMenuSet).set({ nameKey: 'legacy-alpha-key' })
        .where(eq(siteMenuSet.id, alpha.id))
      await fixture.db.update(siteMenuSet).set({ nameKey: 'legacy-beta-key' })
        .where(eq(siteMenuSet.id, beta.id))
      await fixture.db.run(sql.raw(`
        CREATE TRIGGER fail_site_menu_name_repair
        BEFORE UPDATE OF name_key ON site_menu_set
        WHEN NEW.name_key = 'beta rollback'
        BEGIN
          SELECT RAISE(ABORT, 'forced name repair failure');
        END
      `))

      await expect(listSiteMenus({} as any)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringContaining('forced name repair failure') })
      })
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, alpha.id)).get())
        .toEqual({ id: alpha.id, nameKey: 'legacy-alpha-key' })
      expect(await fixture.db.select({ id: siteMenuSet.id, nameKey: siteMenuSet.nameKey })
        .from(siteMenuSet).where(eq(siteMenuSet.id, beta.id)).get())
        .toEqual({ id: beta.id, nameKey: 'legacy-beta-key' })
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('falls back intentionally for malformed documents and for rolling deploys without the table', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { listSiteMenus } = await import('../server/utils/site-menus')
      await listSiteMenus({} as any)
      await fixture.db.update(siteMenuSet).set({
        documentJson: '{bad json',
        bootstrapOwned: false,
        bootstrapSourceUpdatedAt: null
      })
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID))
      const { getGlobalSiteMenuDocument } = await import('../server/utils/site-menus')
      expect(await listSiteMenus({} as any)).toMatchObject({
        items: [{ id: GLOBAL_SITE_MENU_ID, malformedStoredValue: true, document: { version: 1, items: [] } }]
      })

      const wrappedMissingTable = Object.assign(new Error('Failed query'), {
        cause: new Error('D1_ERROR: no such table: site_menu_set: SQLITE_ERROR')
      })
      dbState.current = {
        select: () => ({
          from: () => ({
            where: () => ({ get: async () => { throw wrappedMissingTable } })
          })
        })
      }
      await expect(getGlobalSiteMenuDocument({} as any, [aboutItem]))
        .resolves.toEqual(document([aboutItem]))
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})

describe('Global navigation compatibility and cache revision', () => {
  it('creates the lazy Global menu and public reference in one D1 batch', async () => {
    const fixture = await createTestSqliteDb()
    try {
      await runMigrations(fixture.db)
      const batch = vi.fn(async (statements: any[]) => {
        for (const statement of statements) await statement
      })
      const d1Db = new Proxy(fixture.db, {
        get(target, property, receiver) {
          if (property === 'batch') return batch
          if (property === 'transaction') return vi.fn(() => {
            throw new Error('D1 bootstrap must use an atomic batch')
          })
          return Reflect.get(target, property, receiver)
        }
      })
      const event = { context: { cloudflare: { env: { DB: {} } } } } as any
      const { ensureGlobalSiteMenu } = await import('../server/utils/site-menus')
      const global = await ensureGlobalSiteMenu(event, d1Db)

      expect(global).toMatchObject({
        id: GLOBAL_SITE_MENU_ID,
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: null
      })
      expect(batch).toHaveBeenCalledOnce()
      expect(batch.mock.calls[0]![0]).toHaveLength(2)
      expect(await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID))).toHaveLength(1)
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toHaveLength(1)
    } finally {
      fixture.close()
    }
  })

  it('keeps a settled bootstrap-owned public read write-free while admin access repairs its reference', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const {
        ensureGlobalSiteMenu,
        getGlobalSiteMenuDocument,
        listSiteMenus
      } = await import('../server/utils/site-menus')
      await ensureGlobalSiteMenu({} as any, fixture.db, { repairReference: true })
      await fixture.db.delete(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))

      const writes: string[] = []
      const trackedDb = new Proxy(fixture.db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (!['insert', 'update', 'delete', 'batch'].includes(String(property)) || typeof value !== 'function') {
            return value
          }
          return (...args: unknown[]) => {
            writes.push(String(property))
            return value.apply(target, args)
          }
        }
      })
      dbState.current = trackedDb

      await expect(getGlobalSiteMenuDocument({} as any, []))
        .resolves.toEqual({ version: 1, items: [] })
      expect(writes).toEqual([])
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toEqual([])
      expect(await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID)).get()).toMatchObject({
        bootstrapOwned: true
      })

      await listSiteMenus({} as any)
      expect(writes).toContain('insert')
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('keeps cut-over public reads write-free while admin access repairs a missing reference', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const {
        getGlobalSiteMenuDocument,
        listSiteMenus,
        updateSiteMenu
      } = await import('../server/utils/site-menus')
      await updateSiteMenu({} as any, GLOBAL_SITE_MENU_ID, {
        name: 'Global navigation',
        document: document([aboutItem])
      }, 'named-menu-admin')
      await fixture.db.delete(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))

      const writes: string[] = []
      const trackedDb = new Proxy(fixture.db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (!['insert', 'update', 'delete', 'batch'].includes(String(property)) || typeof value !== 'function') {
            return value
          }
          return (...args: unknown[]) => {
            writes.push(String(property))
            return value.apply(target, args)
          }
        }
      })
      dbState.current = trackedDb

      await expect(getGlobalSiteMenuDocument({} as any, [])).resolves.toEqual(document([aboutItem]))
      expect(writes).toEqual([])
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toEqual([])

      await listSiteMenus({} as any)
      expect(writes).toContain('insert')
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toHaveLength(1)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('reconciles legacy Global navigation before resolving a persisted Layout menu', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const staleAt = new Date('2026-07-18T00:00:00.000Z')
      const legacyAt = new Date('2026-07-18T00:30:00.000Z')
      const staleDocument = document([{
        id: 'stale-layout-home',
        label: 'Stale Layout home',
        destination: { type: 'home' },
        children: []
      }])
      const legacyDocument = document([{
        id: 'fresh-layout-home',
        label: 'Fresh legacy home',
        destination: { type: 'home' },
        children: []
      }])
      await fixture.db.insert(siteMenuSet).values({
        id: GLOBAL_SITE_MENU_ID,
        name: 'Global navigation',
        nameKey: siteMenuNameKey('Global navigation'),
        documentJson: JSON.stringify(staleDocument),
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: staleAt,
        createdBy: 'migration',
        updatedBy: 'migration',
        createdAt: staleAt,
        updatedAt: staleAt
      })
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.presentation',
        value: JSON.stringify({
          ...defaultSitePresentation(),
          navigation: { items: legacyDocument.items }
        }),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.presentation',
        updatedBy: 'old-worker-admin',
        updatedAt: legacyAt
      })

      const { parseStoredSiteMenu, resolvePublicLayoutMenus } = await import('../server/utils/site-menus')
      const projection = (await resolvePublicLayoutMenus({} as any, [GLOBAL_SITE_MENU_ID], {
        context: {
          visibility: 'public',
          documentKind: 'page',
          documentId: 'layout-home-page',
          schemaKey: null,
          schemaVersion: null,
          canonicalPath: '/'
        }
      })).get(GLOBAL_SITE_MENU_ID)

      expect(projection).toMatchObject({
        status: 'ready',
        document: {
          items: [{ label: 'Fresh legacy home', to: '/' }]
        }
      })
      const stored = await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID)).get()
      expect(stored).toMatchObject({
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: legacyAt,
        updatedBy: 'old-worker-admin'
      })
      expect(parseStoredSiteMenu(stored! as any).document).toEqual(legacyDocument)
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('reconciles a newer legacy save across the read/commit interleaving until the first named-menu save', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const migrationTime = new Date('2026-07-18T00:00:00.000Z')
      const legacySaveTime = new Date('2026-07-18T00:30:00.000Z')
      const staleDocument = document([{
        id: 'migration-seed',
        label: 'Stale migration snapshot',
        destination: { type: 'home' },
        children: []
      }])
      await fixture.db.insert(siteMenuSet).values({
        id: GLOBAL_SITE_MENU_ID,
        name: 'Global navigation',
        nameKey: siteMenuNameKey('Global navigation'),
        documentJson: JSON.stringify(staleDocument),
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: migrationTime,
        createdBy: 'migration',
        updatedBy: 'migration',
        createdAt: migrationTime,
        updatedAt: migrationTime
      })
      const firstLegacy = {
        ...defaultSitePresentation(),
        navigation: { items: [aboutItem] }
      }
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.presentation',
        value: JSON.stringify(firstLegacy),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.presentation',
        updatedBy: 'old-worker-admin',
        updatedAt: legacySaveTime
      })

      const interleavedDocument = document([{
        id: 'interleaved-save',
        label: 'Saved during bootstrap',
        destination: { type: 'home' },
        children: []
      }])
      const interleavedAt = new Date('2026-07-18T00:45:00.000Z')
      let insertedInterleaving = false
      const { ensureGlobalSiteMenu, parseStoredSiteMenu, updateSiteMenu, getGlobalSiteMenuDocument } = await import('../server/utils/site-menus')
      const reconciled = await ensureGlobalSiteMenu({} as any, fixture.db, {
        afterLegacyRead: async () => {
          if (insertedInterleaving) return
          insertedInterleaving = true
          await fixture.db.update(settings).set({
            value: JSON.stringify({
              ...defaultSitePresentation(),
              navigation: { items: interleavedDocument.items }
            }),
            updatedBy: 'interleaved-old-worker',
            updatedAt: interleavedAt
          }).where(eq(settings.key, 'site.presentation'))
        }
      })
      expect(parseStoredSiteMenu(reconciled).document).toEqual(interleavedDocument)
      expect(reconciled).toMatchObject({
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: interleavedAt,
        updatedBy: 'interleaved-old-worker'
      })
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toEqual([])

      const unrelatedSettingsAt = new Date('2026-07-18T00:50:00.000Z')
      await fixture.db.update(settings).set({
        value: JSON.stringify({
          ...defaultSitePresentation(),
          brandName: 'Appearance-only change',
          navigation: { items: interleavedDocument.items }
        }),
        updatedBy: 'appearance-admin',
        updatedAt: unrelatedSettingsAt
      }).where(eq(settings.key, 'site.presentation'))
      const sourceAdvanced = await ensureGlobalSiteMenu({} as any, fixture.db)
      expect(sourceAdvanced).toMatchObject({
        bootstrapOwned: true,
        bootstrapSourceUpdatedAt: unrelatedSettingsAt,
        updatedAt: interleavedAt,
        updatedBy: 'interleaved-old-worker'
      })

      await updateSiteMenu({} as any, GLOBAL_SITE_MENU_ID, {
        name: 'Global navigation',
        document: document([aboutItem])
      }, 'named-menu-admin')
      expect(await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID)).get()).toMatchObject({
        bootstrapOwned: false,
        bootstrapSourceUpdatedAt: null,
        updatedBy: 'named-menu-admin'
      })
      expect(await fixture.db.select().from(siteMenuReference)
        .where(eq(siteMenuReference.menuSetId, GLOBAL_SITE_MENU_ID))).toHaveLength(1)

      await fixture.db.update(settings).set({
        value: JSON.stringify({ ...firstLegacy, navigation: { items: [] } }),
        updatedAt: new Date('2026-07-18T01:00:00.000Z')
      }).where(eq(settings.key, 'site.presentation'))
      expect(await getGlobalSiteMenuDocument({} as any, [])).toEqual(document([aboutItem]))
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('reads Global through the legacy presentation projection but rejects legacy navigation writes', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-18T00:00:00.000Z')
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.presentation',
        value: JSON.stringify({
          ...defaultSitePresentation(),
          navigation: { items: [{
            id: 'stale-legacy',
            label: 'Stale legacy value',
            destination: { type: 'home' },
            children: []
          }] }
        }),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.presentation',
        updatedBy: 'legacy-admin',
        updatedAt: now
      })
      const { updateSiteMenu } = await import('../server/utils/site-menus')
      await updateSiteMenu({} as any, GLOBAL_SITE_MENU_ID, {
        name: 'Global navigation',
        document: document([aboutItem])
      }, 'menu-admin')

      const {
        SitePresentationNavigationMigratedError,
        getSitePresentationAdmin,
        updateSitePresentation
      } = await import('../server/utils/site-presentation-settings')
      expect((await getSitePresentationAdmin({} as any)).value.navigation.items).toEqual([aboutItem])
      await expect(updateSitePresentation({} as any, {
        navigation: { items: [] }
      }, 'legacy-client')).rejects.toBeInstanceOf(SitePresentationNavigationMigratedError)
      expect(JSON.parse(String((await fixture.db.select().from(siteMenuSet)
        .where(eq(siteMenuSet.id, GLOBAL_SITE_MENU_ID)).get())!.documentJson))).toEqual(document([aboutItem]))

      const routeSource = await readFile(resolve(import.meta.dirname, '../server/api/settings/site-presentation.put.ts'), 'utf8')
      expect(routeSource).toContain('location: error.location')
      expect(routeSource).toContain('conflict(error.message')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('changes the public revision and ETag input when a canonical menu target changes', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const now = new Date('2026-07-18T00:00:00.000Z')
      const presentation = defaultSitePresentation()
      presentation.footer.links = [
        { id: 'about-footer', label: 'About', destination: { type: 'page', pageId: 'about-page' } },
        { id: 'private-footer', label: 'Private', destination: { type: 'page', pageId: 'private-page' } }
      ]
      await fixture.db.insert(settings).values({
        scope: 'global',
        key: 'site.presentation',
        value: JSON.stringify(presentation),
        valueType: 'json',
        isEncrypted: false,
        groupKey: 'site.presentation',
        updatedBy: 'admin-1',
        updatedAt: now
      })
      const { updateSiteMenu } = await import('../server/utils/site-menus')
      await updateSiteMenu({} as any, GLOBAL_SITE_MENU_ID, {
        name: 'Global navigation',
        document: document([
          { ...aboutItem, children: [] },
          {
            id: 'private-menu',
            label: 'Private',
            destination: { type: 'page', pageId: 'private-page' },
            children: []
          }
        ])
      }, 'admin-1')
      await fixture.db.insert(publicationRevision).values({
        id: 'publication-about-page',
        documentKind: 'page',
        documentId: 'about-page',
        title: 'Published About',
        contentJson: JSON.stringify({ type: 'doc', content: [] }),
        createdAt: now
      })
      await fixture.db.insert(page).values([
        {
          id: 'about-page',
          title: 'Working About',
          status: 'published',
          contentJson: JSON.stringify({ type: 'doc', content: [] }),
          publishedRevisionId: 'publication-about-page',
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'private-page',
          title: 'Private draft',
          status: 'draft',
          contentJson: JSON.stringify({ type: 'doc', content: [] }),
          createdAt: now,
          updatedAt: now
        }
      ])
      await fixture.db.insert(publicRoute).values([
        {
          path: '/about',
          routeKind: 'canonical',
          documentKind: 'page',
          documentId: 'about-page',
          schemaKey: null,
          seoJson: null,
          createdAt: now,
          updatedAt: now
        },
        {
          path: '/private-page',
          routeKind: 'canonical',
          documentKind: 'page',
          documentId: 'private-page',
          schemaKey: null,
          seoJson: null,
          createdAt: now,
          updatedAt: now
        }
      ])

      const { getPublicSitePresentation } = await import('../server/utils/site-presentation-settings')
      const before = await getPublicSitePresentation({} as any)
      expect(before.navigation.items[0]!.to).toBe('/about')
      expect(before.navigation.items.map(item => item.id)).toEqual(['about-item'])
      expect(before.footer.links).toEqual([
        expect.objectContaining({ id: 'about-footer', to: '/about' })
      ])
      expect(JSON.stringify(before)).not.toContain('private-page')

      await fixture.db.update(publicRoute).set({ path: '/company/about', updatedAt: new Date('2026-07-18T01:00:00.000Z') })
        .where(eq(publicRoute.path, '/about'))
      const after = await getPublicSitePresentation({} as any)
      expect(after.navigation.items[0]!.to).toBe('/company/about')
      expect(after.revision).not.toBe(before.revision)

      const deliveryRoute = await readFile(resolve(import.meta.dirname, '../server/api/delivery/site-presentation.get.ts'), 'utf8')
      expect(deliveryRoute).toContain('setHeader(event, \'ETag\', `"${presentation.revision}"`)')
    } finally {
      fixture.close()
      dbState.current = null
    }
  })
})
