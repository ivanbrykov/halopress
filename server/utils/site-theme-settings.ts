import { createHash, randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, exists, isNull, notExists } from 'drizzle-orm'
import { z } from 'zod'

import {
  SITE_THEME_CONTRACT_VERSION,
  SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION,
  adaptLegacyAppearanceToSiteTheme,
  compileSiteThemeCss,
  defaultSiteTheme,
  siteThemeAccessibilityWarnings,
  siteThemeSchema,
  type PublicSiteThemeManifest,
  type SiteTheme
} from '../../shared/site-theme'
import { getDb } from '../db/db'
import { settings as settingsTable } from '../db/schema'
import { executeDbStatement, withDbTransaction } from '../db/transaction'
import { requireTrustedRequestOrigin } from './request-origin'
import { getSiteMode } from './site-mode-settings'
import { parseStoredSitePresentation } from './site-presentation-settings'
import { getSetting, isSettingsTableReady, type SettingRow } from './settings'

export const SITE_THEME_SETTING_KEY = 'site.theme.active'
export const SITE_THEME_GROUP = 'site.theme'
export const SITE_THEME_ARTIFACT_PREFIX = 'site.theme.artifact.'

const revisionSchema = z.string().regex(/^[0-9a-f]{64}$/)
const siteThemeActiveStateSchema = z.object({
  version: z.literal(SITE_THEME_CONTRACT_VERSION),
  bootstrapOwned: z.boolean(),
  bootstrapSourceUpdatedAt: z.string().datetime().nullable(),
  bootstrapSourceRevision: revisionSchema.nullable(),
  bootstrapSourceIdentity: revisionSchema.nullable().optional(),
  mutationToken: z.string().uuid().nullable().optional(),
  theme: siteThemeSchema
}).strict()
const siteThemeUpdateSchema = z.object({
  expectedRevision: revisionSchema,
  theme: siteThemeSchema
}).strict()

type SiteThemeActiveState = z.output<typeof siteThemeActiveStateSchema>

type ResolvedSiteTheme = {
  value: SiteTheme
  source: 'theme' | 'legacy-appearance' | 'default'
  configured: boolean
  malformedStoredValue: boolean
  legacyAppearanceMalformed: boolean
  bootstrapOwned: boolean
  bootstrapSourceUpdatedAt: string | null
  bootstrapSourceRevision: string | null
  bootstrapSourceIdentity: string | null
  updatedAt: Date | null
  updatedBy: string | null
}

type ResolvedSiteThemeSnapshot = {
  resolved: ResolvedSiteTheme
  activeRow: SettingRow | null
  presentationRow: SettingRow | null
}

export type SiteThemeArtifact = {
  value: SiteTheme
  css: string
  revision: string
  stylesheetRevision: string
  stylesheetPath: string
  warnings: string[]
}

export type SiteThemeAdminResponse = ResolvedSiteTheme & {
  contractVersion: typeof SITE_THEME_CONTRACT_VERSION
  revision: string
  stylesheetRevision: string
  stylesheetUrl: string
  colorMode: SiteTheme['colorMode']
  warnings: string[]
  management: {
    source: ResolvedSiteTheme['source']
    editable: true
    secret: false
  }
}

export class SiteThemeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteThemeValidationError'
  }
}

export class SiteThemeRevisionConflictError extends Error {
  readonly currentRevision: string

