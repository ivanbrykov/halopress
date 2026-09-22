<script setup lang="ts">
import { DESK_COLOR_MODE_PREFERENCES } from '~~/shared/desk-preferences'

definePageMeta({ layout: 'desk' })

const { preference, value } = useDeskColorMode()
const colorModeItems = DESK_COLOR_MODE_PREFERENCES.map(mode => ({
  label: mode === 'system' ? 'System' : mode[0]!.toUpperCase() + mode.slice(1),
  value: mode
}))
</script>

<template>
  <SettingsShell
    section="preferences"
    title="Desk preferences"
    description="Choose browser-local preferences for the HaloPress administrator workspace."
  >
    <section class="max-w-3xl space-y-5 rounded-lg border border-default p-5" aria-labelledby="desk-appearance-heading">
      <div class="space-y-1">
        <h2 id="desk-appearance-heading" class="font-semibold text-highlighted">
          Desk appearance
        </h2>
        <p class="text-sm text-muted">
          This preference applies only to Desk in this browser. It does not change Site Themes, built-in Site presentation, or public rendering artifacts.
        </p>
      </div>

      <UFormField label="Color mode" description="System follows your browser and operating-system preference.">
        <USelect
          v-model="preference"
          :items="colorModeItems"
          value-key="value"
          class="w-full sm:max-w-xs"
        />
      </UFormField>

      <ClientOnly>
        <p class="text-sm text-muted" aria-live="polite">
          Desk is currently using {{ value }} mode.
        </p>
        <template #fallback>
          <p class="text-sm text-muted">
            Desk color mode follows this browser preference.
          </p>
        </template>
      </ClientOnly>
    </section>
  </SettingsShell>
</template>
