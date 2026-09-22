import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, inArray, notExists, sql } from 'drizzle-orm'

import {
  defaultSitePresentation,
  sitePresentationPatchSchema,
  sitePresentationSchema,
  toPublicSitePresentation,
  type PublicNavigationLeaf,
  type PublicSiteFooterLink,
  type PublicSitePresentation,
  type SitePresentation,
  type SitePresentationAdminValue
} from '../../shared/site-presentation'
import { syncDocumentAssetRefs } from '../cms/asset-refs'
import { getDb } from '../db/db'
import { asset as assetTable, settings as settingsTable } from '../db/schema'
import { getSetting, upsertSetting } from './settings'
import { siteThemeSchema } from '../../shared/site-theme'
import { getSiteMode } from './site-mode-settings'
import {
  getGlobalSiteMenuDocument,
  resolveAnonymousReadableNavigationTargets,
  resolvePublicSiteMenu
} from './site-menus'

export const SITE_PRESENTATION_SETTING_KEY = 'site.presentation'
export const SITE_PRESENTATION_GROUP = 'site.presentation'

export class SitePresentationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SitePresentationValidationError'
  }
}

export class SitePresentationNavigationMigratedError extends Error {
  readonly menuId = 'global-navigation'
  readonly location = '/_desk/site/menus'

  constructor() {
    super('Navigation is managed as the Global navigation menu set. Save it from Site > Menus.')
    this.name = 'SitePresentationNavigationMigratedError'
  }
}

export class SitePresentationAppearanceMigratedError extends Error {
  readonly location = '/_desk/site/themes'

  constructor() {
    super('Appearance is managed by the active HaloPress Theme. Save it from Site > Themes.')
    this.name = 'SitePresentationAppearanceMigratedError'
  }
}

async function hasCanonicalSiteTheme(event: H3Event) {
  const row = await getSetting('global', 'site.theme.active', event)
  if (!row || row.isEncrypted || row.valueType !== 'json') return false
  try {
    const value = JSON.parse(row.value)
    return value?.version === 1
      && value?.bootstrapOwned === false
      && siteThemeSchema.safeParse(value?.theme).success
  } catch {
    return false
  }
}

function canonicalThemeRowQuery(db: any) {
  return db.select({ key: settingsTable.key }).from(settingsTable).where(and(
    eq(settingsTable.scope, 'global'),
    eq(settingsTable.key, 'site.theme.active'),
    eq(settingsTable.valueType, 'json'),
    eq(settingsTable.isEncrypted, false),
    sql`json_valid(${settingsTable.value})`,
    sql`json_extract(${settingsTable.value}, '$.version') = 1`,
    sql`json_extract(${settingsTable.value}, '$.bootstrapOwned') = 0`,
    sql`json_extract(${settingsTable.value}, '$.theme.version') = 1`
  ))
}

type ResolvedSitePresentation = {
  value: SitePresentation
  configured: boolean
  malformedStoredValue: boolean
  updatedAt: Date | null
  updatedBy: string | null
}

export type SitePresentationAdminResponse = Omit<ResolvedSitePresentation, 'value'> & {
  value: SitePresentationAdminValue
  management: {
    source: 'default' | 'desk'
    editable: true
    secret: false
  }
  missingAssetIds: string[]
}

function brandingAssetIds(value: SitePresentation) {
  return [
    value.general.logoAssetId,
    value.general.faviconAssetId,
    value.general.socialImageAssetId
  ].filter((assetId): assetId is string => Boolean(assetId))
}

