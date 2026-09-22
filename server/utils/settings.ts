import type { H3Event } from 'h3'
import { and, desc, eq, sql } from 'drizzle-orm'

import { getDb } from '../db/db'
import { settings as settingsTable } from '../db/schema'
import { decryptString, encryptString } from './crypto'

export type SettingValueType = 'string' | 'json' | 'boolean' | 'number'

export type SettingRow = {
  scope: string
  key: string
  value: string
  valueType: SettingValueType
  isEncrypted: boolean
  groupKey?: string | null
  updatedBy?: string | null
  updatedAt: Date
  note?: string | null
}

type SettingInput = {
  scope?: string
  key: string
  value: string
  valueType?: SettingValueType
  isEncrypted?: boolean
  groupKey?: string | null
  updatedBy?: string | null
  note?: string | null
  encryptionKey?: string
}

function parseValue(value: string, valueType: SettingValueType): string | number | boolean | unknown | null {
  if (valueType === 'boolean') return value === 'true' || value === '1'
  if (valueType === 'number') return Number(value)
  if (valueType === 'json') {
    try {
      return JSON.parse(value)
    } catch (error) {
      console.error('[settings] Failed to parse JSON value', error)
      return null
    }
  }
  return value
}

export async function getSetting(scope: string, key: string, event?: H3Event): Promise<SettingRow | null> {
  const db = await getDb(event)
  try {
    const row = await db
      .select({
        scope: settingsTable.scope,
        key: settingsTable.key,
        value: settingsTable.value,
        valueType: settingsTable.valueType,
        isEncrypted: settingsTable.isEncrypted,
        groupKey: settingsTable.groupKey,
        updatedBy: settingsTable.updatedBy,
        updatedAt: settingsTable.updatedAt,
        note: settingsTable.note
      })
      .from(settingsTable)
      .where(and(eq(settingsTable.scope, scope), eq(settingsTable.key, key)))
      .get()
    return row ?? null
  } catch (error) {
    if (isMissingSettingsTableError(error)) return null
    throw error
  }
}

export async function isSettingsTableReady(event?: H3Event) {
  try {
    const db = await getDb(event)
    const rows = await db.values(
      sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'settings\'')
    )
    return Boolean(rows?.[0]?.[0])
  } catch {
    return false
  }
}

export async function getSettingsGroupUpdatedAt(
  groupKey: string,
  scope = 'global',
  event?: H3Event
): Promise<Date | null> {
  if (!(await isSettingsTableReady(event))) return null
  try {
    const db = await getDb(event)
    const row = await db
      .select({ updatedAt: settingsTable.updatedAt })
      .from(settingsTable)
      .where(and(eq(settingsTable.scope, scope), eq(settingsTable.groupKey, groupKey)))
      .orderBy(desc(settingsTable.updatedAt))
      .limit(1)
      .get()
    return row?.updatedAt ?? null
  } catch (error) {
    if (isMissingSettingsTableError(error)) return null
    throw error
  }
}

export async function getSettingValue<T = string>(
  scope: string,
  key: string,
  options?: { decryptKey?: string },
  event?: H3Event
): Promise<T | null> {
  const row = await getSetting(scope, key, event)
  if (!row) return null
  return await resolveSettingValue(row, options)
}

export async function resolveSettingValue<T = string>(
  row: SettingRow,
  options?: { decryptKey?: string }
): Promise<T | null> {
  let raw = row.value
  if (row.isEncrypted) {
    const decryptKey = options?.decryptKey
    if (!decryptKey) {
      console.warn('[settings] Missing decryption key for setting', row.key)
      return null
    }
    try {
      raw = await decryptString(raw, decryptKey)
    } catch (error) {
      console.warn('[settings] Failed to decrypt setting', row.key, error)
      return null
    }
  }
  return parseValue(raw, row.valueType) as T | null
}

export async function upsertSetting(input: SettingInput, event?: H3Event) {
  const scope = input.scope ?? 'global'
  const valueType = input.valueType ?? 'string'
  const isEncrypted = Boolean(input.isEncrypted)
  const updatedAt = new Date()
  let value = input.value

  if (isEncrypted) {
    value = await encryptString(value, input.encryptionKey || '')
  }

  const db = await getDb(event)
  await db.insert(settingsTable)
    .values({
      scope,
      key: input.key,
      value,
      valueType,
      isEncrypted,
      groupKey: input.groupKey ?? null,
      updatedBy: input.updatedBy ?? null,
      updatedAt,
      note: input.note ?? null
    })
    .onConflictDoUpdate({
      target: [settingsTable.scope, settingsTable.key],
      set: {
        value,
        valueType,
        isEncrypted,
        groupKey: input.groupKey ?? null,
        updatedBy: input.updatedBy ?? null,
        updatedAt,
        note: input.note ?? null
      }
    })
}

function isMissingSettingsTableError(error: unknown) {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = current instanceof Error
      ? current.message
      : typeof current === 'object' && 'message' in current
        ? String((current as { message?: unknown }).message || '')
        : String(current)
    if (message.includes('no such table: settings')) return true
    current = typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return false
}