  constructor(currentRevision: string) {
    super('The active Theme changed after this editor loaded. Refresh before saving again.')
    this.name = 'SiteThemeRevisionConflictError'
    this.currentRevision = currentRevision
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function activeThemeRevision(theme: SiteTheme) {
  return sha256(JSON.stringify(siteThemeSchema.parse(theme)))
}

function stylesheetRevision(css: string) {
  return sha256(css)
}

export function siteThemeStylesheetPath(revision: string) {
  if (!revisionSchema.safeParse(revision).success) throw new TypeError('Invalid Theme stylesheet revision')
  return `/_halo/theme/v1/${revision}.css`
}

export function buildSiteThemeArtifact(value: SiteTheme): SiteThemeArtifact {
  const theme = siteThemeSchema.parse(value)
  const css = compileSiteThemeCss(theme)
  const cssRevision = stylesheetRevision(css)
  return {
    value: theme,
    css,
    revision: activeThemeRevision(theme),
    stylesheetRevision: cssRevision,
    stylesheetPath: siteThemeStylesheetPath(cssRevision),
    warnings: siteThemeAccessibilityWarnings(theme)
  }
}

function builtInSiteThemeArtifact() {
  const artifact = buildSiteThemeArtifact(defaultSiteTheme())
  if (artifact.stylesheetRevision !== SITE_THEME_BUILTIN_V1_STYLESHEET_REVISION) {
    throw new Error('The source-controlled Theme v1 default artifact changed unexpectedly')
  }
  return artifact
}

function parseActiveThemeRow(row: SettingRow | null) {
  if (!row || row.isEncrypted || row.valueType !== 'json') return null
  try {
    const parsed = siteThemeActiveStateSchema.safeParse(JSON.parse(row.value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function bootstrapTheme(presentationRow: SettingRow | null) {
  const legacy = parseStoredSitePresentation(presentationRow)
  const value = legacy.malformedStoredValue
    ? defaultSiteTheme()
    : adaptLegacyAppearanceToSiteTheme(legacy.value.appearance)
  return {
    value,
    source: legacy.configured && !legacy.malformedStoredValue
      ? 'legacy-appearance' as const
      : 'default' as const,
    legacyAppearanceMalformed: legacy.malformedStoredValue,
    bootstrapSourceUpdatedAt: legacy.updatedAt?.toISOString() ?? null,
    bootstrapSourceRevision: activeThemeRevision(value),
    bootstrapSourceIdentity: presentationRow
      ? sha256(JSON.stringify({
          scope: presentationRow.scope,
          key: presentationRow.key,
          value: presentationRow.value,
          valueType: presentationRow.valueType,
          isEncrypted: presentationRow.isEncrypted,
          groupKey: presentationRow.groupKey ?? null,
          updatedBy: presentationRow.updatedBy ?? null,
          updatedAt: presentationRow.updatedAt.toISOString(),
          note: presentationRow.note ?? null
        }))
      : null,
    updatedAt: legacy.updatedAt,
    updatedBy: legacy.updatedBy
  }
}

export function parseStoredSiteTheme(
  activeRow: SettingRow | null,
  presentationRow: SettingRow | null
): ResolvedSiteTheme {
  const active = parseActiveThemeRow(activeRow)
  if (active && !active.bootstrapOwned) {
    return {
      value: active.theme,
      source: 'theme',
      configured: true,
      malformedStoredValue: false,
      legacyAppearanceMalformed: false,
      bootstrapOwned: false,
      bootstrapSourceUpdatedAt: active.bootstrapSourceUpdatedAt,
      bootstrapSourceRevision: active.bootstrapSourceRevision,
      bootstrapSourceIdentity: active.bootstrapSourceIdentity ?? null,
      updatedAt: activeRow!.updatedAt,
      updatedBy: activeRow!.updatedBy ?? null
    }
  }

  const bootstrap = bootstrapTheme(presentationRow)
  if (active?.bootstrapOwned
    && active.bootstrapSourceRevision === bootstrap.bootstrapSourceRevision
    && active.bootstrapSourceIdentity === bootstrap.bootstrapSourceIdentity) {
    return {
      value: active.theme,
      source: bootstrap.source,
      configured: false,
      malformedStoredValue: false,
      legacyAppearanceMalformed: bootstrap.legacyAppearanceMalformed,
      bootstrapOwned: true,
      bootstrapSourceUpdatedAt: active.bootstrapSourceUpdatedAt,
      bootstrapSourceRevision: active.bootstrapSourceRevision,
      bootstrapSourceIdentity: active.bootstrapSourceIdentity,
      updatedAt: activeRow!.updatedAt,
      updatedBy: activeRow!.updatedBy ?? null
    }
  }

  if (activeRow && !active) {
    return {
      value: defaultSiteTheme(),
      source: 'default',
      configured: false,
      malformedStoredValue: true,
      legacyAppearanceMalformed: false,
      bootstrapOwned: false,
      bootstrapSourceUpdatedAt: null,
      bootstrapSourceRevision: null,
      bootstrapSourceIdentity: null,
      updatedAt: activeRow.updatedAt,
      updatedBy: activeRow.updatedBy ?? null
    }
  }

  return {
    ...bootstrap,
    configured: false,
    malformedStoredValue: false,
    bootstrapOwned: true
  }
}

async function resolveSiteThemeSnapshot(event: H3Event, refresh = false): Promise<ResolvedSiteThemeSnapshot> {
  const cached = (event.context as any).resolvedSiteThemeSnapshot as ResolvedSiteThemeSnapshot | undefined
  if (cached && !refresh) return cached
  const [activeRow, presentationRow] = await Promise.all([
    getSetting('global', SITE_THEME_SETTING_KEY, event),
    getSetting('global', 'site.presentation', event)
  ])
  const snapshot = {
    resolved: parseStoredSiteTheme(activeRow, presentationRow),
    activeRow,
    presentationRow
  }
  ;(event.context as any).resolvedSiteThemeSnapshot = snapshot
  return snapshot
}

async function resolveSiteTheme(event: H3Event) {
  return (await resolveSiteThemeSnapshot(event)).resolved
}

export async function getActiveSiteThemeArtifact(event: H3Event) {
  const cached = (event.context as any).siteThemeArtifact as SiteThemeArtifact | undefined
  if (cached) return cached
  const resolved = await resolveSiteTheme(event)
  const artifact = resolved.source === 'default'
    ? builtInSiteThemeArtifact()
    : buildSiteThemeArtifact(resolved.value)
  ;(event.context as any).siteThemeArtifact = artifact
  return artifact
}

async function ensureSiteThemeBootstrapState(event: H3Event) {
  if (!(await isSettingsTableReady(event))) return await resolveSiteThemeSnapshot(event, true)
  const db = await getDb(event)
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await resolveSiteThemeSnapshot(event, true)
    const active = parseActiveThemeRow(snapshot.activeRow)
    if ((active && !active.bootstrapOwned) || (snapshot.activeRow && !active)) return snapshot

    const artifact = buildSiteThemeArtifact(snapshot.resolved.value)
    const state: SiteThemeActiveState = {
      version: SITE_THEME_CONTRACT_VERSION,
      bootstrapOwned: true,
      bootstrapSourceUpdatedAt: snapshot.resolved.bootstrapSourceUpdatedAt,
      bootstrapSourceRevision: artifact.revision,
      bootstrapSourceIdentity: snapshot.resolved.bootstrapSourceIdentity,
      mutationToken: null,
      theme: artifact.value
    }
    const values = {
      value: JSON.stringify(state),
      valueType: 'json' as const,
      isEncrypted: false,
      groupKey: SITE_THEME_GROUP,
      updatedBy: snapshot.resolved.updatedBy,
      updatedAt: new Date(),
      note: 'Bootstrap-owned adaptation of site.presentation appearance'
    }
    if (!snapshot.activeRow) {
      await db.insert(settingsTable).values({
        scope: 'global',
        key: SITE_THEME_SETTING_KEY,
        ...values
      }).onConflictDoNothing()
    } else if (snapshot.activeRow.value !== values.value) {
      await db.update(settingsTable).set(values).where(and(
        eq(settingsTable.scope, 'global'),
        eq(settingsTable.key, SITE_THEME_SETTING_KEY),
        exactSettingRowPredicate(db, SITE_THEME_SETTING_KEY, snapshot.activeRow)
      ))
    } else {
      return snapshot
    }
  }
  return await resolveSiteThemeSnapshot(event, true)
}

async function ensureSiteThemeArtifactStored(event: H3Event, artifact: SiteThemeArtifact) {
  const key = artifactSettingKey(artifact.stylesheetRevision)
  const existing = await getSetting('global', key, event)
  if (existing) {
    if (existing.isEncrypted || existing.valueType !== 'string'
      || stylesheetRevision(existing.value) !== artifact.stylesheetRevision) {
      throw new Error('The immutable Theme artifact store contains a conflicting revision')
    }
    return
  }

  if (!(await isSettingsTableReady(event))) {
    const builtIn = builtInSiteThemeArtifact()
    if (artifact.revision === builtIn.revision
      && artifact.stylesheetRevision === builtIn.stylesheetRevision
      && artifact.css === builtIn.css) return
    throw new Error('Theme artifact storage is not ready')
  }

  const db = await getDb(event)
  const now = new Date()
  await db.insert(settingsTable).values({
    scope: 'global',
    key,
    value: artifact.css,
    valueType: 'string',
    isEncrypted: false,
    groupKey: `${SITE_THEME_GROUP}.artifacts`,
    updatedBy: null,
    updatedAt: now,
    note: `Immutable HaloPress Theme CSS v${SITE_THEME_CONTRACT_VERSION}`
  }).onConflictDoNothing()
  const stored = await getSetting('global', key, event)
  if (!stored || stored.isEncrypted || stored.valueType !== 'string'
    || stylesheetRevision(stored.value) !== artifact.stylesheetRevision) {
    throw new Error('Unable to retain the advertised Theme stylesheet artifact')
  }
}

export async function getPublicSiteThemeManifest(event: H3Event): Promise<PublicSiteThemeManifest> {
  const origin = requireTrustedRequestOrigin(event)
  const artifact = await getActiveSiteThemeArtifact(event)
  // A digest URL is never advertised until its exact bytes are durable. Once
  // present and verified, steady public reads perform no writes.
  await ensureSiteThemeArtifactStored(event, artifact)
  const siteMode = await getSiteMode(event)
  return {
    contractVersion: SITE_THEME_CONTRACT_VERSION,
    siteModeEnabled: siteMode.enabled,
    revision: artifact.revision,
    stylesheetRevision: artifact.stylesheetRevision,
    stylesheetUrl: new URL(artifact.stylesheetPath, origin).href,
    colorMode: artifact.value.colorMode
  }
}

export async function getSiteThemeAdmin(event: H3Event): Promise<SiteThemeAdminResponse> {
  const resolved = (await ensureSiteThemeBootstrapState(event)).resolved
  const artifact = buildSiteThemeArtifact(resolved.value)
  const manifest = await getPublicSiteThemeManifest(event)
  return {
    ...resolved,
    ...manifest,
    warnings: artifact.warnings,
    management: {
      source: resolved.source,
      editable: true,
      secret: false
    }
  }
}

function artifactSettingKey(revision: string) {
  return `${SITE_THEME_ARTIFACT_PREFIX}${revision}`
}

export async function getSiteThemeArtifactCss(event: H3Event, revisionInput: unknown) {
  const revision = revisionSchema.safeParse(revisionInput)
  if (!revision.success) return null

  const stored = await getSetting('global', artifactSettingKey(revision.data), event)
  if (stored) {
    if (!stored.isEncrypted && stored.valueType === 'string'
      && stylesheetRevision(stored.value) === revision.data) return stored.value
    return null
  }

  const builtIn = builtInSiteThemeArtifact()
  return builtIn.stylesheetRevision === revision.data ? builtIn.css : null
}

function artifactInsert(tx: any, artifact: SiteThemeArtifact, actorId: string | null, now: Date) {
  return tx.insert(settingsTable).values({
    scope: 'global',
    key: artifactSettingKey(artifact.stylesheetRevision),
    value: artifact.css,
    valueType: 'string',
    isEncrypted: false,
    groupKey: `${SITE_THEME_GROUP}.artifacts`,
    updatedBy: actorId,
    updatedAt: now,
    note: `Immutable HaloPress Theme CSS v${SITE_THEME_CONTRACT_VERSION}`
  }).onConflictDoNothing()
}

async function assertArtifactSlotSafe(event: H3Event, artifact: SiteThemeArtifact) {
  const row = await getSetting('global', artifactSettingKey(artifact.stylesheetRevision), event)
  if (!row) return
  if (row.isEncrypted || row.valueType !== 'string'
    || stylesheetRevision(row.value) !== artifact.stylesheetRevision) {
    throw new SiteThemeValidationError('The immutable Theme artifact store contains a conflicting revision')
  }
}

function exactSettingRowPredicate(tx: any, key: string, row: SettingRow | null) {
  const identity = and(
    eq(settingsTable.scope, 'global'),
    eq(settingsTable.key, key)
  )
  if (!row) {
    return notExists(tx.select({ key: settingsTable.key }).from(settingsTable).where(identity))
  }
  return exists(tx.select({ key: settingsTable.key }).from(settingsTable).where(and(
    identity,
    eq(settingsTable.value, row.value),
    eq(settingsTable.valueType, row.valueType),
    eq(settingsTable.isEncrypted, row.isEncrypted),
    eq(settingsTable.updatedAt, row.updatedAt),
    row.groupKey === null || row.groupKey === undefined
      ? isNull(settingsTable.groupKey)
      : eq(settingsTable.groupKey, row.groupKey),
    row.updatedBy === null || row.updatedBy === undefined
      ? isNull(settingsTable.updatedBy)
      : eq(settingsTable.updatedBy, row.updatedBy),
    row.note === null || row.note === undefined
      ? isNull(settingsTable.note)
      : eq(settingsTable.note, row.note)
  )))
}

function exactArtifactPredicate(tx: any, artifact: SiteThemeArtifact) {
  return exists(tx.select({ key: settingsTable.key }).from(settingsTable).where(and(
    eq(settingsTable.scope, 'global'),
    eq(settingsTable.key, artifactSettingKey(artifact.stylesheetRevision)),
    eq(settingsTable.value, artifact.css),
    eq(settingsTable.valueType, 'string'),
    eq(settingsTable.isEncrypted, false)
  )))
}

export async function updateSiteTheme(
  event: H3Event,
  body: unknown,
  actorId: string | null,
  options: { afterResolve?: () => Promise<void>, afterCommit?: () => Promise<void> } = {}
): Promise<SiteThemeAdminResponse> {
  const parsed = siteThemeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new SiteThemeValidationError(parsed.error.issues[0]?.message || 'Invalid Theme document')
  }

  const snapshot = await ensureSiteThemeBootstrapState(event)
  const current = snapshot.resolved
  const currentArtifact = buildSiteThemeArtifact(current.value)
  if (parsed.data.expectedRevision !== currentArtifact.revision) {
    throw new SiteThemeRevisionConflictError(currentArtifact.revision)
  }
  await options.afterResolve?.()

  const nextArtifact = buildSiteThemeArtifact(parsed.data.theme)
  await Promise.all([
    assertArtifactSlotSafe(event, currentArtifact),
    assertArtifactSlotSafe(event, nextArtifact)
  ])
  const currentRow = snapshot.activeRow
  if (!currentRow) throw new SiteThemeValidationError('Theme storage is not ready')
  const currentState = parseActiveThemeRow(currentRow)
  const sourceFenceRequired = currentState?.bootstrapOwned === true || current.malformedStoredValue
  const mutationToken = randomUUID()
  const activeState: SiteThemeActiveState = {
    version: SITE_THEME_CONTRACT_VERSION,
    bootstrapOwned: false,
    bootstrapSourceUpdatedAt: current.bootstrapSourceUpdatedAt,
    bootstrapSourceRevision: current.bootstrapSourceRevision,
    bootstrapSourceIdentity: current.bootstrapSourceIdentity,
    mutationToken,
    theme: nextArtifact.value
  }
  const activeJson = JSON.stringify(activeState)
  const db = await getDb(event)
  const now = new Date()

  await withDbTransaction(event, db, async (tx, statements) => {
    // Append the currently visible artifact before switching. Cached envelopes
    // may already reference a derived legacy/default digest.
    await executeDbStatement(artifactInsert(tx, currentArtifact, actorId, now), statements)
    await executeDbStatement(artifactInsert(tx, nextArtifact, actorId, now), statements)

    const activeValues = {
      value: activeJson,
      valueType: 'json',
      isEncrypted: false,
      groupKey: SITE_THEME_GROUP,
      updatedBy: actorId,
      updatedAt: now,
      note: 'Managed from Desk Site Themes'
    }
    await executeDbStatement(tx.update(settingsTable).set(activeValues).where(and(
      eq(settingsTable.scope, 'global'),
      eq(settingsTable.key, SITE_THEME_SETTING_KEY),
      exactSettingRowPredicate(tx, SITE_THEME_SETTING_KEY, currentRow),
      exactArtifactPredicate(tx, currentArtifact),
      exactArtifactPredicate(tx, nextArtifact),
      sourceFenceRequired
        ? exactSettingRowPredicate(tx, 'site.presentation', snapshot.presentationRow)
        : undefined
    )), statements)
  })
  await options.afterCommit?.()

  const persisted = await getSetting('global', SITE_THEME_SETTING_KEY, event)
  const persistedState = parseActiveThemeRow(persisted)
  if (!persistedState || persistedState.bootstrapOwned
    || activeThemeRevision(persistedState.theme) !== nextArtifact.revision
    || persistedState.mutationToken !== mutationToken) {
    delete (event.context as any).resolvedSiteThemeSnapshot
    delete (event.context as any).siteThemeArtifact
    const latest = parseStoredSiteTheme(
      persisted,
      await getSetting('global', 'site.presentation', event)
    )
    throw new SiteThemeRevisionConflictError(buildSiteThemeArtifact(latest.value).revision)
  }

  delete (event.context as any).resolvedSiteThemeSnapshot
  delete (event.context as any).siteThemeArtifact
  return await getSiteThemeAdmin(event)
}