function revisionFor(value: unknown) {
  const input = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function parseStoredSitePresentation(row: Awaited<ReturnType<typeof getSetting>>): ResolvedSitePresentation {
  if (!row) {
    return {
      value: defaultSitePresentation(),
      configured: false,
      malformedStoredValue: false,
      updatedAt: null,
      updatedBy: null
    }
  }

  if (row.isEncrypted || row.valueType !== 'json') {
    return {
      value: defaultSitePresentation(),
      configured: true,
      malformedStoredValue: true,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null
    }
  }

  try {
    const parsed = sitePresentationSchema.safeParse(JSON.parse(row.value))
    if (parsed.success) {
      return {
        value: parsed.data,
        configured: true,
        malformedStoredValue: false,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null
      }
    }
  } catch {
    // Fall through to the intentional, public-safe defaults.
  }

  return {
    value: defaultSitePresentation(),
    configured: true,
    malformedStoredValue: true,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null
  }
}

async function resolveSitePresentation(event: H3Event) {
  return parseStoredSitePresentation(await getSetting('global', SITE_PRESENTATION_SETTING_KEY, event))
}

async function availableBrandingAssetIds(event: H3Event, value: SitePresentation) {
  const ids = [...new Set(brandingAssetIds(value))]
  if (!ids.length) return new Set<string>()

  const db = await getDb(event)
  const rows = await db.select({
    id: assetTable.id,
    kind: assetTable.kind,
    status: assetTable.status,
    mimeType: assetTable.mimeType
  }).from(assetTable).where(inArray(assetTable.id, ids))

  return new Set<string>(rows
    .filter((row: { kind: string, status: string, mimeType: string }) => row.kind === 'image' && row.status === 'ready' && row.mimeType.startsWith('image/'))
    .map((row: { id: string }) => row.id))
}

export async function getSitePresentationAdmin(event: H3Event): Promise<SitePresentationAdminResponse> {
  const resolved = await resolveSitePresentation(event)
  const availableIds = await availableBrandingAssetIds(event, resolved.value)
  const missingAssetIds = brandingAssetIds(resolved.value).filter(assetId => !availableIds.has(assetId))
  const navigation = await getGlobalSiteMenuDocument(event, resolved.value.navigation.items)
  return {
    ...resolved,
    value: {
      ...resolved.value,
      navigation: { items: navigation.items }
    },
    management: {
      source: resolved.configured ? 'desk' : 'default',
      editable: true,
      secret: false
    },
    missingAssetIds
  }
}

function resolvePublicFooterLink(item: PublicNavigationLeaf, to: string): PublicSiteFooterLink {
  return {
    ...item,
    to
  }
}

export async function getPublicSitePresentation(event: H3Event): Promise<PublicSitePresentation> {
  const resolved = await resolveSitePresentation(event)
  const availableIds = await availableBrandingAssetIds(event, resolved.value)
  const presentation = toPublicSitePresentation(resolved.value, availableIds, 'pending')
  const menu = await resolvePublicSiteMenu(event, resolved.value.navigation.items)
  const destinations = resolved.value.footer.links.map(item => item.destination)
  const footerTargets = await resolveAnonymousReadableNavigationTargets(event, destinations)
  const projected: PublicSitePresentation = {
    version: presentation.version,
    revision: presentation.revision,
    general: presentation.general,
    appearance: presentation.appearance,
    shell: presentation.shell,
    navigation: menu.document,
    footer: {
      variant: presentation.footer.variant,
      copyright: presentation.footer.copyright,
      showRoute: presentation.footer.showRoute,
      links: resolved.value.footer.links.flatMap((item, index) => {
        const to = footerTargets[index]
        return to ? [resolvePublicFooterLink(item, to)] : []
      })
    }
  }
  const { revision: _pendingRevision, ...revisionInput } = projected
  return { ...projected, revision: revisionFor(revisionInput) }
}

/** Public branding only; unlike the full legacy presentation it resolves no Menu or footer targets. */
export async function getPublicSiteIdentity(event: H3Event) {
  const resolved = await resolveSitePresentation(event)
  const availableIds = await availableBrandingAssetIds(event, resolved.value)
  const presentation = toPublicSitePresentation(resolved.value, availableIds, 'pending')
  const identity = {
    siteName: presentation.general.siteName,
    description: presentation.general.description,
    locale: presentation.general.locale,
    logoUrl: presentation.general.logoUrl,
    faviconUrl: presentation.general.faviconUrl,
    socialImageUrl: presentation.general.socialImageUrl
  }
  return {
    ...identity,
    revision: createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  }
}

export async function updateSitePresentation(
  event: H3Event,
  body: unknown,
  actorId: string | null
): Promise<SitePresentationAdminResponse> {
  if (body && typeof body === 'object' && Object.hasOwn(body, 'navigation')) {
    throw new SitePresentationNavigationMigratedError()
  }
  const appearancePatch = Boolean(body && typeof body === 'object' && Object.hasOwn(body, 'appearance'))
  let modeEnabled = false
  if (appearancePatch) {
    const [mode, canonicalTheme] = await Promise.all([
      getSiteMode(event),
      hasCanonicalSiteTheme(event)
    ])
    modeEnabled = mode.enabled
    if (mode.enabled && canonicalTheme) throw new SitePresentationAppearanceMigratedError()
  }
  const parsedPatch = sitePresentationPatchSchema.safeParse(body)
  if (!parsedPatch.success) {
    throw new SitePresentationValidationError(parsedPatch.error.issues[0]?.message || 'Invalid site presentation settings')
  }

  const currentRow = await getSetting('global', SITE_PRESENTATION_SETTING_KEY, event)
  const current = parseStoredSitePresentation(currentRow)
  const nextResult = sitePresentationSchema.safeParse({
    ...current.value,
    ...parsedPatch.data
  })
  if (!nextResult.success) {
    throw new SitePresentationValidationError(nextResult.error.issues[0]?.message || 'Invalid site presentation settings')
  }
  const next = nextResult.data
  const availableIds = await availableBrandingAssetIds(event, next)
  const missingAssetIds = brandingAssetIds(next).filter(assetId => !availableIds.has(assetId))
  if (missingAssetIds.length) {
    throw new SitePresentationValidationError(`Choose ready image assets for branding: ${missingAssetIds.join(', ')}`)
  }

  const db = await getDb(event)
  const nextJson = JSON.stringify(next)
  if (appearancePatch && modeEnabled) {
    const now = new Date()
    const values = {
      value: nextJson,
      valueType: 'json' as const,
      isEncrypted: false,
      groupKey: SITE_PRESENTATION_GROUP,
      updatedBy: actorId,
      updatedAt: now,
      note: 'Managed from Desk site presentation settings'
    }
    if (currentRow) {
      await db.update(settingsTable).set(values).where(and(
        eq(settingsTable.scope, 'global'),
        eq(settingsTable.key, SITE_PRESENTATION_SETTING_KEY),
        eq(settingsTable.value, currentRow.value),
        eq(settingsTable.updatedAt, currentRow.updatedAt),
        notExists(canonicalThemeRowQuery(db))
      ))
    } else {
      await db.insert(settingsTable).select(db.select({
        scope: sql<string>`${'global'}`,
        key: sql<string>`${SITE_PRESENTATION_SETTING_KEY}`,
        value: sql<string>`${nextJson}`,
        valueType: sql<string>`${'json'}`,
        isEncrypted: sql<boolean>`0`,
        groupKey: sql<string>`${SITE_PRESENTATION_GROUP}`,
        updatedBy: actorId === null ? sql<string | null>`null` : sql<string>`${actorId}`,
        updatedAt: sql<Date>`${sql.param(now, settingsTable.updatedAt)}`,
        note: sql<string>`${'Managed from Desk site presentation settings'}`
      }).from(settingsTable).where(and(
        eq(settingsTable.scope, 'global'),
        eq(settingsTable.key, 'site.mode'),
        notExists(canonicalThemeRowQuery(db))
      )).limit(1)).onConflictDoNothing()
    }
    const stored = await getSetting('global', SITE_PRESENTATION_SETTING_KEY, event)
    if (!stored || stored.value !== nextJson) throw new SitePresentationAppearanceMigratedError()
  } else {
    await upsertSetting({
      scope: 'global',
      key: SITE_PRESENTATION_SETTING_KEY,
      value: nextJson,
      valueType: 'json',
      isEncrypted: false,
      groupKey: SITE_PRESENTATION_GROUP,
      updatedBy: actorId,
      note: 'Managed from Desk site presentation settings'
    }, event)
  }

  await syncDocumentAssetRefs({
    db,
    documentKind: 'settings',
    documentId: SITE_PRESENTATION_SETTING_KEY,
    projectionScope: 'published',
    content: null,
    additionalAssetIds: brandingAssetIds(next)
  })

  return await getSitePresentationAdmin(event)
}
