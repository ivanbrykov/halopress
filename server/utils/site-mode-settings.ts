import type { H3Event } from 'h3'

import {
  defaultSiteMode,
  siteModeSchema,
  siteModeUpdateSchema,
  type SiteMode
} from '../../shared/site-mode'
import { getSetting, upsertSetting } from './settings'

export const SITE_MODE_SETTING_KEY = 'site.mode'
export const SITE_MODE_GROUP = 'site.mode'

export class SiteModeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteModeValidationError'
  }
}

type ResolvedSiteMode = {
  value: SiteMode
  configured: boolean
  malformedStoredValue: boolean
  updatedAt: Date | null
  updatedBy: string | null
}

export type SiteModeAdminResponse = ResolvedSiteMode & {
  management: {
    source: 'default' | 'desk'
    editable: true
    secret: false
  }
}

export function parseStoredSiteMode(row: Awaited<ReturnType<typeof getSetting>>): ResolvedSiteMode {
  if (!row) {
    return {
      value: defaultSiteMode(),
      configured: false,
      malformedStoredValue: false,
      updatedAt: null,
      updatedBy: null
    }
  }

  if (row.isEncrypted || row.valueType !== 'json') {
    return {
      value: defaultSiteMode(),
      configured: true,
      malformedStoredValue: true,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null
    }
  }

  try {
    const parsed = siteModeSchema.safeParse(JSON.parse(row.value))
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
    // Site mode fails closed so malformed state can never expose Site controls.
  }

  return {
    value: defaultSiteMode(),
    configured: true,
    malformedStoredValue: true,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null
  }
}

async function resolveSiteMode(event?: H3Event) {
  return parseStoredSiteMode(await getSetting('global', SITE_MODE_SETTING_KEY, event))
}

export async function getSiteMode(event?: H3Event): Promise<SiteMode> {
  return (await resolveSiteMode(event)).value
}

export async function getSiteModeAdmin(event: H3Event): Promise<SiteModeAdminResponse> {
  const resolved = await resolveSiteMode(event)
  return {
    ...resolved,
    management: {
      source: resolved.configured ? 'desk' : 'default',
      editable: true,
      secret: false
    }
  }
}

export async function updateSiteMode(
  event: H3Event,
  body: unknown,
  actorId: string | null
): Promise<SiteModeAdminResponse> {
  const parsed = siteModeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new SiteModeValidationError(parsed.error.issues[0]?.message || 'Invalid Site mode settings')
  }

  const value = siteModeSchema.parse({
    version: 1,
    enabled: parsed.data.enabled
  })

  await upsertSetting({
    scope: 'global',
    key: SITE_MODE_SETTING_KEY,
    value: JSON.stringify(value),
    valueType: 'json',
    isEncrypted: false,
    groupKey: SITE_MODE_GROUP,
    updatedBy: actorId,
    note: 'Managed from Desk Site settings'
  }, event)

  return await getSiteModeAdmin(event)
}
