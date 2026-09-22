import { eq, inArray } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  defaultSiteMode,
  siteModeSchema,
  siteModeUpdateSchema
} from '../shared/site-mode'
import { settings } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => {
  vi.restoreAllMocks()
})

describe('Site mode settings', () => {
  it('uses a strict, versioned, disabled-by-default contract', () => {
    expect(defaultSiteMode()).toEqual({ version: 1, enabled: false })
    expect(siteModeSchema.safeParse({ version: 1, enabled: true }).success).toBe(true)
    expect(siteModeSchema.safeParse({ version: 2, enabled: true }).success).toBe(false)
    expect(siteModeSchema.safeParse({ version: 1, enabled: 'false' }).success).toBe(false)
    expect(siteModeSchema.safeParse({ version: 1, enabled: false, extra: true }).success).toBe(false)
    expect(siteModeUpdateSchema.safeParse({ enabled: true }).success).toBe(true)
    expect(siteModeUpdateSchema.safeParse({ enabled: true, version: 1 }).success).toBe(false)
  })

  it('fails closed for every malformed stored representation', async () => {
    const { parseStoredSiteMode } = await import('../server/utils/site-mode-settings')
    const row = {
      scope: 'global',
      key: 'site.mode',
      value: JSON.stringify({ version: 1, enabled: true }),
      valueType: 'json' as const,
      isEncrypted: false,
      updatedAt: new Date('2026-07-18T00:00:00.000Z'),
      updatedBy: 'admin-1'
    }

    expect(parseStoredSiteMode(null)).toEqual({
      value: defaultSiteMode(),
      configured: false,
      malformedStoredValue: false,
      updatedAt: null,
      updatedBy: null
    })
    expect(parseStoredSiteMode(row)).toMatchObject({
      value: { version: 1, enabled: true },
      configured: true,
      malformedStoredValue: false
    })

    for (const malformed of [
      { ...row, value: '{bad json' },
      { ...row, value: JSON.stringify({ version: 2, enabled: true }) },
      { ...row, value: JSON.stringify({ version: 1, enabled: true, extra: true }) },
      { ...row, value: JSON.stringify({ version: 1, enabled: 'false' }) },
      { ...row, valueType: 'boolean' as const, value: 'true' },
      { ...row, isEncrypted: true, value: 'ciphertext' }
    ]) {
      expect(parseStoredSiteMode(malformed)).toMatchObject({
        value: defaultSiteMode(),
        configured: true,
        malformedStoredValue: true,
        updatedAt: row.updatedAt,
        updatedBy: 'admin-1'
      })
    }
  })

  it('stores audited transitions without changing other Site settings', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const unchangedRows = [
        {
          scope: 'global',
          key: 'site.presentation',
          value: '{"version":1,"sentinel":"presentation"}',
          valueType: 'json',
          isEncrypted: false,
          groupKey: 'site.presentation',
          updatedBy: 'admin-before',
          updatedAt: new Date('2026-07-17T00:00:00.000Z'),
          note: 'Existing presentation'
        },
        {
          scope: 'global',
          key: 'site.layout.future',
          value: '{"version":1,"sentinel":"layout"}',
          valueType: 'json',
          isEncrypted: false,
          groupKey: 'site.layout',
          updatedBy: 'admin-before',
          updatedAt: new Date('2026-07-17T00:00:00.000Z'),
          note: 'Future Layout resource'
        }
      ]
      await fixture.db.insert(settings).values(unchangedRows)

      const { getSiteMode, updateSiteMode } = await import('../server/utils/site-mode-settings')
      await expect(getSiteMode({} as any)).resolves.toEqual(defaultSiteMode())

      for (const enabled of [true, false, true]) {
        const response = await updateSiteMode({} as any, { enabled }, 'admin-2')
        expect(response).toMatchObject({
          value: { version: 1, enabled },
          configured: true,
          malformedStoredValue: false,
          management: { source: 'desk', editable: true, secret: false }
        })
      }

      expect(await fixture.db.select().from(settings).where(eq(settings.key, 'site.mode')).get())
        .toMatchObject({
          value: JSON.stringify({ version: 1, enabled: true }),
          valueType: 'json',
          isEncrypted: false,
          groupKey: 'site.mode',
          updatedBy: 'admin-2',
          note: 'Managed from Desk Site settings'
        })

      const preserved = await fixture.db.select().from(settings)
        .where(inArray(settings.key, unchangedRows.map(row => row.key)))
      expect(preserved
        .map(row => ({ key: row.key, value: row.value, note: row.note }))
        .sort((left, right) => left.key.localeCompare(right.key)))
        .toEqual(unchangedRows
          .map(row => ({ key: row.key, value: row.value, note: row.note }))
          .sort((left, right) => left.key.localeCompare(right.key)))
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('rejects invalid updates without writing a row', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      const { SiteModeValidationError, updateSiteMode } = await import('../server/utils/site-mode-settings')

      await expect(updateSiteMode({} as any, { enabled: 'false' }, 'admin-1'))
        .rejects.toBeInstanceOf(SiteModeValidationError)
      await expect(updateSiteMode({} as any, { enabled: true, extra: true }, 'admin-1'))
        .rejects.toBeInstanceOf(SiteModeValidationError)
      expect(await fixture.db.select().from(settings).where(eq(settings.key, 'site.mode'))).toEqual([])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('protects administrator routes before body or settings access and has no public mode endpoint', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [getRoute, putRoute] = await Promise.all([
      readFile(resolve(root, 'server/api/settings/site-mode.get.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/settings/site-mode.put.ts'), 'utf8')
    ])

    expect(getRoute.indexOf('await requireAdmin(event)')).toBeLessThan(getRoute.indexOf('getSiteModeAdmin(event)'))
    expect(putRoute.indexOf('await requireAdmin(event)')).toBeLessThan(putRoute.indexOf('readBody(event)'))
    expect(existsSync(resolve(root, 'server/api/delivery/site-mode.get.ts'))).toBe(false)
  })
})
