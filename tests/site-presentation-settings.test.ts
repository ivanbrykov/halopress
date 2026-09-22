import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  SITE_NEUTRAL_COLORS,
  SITE_PRIMARY_COLORS,
  defaultSitePresentation,
  resolvePublicNavigationTarget,
  siteThemePresetTokens,
  sitePresentationPatchSchema,
  sitePresentationSchema,
  toPublicSitePresentation
} from '../shared/site-presentation'
import { asset, documentAssetRef, settings } from '../server/db/schema'
import { runMigrations } from '../server/utils/install'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

afterAll(() => {
  vi.restoreAllMocks()
})

describe('site presentation settings', () => {
  it('keeps display labels out of persisted preset tokens', () => {
    const appearance = {
      ...defaultSitePresentation().appearance,
      ...siteThemePresetTokens('editorial')
    }

    expect(appearance).toEqual({
      preset: 'editorial',
      primaryColor: 'indigo',
      neutralColor: 'slate',
      typographyScale: 'relaxed',
      radius: 'lg',
      colorMode: 'system'
    })
    expect(sitePresentationPatchSchema.safeParse({ appearance }).success).toBe(true)
  })

  it('keeps every configurable palette available to the production CSS build', async () => {
    const css = await readFile(resolve(import.meta.dirname, '../app/assets/css/main.css'), 'utf8')

    for (const color of [...SITE_PRIMARY_COLORS, ...SITE_NEUTRAL_COLORS]) {
      for (const shade of [50, 500, 950]) {
        expect(css).toContain(`--color-${color}-${shade}:`)
      }
    }
  })

  it('preserves the existing HaloPress presentation as the default', () => {
    expect(defaultSitePresentation()).toEqual({
      version: 1,
      general: {
        siteName: 'HaloPress',
        description: 'A batteries-included, schema-driven CMS for structured publishing.',
        locale: 'en',
        logoAssetId: null,
        faviconAssetId: null,
        socialImageAssetId: null
      },
      appearance: {
        preset: 'halo',
        primaryColor: 'purple',
        neutralColor: 'zinc',
        typographyScale: 'default',
        radius: 'md',
        colorMode: 'system'
      },
      shell: {
        width: 'default',
        headerVariant: 'standard',
        showDeskLink: true,
        showColorMode: true
      },
      navigation: { items: [] },
      footer: { variant: 'route', copyright: '', showRoute: true, links: [] }
    })
  })

  it('rejects unsafe URLs, arbitrary colors, duplicate IDs, and extra fields', () => {
    expect(sitePresentationPatchSchema.safeParse({
      navigation: {
        items: [{
          id: 'bad-link',
          label: 'Bad',
          destination: { type: 'external', url: 'javascript:alert(1)', newWindow: false },
          children: []
        }]
      }
    }).success).toBe(false)

    expect(sitePresentationPatchSchema.safeParse({
      appearance: { ...defaultSitePresentation().appearance, primaryColor: 'yellow' }
    }).success).toBe(false)

    expect(sitePresentationPatchSchema.safeParse({
      navigation: {
        items: [{
          id: 'same',
          label: 'Parent',
          destination: { type: 'home' },
          children: [{ id: 'same', label: 'Child', destination: { type: 'home' } }]
        }]
      }
    }).success).toBe(false)

    expect(sitePresentationSchema.safeParse({ ...defaultSitePresentation(), secret: 'leak' }).success).toBe(false)
  })

  it('resolves typed internal destinations without storing raw paths', () => {
    expect(resolvePublicNavigationTarget({ type: 'home' })).toBe('/')
    expect(resolvePublicNavigationTarget({ type: 'page', pageId: 'about' })).toBe('/p/about')
    expect(resolvePublicNavigationTarget({ type: 'collection', schemaKey: 'news' })).toBe('/news/')
    expect(resolvePublicNavigationTarget({ type: 'content', schemaKey: 'news', contentId: 'launch' }))
      .toBe('/news/launch')
  })

  it('returns only the explicit public projection and falls back for missing assets', () => {
    const value = defaultSitePresentation()
    value.general.logoAssetId = 'missing-logo'
    value.general.faviconAssetId = 'favicon'
    value.general.socialImageAssetId = 'social'
    value.footer.links = [{
      id: 'privacy',
      label: 'Privacy',
      destination: { type: 'page', pageId: 'privacy-page' }
    }]
    const projected = toPublicSitePresentation(value, new Set(['favicon']), 'v1-test')

    expect(projected.general).toMatchObject({
      logoUrl: null,
      faviconUrl: '/assets/favicon/raw',
      socialImageUrl: '/branding/halopress-social-card.png'
    })
    expect(JSON.stringify(projected)).not.toContain('AssetId')
    expect(JSON.stringify(projected)).not.toContain('updatedBy')
    expect(projected.footer.links[0]).toEqual({
      id: 'privacy',
      label: 'Privacy',
      destination: { type: 'page', pageId: 'privacy-page' },
      to: '/p/privacy-page'
    })
  })

  it('falls back intentionally when a stored row is malformed or encrypted', async () => {
    const { parseStoredSitePresentation } = await import('../server/utils/site-presentation-settings')
    const baseRow = {
      scope: 'global',
      key: 'site.presentation',
      value: '{bad json',
      valueType: 'json' as const,
      isEncrypted: false,
      updatedAt: new Date('2026-07-14T00:00:00.000Z')
    }
    expect(parseStoredSitePresentation(baseRow)).toMatchObject({
      value: defaultSitePresentation(),
      configured: true,
      malformedStoredValue: true
    })
    expect(parseStoredSitePresentation({ ...baseRow, value: 'ciphertext', isEncrypted: true })).toMatchObject({
      value: defaultSitePresentation(),
      malformedStoredValue: true
    })
  })

  it('treats a wrapped D1 missing-table error as an unconfigured setting', async () => {
    const missingTable = Object.assign(new Error('Failed query: select from settings'), {
      cause: new Error('D1_ERROR: no such table: settings: SQLITE_ERROR')
    })
    dbState.current = {
      select: () => ({
        from: () => ({
          where: () => ({ get: async () => { throw missingTable } })
        })
      })
    }
    try {
      const { getSetting } = await import('../server/utils/settings')
      await expect(getSetting('global', 'site.presentation')).resolves.toBeNull()
    } finally {
      dbState.current = null
    }
  })

  it('stores an audited JSON document and retains branding assets for public delivery', async () => {
    const fixture = await createTestSqliteDb()
    dbState.current = fixture.db
    try {
      await runMigrations(fixture.db)
      await fixture.db.insert(asset).values({
        id: 'brand-logo',
        kind: 'image',
        status: 'ready',
        objectKey: 'assets/brand-logo/original',
        mimeType: 'image/png',
        sizeBytes: 120,
        createdAt: new Date('2026-07-14T00:00:00.000Z')
      })
      const { updateSitePresentation } = await import('../server/utils/site-presentation-settings')
      const result = await updateSitePresentation({} as any, {
        general: {
          ...defaultSitePresentation().general,
          siteName: 'Example Press',
          logoAssetId: 'brand-logo'
        }
      }, 'admin-1')

      expect(result).toMatchObject({
        configured: true,
        malformedStoredValue: false,
        management: { source: 'desk', editable: true, secret: false },
        value: { general: { siteName: 'Example Press', logoAssetId: 'brand-logo' } }
      })
      expect(await fixture.db.select().from(settings).where(eq(settings.key, 'site.presentation')).get())
        .toMatchObject({
          valueType: 'json',
          isEncrypted: false,
          groupKey: 'site.presentation',
          updatedBy: 'admin-1'
        })
      expect(await fixture.db.select().from(documentAssetRef).where(eq(documentAssetRef.assetId, 'brand-logo')))
        .toEqual([{
          documentKind: 'settings',
          documentId: 'site.presentation',
          projectionScope: 'published',
          assetId: 'brand-logo'
        }])
    } finally {
      fixture.close()
      dbState.current = null
    }
  })

  it('keeps administrator routes protected and the delivery route explicitly public-safe', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [getRoute, putRoute, publicRoute] = await Promise.all([
      readFile(resolve(root, 'server/api/settings/site-presentation.get.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/settings/site-presentation.put.ts'), 'utf8'),
      readFile(resolve(root, 'server/api/delivery/site-presentation.get.ts'), 'utf8')
    ])

    expect(getRoute.indexOf('await requireAdmin(event)')).toBeLessThan(getRoute.indexOf('getSitePresentationAdmin(event)'))
    expect(putRoute.indexOf('await requireAdmin(event)')).toBeLessThan(putRoute.indexOf('readBody(event)'))
    expect(publicRoute).not.toContain('requireAdmin')
    expect(publicRoute).toContain('max-age=0, must-revalidate')
    expect(publicRoute).toContain('presentation.revision')
  })
})
