import { eq } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { settings } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { defaultSitePresentation } from '../shared/site-presentation'
import { SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION } from '../shared/site-theme'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

function requestEvent(path = '/api/delivery/site-theme') {
  return {
    path,
    context: {},
    node: {
      req: {
        url: path,
        headers: {
          host: 'press.example.com',
          'x-forwarded-proto': 'https'
        }
      },
      res: {
        setHeader() {},
        getHeader() { return undefined },
        statusCode: 200
      }
    }
  } as any
}

function settingValue(value: unknown, overrides: Record<string, unknown> = {}) {
  return {
    scope: 'global',
    key: 'site.presentation',
    value: JSON.stringify(value),
    valueType: 'json',
    isEncrypted: false,
    groupKey: 'site.presentation',
    updatedBy: 'legacy-admin',
    updatedAt: new Date('2026-07-18T01:00:00.000Z'),
    note: 'Legacy appearance',
    ...overrides
  }
}

async function enableSites(fixture: Awaited<ReturnType<typeof createTestSqliteDb>>) {
  await fixture.db.insert(settings).values({
    scope: 'global',
    key: 'site.mode',
    value: JSON.stringify({ version: 1, enabled: true }),
    valueType: 'json',
    isEncrypted: false,
    groupKey: 'site.mode',
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    note: 'Enabled for Theme tests'
  })
}

