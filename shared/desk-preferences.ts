export const DESK_COLOR_MODE_PREFERENCES = ['system', 'light', 'dark'] as const

export type DeskColorModePreference = typeof DESK_COLOR_MODE_PREFERENCES[number]

export function normalizeDeskColorModePreference(value: unknown): DeskColorModePreference {
  return DESK_COLOR_MODE_PREFERENCES.includes(value as DeskColorModePreference)
    ? value as DeskColorModePreference
    : 'system'
}