afterEach(() => {
  dbState.current = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => vi.restoreAllMocks())

describe('Site Theme durable settings contract', () => {
  it('serves the pinned built-in manifest and CSS without writing when settings storage is missing', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      const {
        getPublicSiteThemeManifest,
        getSiteThemeArtifactCss
      } = await import('../server/utils/site-theme-settings')
      const manifest = await getPublicSiteThemeManifest(requestEvent())
      expect(manifest).toMatchObject({
        contractVersion: 1,
        siteModeEnabled: false,
        stylesheetRevision: SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION,
        stylesheetUrl: `https://press.example.com/_halo/theme/v1/${SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION}.css`
      })
      const css = await getSiteThemeArtifactCss(requestEvent(), manifest.stylesheetRevision)
      expect(css).toContain('HaloPress Theme contract v1')
    } finally {
      fixture.close()
    }
  })

  it('snapshots an advertised artifact once and makes stable public reads write-free', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      const insertSpy = vi.spyOn(fixture.db, 'insert')
      const { getPublicSiteThemeManifest } = await import('../server/utils/site-theme-settings')
      const first = await getPublicSiteThemeManifest(requestEvent())
      expect(insertSpy).toHaveBeenCalledTimes(1)
      expect(await fixture.db.select().from(settings)
        .where(eq(settings.key, `site.theme.artifact.${first.stylesheetRevision}`))).toHaveLength(1)

      insertSpy.mockClear()
      const second = await getPublicSiteThemeManifest(requestEvent())
      expect(second).toEqual(first)
      expect(insertSpy).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })

  it('surfaces malformed active state and fails closed on a conflicting artifact row', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(settings).values({
        ...settingValue({}, {
          key: 'site.theme.active',
          value: '{bad json',
          groupKey: 'site.theme'
        })
      })
      const { getPublicSiteThemeManifest, getSiteThemeAdmin } = await import('../server/utils/site-theme-settings')
      const admin = await getSiteThemeAdmin(requestEvent('/api/settings/theme'))
      expect(admin).toMatchObject({ malformedStoredValue: true, source: 'default' })
      expect((await fixture.db.select().from(settings).where(eq(settings.key, 'site.theme.active')).get())?.value)
        .toBe('{bad json')

      await fixture.db.update(settings).set({ value: 'conflicting bytes' })
        .where(eq(settings.key, `site.theme.artifact.${admin.stylesheetRevision}`))
      await expect(getPublicSiteThemeManifest(requestEvent())).rejects.toThrow('conflicting revision')
    } finally {
      fixture.close()
    }
  })

  it('source-fences malformed active-state repair against a racing legacy Appearance write', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      await fixture.db.insert(settings).values([
        settingValue(defaultSitePresentation()),
        settingValue({}, {
          key: 'site.theme.active',
          value: '{bad json',
          groupKey: 'site.theme'
        })
      ])
      const {
        getSiteThemeAdmin,
        SiteThemeRevisionConflictError,
        updateSiteTheme
      } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent('/api/settings/theme'))
      expect(before.malformedStoredValue).toBe(true)
      const repaired = structuredClone(before.value)
      repaired.colors.light.primary = '#123456'

      await expect(updateSiteTheme(requestEvent('/api/settings/theme'), {
        expectedRevision: before.revision,
        theme: repaired
      }, 'theme-admin', {
        afterResolve: async () => {
          const changed = defaultSitePresentation()
          changed.appearance.primaryColor = 'rose'
          await fixture.db.update(settings).set({
            value: JSON.stringify(changed),
            updatedAt: new Date('2026-07-18T02:00:00.000Z')
          }).where(eq(settings.key, 'site.presentation'))
        }
      })).rejects.toBeInstanceOf(SiteThemeRevisionConflictError)
      expect((await fixture.db.select().from(settings)
        .where(eq(settings.key, 'site.theme.active')).get())?.value).toBe('{bad json')
    } finally {
      fixture.close()
    }
  })

  it('atomically retains the derived legacy artifact, publishes the next artifact, and returns fresh state', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      const legacy = defaultSitePresentation()
      legacy.appearance.primaryColor = 'teal'
      legacy.appearance.colorMode = 'dark'
      await fixture.db.insert(settings).values(settingValue(legacy))

      const {
        getSiteThemeAdmin,
        getSiteThemeArtifactCss,
        updateSiteTheme
      } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent('/api/settings/theme'))
      expect(before).toMatchObject({
        source: 'legacy-appearance',
        bootstrapOwned: true,
        colorMode: 'dark',
        siteModeEnabled: true
      })
      const next = structuredClone(before.value)
      next.colors.light.primary = '#112233'
      const saved = await updateSiteTheme(requestEvent('/api/settings/theme'), {
        expectedRevision: before.revision,
        theme: next
      }, 'theme-admin')
      expect(saved.revision).not.toBe(before.revision)
      expect(saved.value.colors.light.primary).toBe('#112233')
      expect(saved).toMatchObject({ source: 'theme', bootstrapOwned: false, updatedBy: 'theme-admin' })

      expect(await getSiteThemeArtifactCss(requestEvent(), before.stylesheetRevision)).toContain('#00bba7')
      expect(await getSiteThemeArtifactCss(requestEvent(), saved.stylesheetRevision)).toContain('#112233')
      const rows = await fixture.db.select().from(settings)
      expect(rows.filter(row => row.key.startsWith('site.theme.artifact.')).map(row => row.key))
        .toEqual(expect.arrayContaining([
          `site.theme.artifact.${before.stylesheetRevision}`,
          `site.theme.artifact.${saved.stylesheetRevision}`
        ]))
      expect(JSON.parse((rows.find(row => row.key === 'site.theme.active'))!.value)).toMatchObject({
        bootstrapOwned: false,
        mutationToken: expect.any(String)
      })
    } finally {
      fixture.close()
    }
  })

  it('uses document revisions for color-mode concurrency even when CSS bytes are identical', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      const { getSiteThemeAdmin, updateSiteTheme, SiteThemeRevisionConflictError } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent())
      const light = structuredClone(before.value)
      light.colorMode = 'light'
      const saved = await updateSiteTheme(requestEvent(), {
        expectedRevision: before.revision,
        theme: light
      }, 'admin-light')
      expect(saved.revision).not.toBe(before.revision)
      expect(saved.stylesheetRevision).toBe(before.stylesheetRevision)
      await expect(updateSiteTheme(requestEvent(), {
        expectedRevision: before.revision,
        theme: { ...light, colorMode: 'dark' }
      }, 'stale-admin')).rejects.toBeInstanceOf(SiteThemeRevisionConflictError)
    } finally {
      fixture.close()
    }
  })

  it('rejects a legacy source change before cutover, including metadata-only and absent-row races', async () => {
    for (const race of ['value', 'metadata', 'absent'] as const) {
      const fixture = await createTestSqliteDb()
      dbState.current = fixture.db
      vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
      try {
        await runMigrations(fixture.db)
        await enableSites(fixture)
        if (race !== 'absent') await fixture.db.insert(settings).values(settingValue(defaultSitePresentation()))
        const { getSiteThemeAdmin, updateSiteTheme, SiteThemeRevisionConflictError } = await import('../server/utils/site-theme-settings')
        const before = await getSiteThemeAdmin(requestEvent())
        const next = structuredClone(before.value)
        next.colors.light.secondary = '#123456'
        await expect(updateSiteTheme(requestEvent(), {
          expectedRevision: before.revision,
          theme: next
        }, 'theme-admin', {
          afterResolve: async () => {
            if (race === 'absent') {
              await fixture.db.insert(settings).values(settingValue(defaultSitePresentation(), {
                updatedAt: new Date('2026-07-18T02:00:00.000Z')
              }))
            } else if (race === 'metadata') {
              await fixture.db.update(settings).set({ note: 'metadata changed' })
                .where(eq(settings.key, 'site.presentation'))
            } else {
              const changed = defaultSitePresentation()
              changed.appearance.primaryColor = 'rose'
              await fixture.db.update(settings).set({
                value: JSON.stringify(changed),
                updatedAt: new Date('2026-07-18T02:00:00.000Z')
              }).where(eq(settings.key, 'site.presentation'))
            }
          }
        })).rejects.toBeInstanceOf(SiteThemeRevisionConflictError)
        expect(JSON.parse((await fixture.db.select().from(settings)
          .where(eq(settings.key, 'site.theme.active')).get())!.value).bootstrapOwned).toBe(true)
      } finally {
        fixture.close()
        dbState.current = null
      }
    }
  })

  it('accepts a legacy write after successful ownership transfer and rejects identical concurrent losers by token', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      await fixture.db.insert(settings).values(settingValue(defaultSitePresentation()))
      const { getSiteThemeAdmin, updateSiteTheme, SiteThemeRevisionConflictError } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent())
      const next = structuredClone(before.value)
      next.colors.dark.secondary = '#abcdef'
      const saved = await updateSiteTheme(requestEvent(), {
        expectedRevision: before.revision,
        theme: next
      }, 'winner', {
        afterCommit: async () => {
          const changed = defaultSitePresentation()
          changed.appearance.primaryColor = 'rose'
          await fixture.db.update(settings).set({
            value: JSON.stringify(changed),
            updatedAt: new Date('2026-07-18T03:00:00.000Z')
          }).where(eq(settings.key, 'site.presentation'))
        }
      })
      expect(saved.value.colors.dark.secondary).toBe('#abcdef')

      const sameNext = structuredClone(saved.value)
      sameNext.colors.light.info = '#234567'
      await expect(updateSiteTheme(requestEvent(), {
        expectedRevision: saved.revision,
        theme: sameNext
      }, 'loser', {
        afterResolve: async () => {
          await updateSiteTheme(requestEvent(), {
            expectedRevision: saved.revision,
            theme: sameNext
          }, 'winner-2')
        }
      })).rejects.toBeInstanceOf(SiteThemeRevisionConflictError)
      const active = JSON.parse((await fixture.db.select().from(settings)
        .where(eq(settings.key, 'site.theme.active')).get())!.value)
      expect(active.theme.colors.light.info).toBe('#234567')
      expect((await fixture.db.select().from(settings)
        .where(eq(settings.key, 'site.theme.active')).get())!.updatedBy).toBe('winner-2')
    } finally {
      fixture.close()
    }
  })

  it('reconciles bootstrap source identity when presentation metadata changes without token changes', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      await fixture.db.insert(settings).values(settingValue(defaultSitePresentation()))
      const { getSiteThemeAdmin } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent())
      await fixture.db.update(settings).set({
        note: 'unrelated section metadata',
        updatedAt: new Date('2026-07-18T04:00:00.000Z')
      }).where(eq(settings.key, 'site.presentation'))
      const after = await getSiteThemeAdmin(requestEvent())
      expect(after.revision).toBe(before.revision)
      expect(after.bootstrapSourceUpdatedAt).toBe('2026-07-18T04:00:00.000Z')
      const active = JSON.parse((await fixture.db.select().from(settings)
        .where(eq(settings.key, 'site.theme.active')).get())!.value)
      expect(active.bootstrapSourceUpdatedAt).toBe('2026-07-18T04:00:00.000Z')
      expect(active.bootstrapSourceIdentity).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      fixture.close()
    }
  })

  it('cuts off enabled-mode Appearance writes after canonical save and restores legacy shell editing when disabled', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    vi.stubGlobal('useRuntimeConfig', () => ({ canonicalOrigin: 'https://press.example.com' }))
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      await fixture.db.insert(settings).values(settingValue(defaultSitePresentation()))
      const { getSiteThemeAdmin, updateSiteTheme } = await import('../server/utils/site-theme-settings')
      const before = await getSiteThemeAdmin(requestEvent())
      const next = structuredClone(before.value)
      next.colors.light.primary = '#345678'
      const canonical = await updateSiteTheme(requestEvent(), {
        expectedRevision: before.revision,
        theme: next
      }, 'theme-admin')

      const {
        SitePresentationAppearanceMigratedError,
        updateSitePresentation
      } = await import('../server/utils/site-presentation-settings')
      const legacyAppearance = {
        ...defaultSitePresentation().appearance,
        primaryColor: 'rose' as const
      }
      await expect(updateSitePresentation(requestEvent(), {
        appearance: legacyAppearance
      }, 'legacy-admin')).rejects.toBeInstanceOf(SitePresentationAppearanceMigratedError)

      await fixture.db.update(settings).set({
        value: JSON.stringify({ version: 1, enabled: false })
      }).where(eq(settings.key, 'site.mode'))
      const updatedLegacy = await updateSitePresentation(requestEvent(), {
        appearance: legacyAppearance
      }, 'legacy-admin')
      expect(updatedLegacy.value.appearance.primaryColor).toBe('rose')
      expect((await getSiteThemeAdmin(requestEvent())).revision).toBe(canonical.revision)
    } finally {
      fixture.close()
    }
  })

  it('allows the legacy Appearance bootstrap writer while Site is enabled but no canonical Theme exists', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await enableSites(fixture)
      const { updateSitePresentation } = await import('../server/utils/site-presentation-settings')
      const appearance = {
        ...defaultSitePresentation().appearance,
        primaryColor: 'emerald' as const
      }
      const beforeSave = Date.now()
      const response = await updateSitePresentation(requestEvent(), { appearance }, 'legacy-admin')
      const afterSave = Date.now()
      expect(response.value.appearance.primaryColor).toBe('emerald')
      const stored = await fixture.db.select().from(settings).where(eq(settings.key, 'site.presentation')).get()
      expect(stored).toMatchObject({ updatedBy: 'legacy-admin', valueType: 'json', isEncrypted: false })
      expect(stored!.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeSave - 1000)
      expect(stored!.updatedAt.getTime()).toBeLessThanOrEqual(afterSave)
    } finally {
      fixture.close()
    }
  })
})
