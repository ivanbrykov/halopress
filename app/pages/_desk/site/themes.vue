<script setup lang="ts">
import type { FormErrorEvent } from '@nuxt/ui'
import {
  SITE_THEME_FONT_OPTIONS,
  defaultSiteTheme,
  siteThemeAccessibilityWarnings,
  siteThemeSchema,
  type SiteTheme,
  type SiteThemeColorMode
} from '~~/shared/site-theme'

definePageMeta({ layout: 'desk' })

const toast = useToast()
const previewOpen = ref(false)
const saveStatus = ref('')
const {
  data,
  pending,
  error,
  refresh,
  saving,
  saveTheme
} = await useSiteThemeSettings()

const working = ref<SiteTheme>(structuredClone(data.value?.value ?? defaultSiteTheme()))
const baseline = ref(JSON.stringify(working.value))
const expectedRevision = ref(data.value?.revision ?? '')
const isDirty = computed(() => JSON.stringify(working.value) !== baseline.value)
const workingValidation = computed(() => siteThemeSchema.safeParse(working.value))
const lastValidWarnings = ref(data.value?.warnings ?? [])
const workingWarnings = computed(() => workingValidation.value.success
  ? siteThemeAccessibilityWarnings(workingValidation.value.data)
  : lastValidWarnings.value)
const structuralValidationMessage = computed(() => workingValidation.value.success
  ? ''
  : (workingValidation.value.error.issues[0]?.message || 'The draft contains an invalid value.'))
useUnsavedNavigationGuard(isDirty, 'You have unsaved Theme changes. Leave and discard them?')

watch(working, (value) => {
  const parsed = siteThemeSchema.safeParse(value)
  if (parsed.success) lastValidWarnings.value = siteThemeAccessibilityWarnings(parsed.data)
  if (isDirty.value) saveStatus.value = ''
}, { deep: true })

function loadResponse(response: NonNullable<typeof data.value>) {
  working.value = structuredClone(response.value)
  baseline.value = JSON.stringify(response.value)
  expectedRevision.value = response.revision
}

watch(data, (response) => {
  if (!response || isDirty.value) return
  loadResponse(response)
}, { immediate: true })

const colorFields = [
  { key: 'primary', label: 'Primary', description: 'Primary actions, links, and focus.' },
  { key: 'secondary', label: 'Secondary', description: 'Secondary actions and accents.' },
  { key: 'neutral', label: 'Neutral', description: 'Neutral emphasis and supporting controls.' },
  { key: 'background', label: 'Background', description: 'The base content background.' },
  { key: 'text', label: 'Text', description: 'Default readable text.' },
  { key: 'success', label: 'Success', description: 'Positive states and confirmations.' },
  { key: 'info', label: 'Info', description: 'Informational states.' },
  { key: 'warning', label: 'Warning', description: 'Caution and attention states.' },
  { key: 'error', label: 'Error', description: 'Destructive and invalid states.' }
] as const

const colorModes: Array<{ key: SiteThemeColorMode, label: string }> = [
  { key: 'light', label: 'Light colors' },
  { key: 'dark', label: 'Dark colors' }
]
const fontOptions = [...SITE_THEME_FONT_OPTIONS]

function openPreview() {
  previewOpen.value = true
}

async function save() {
  saveStatus.value = 'Validating Theme…'
  try {
    const theme = siteThemeSchema.parse(working.value)
    const response = await saveTheme(theme, expectedRevision.value)
    loadResponse(response)
    saveStatus.value = `Published revision ${response.revision.slice(0, 12)}.`
    toast.add({ title: 'Theme published', color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    saveStatus.value = saveError?.statusCode === 409
      ? 'The Theme changed elsewhere. Refresh before saving again.'
      : 'Theme validation or publishing failed.'
    toast.add({
      title: saveError?.statusCode === 409 ? 'Theme changed elsewhere' : 'Could not publish Theme',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the values and try again.',
      color: 'error'
    })
  }
}

function focusFirstError(event: FormErrorEvent) {
  saveStatus.value = 'Theme validation failed. Correct the highlighted field before publishing.'
  const id = event.errors[0]?.id
  if (!id || typeof document === 'undefined') return
  document.getElementById(id)?.focus()
}

async function discardAndReload() {
  if (isDirty.value && typeof window !== 'undefined'
    && !window.confirm('Discard the unsaved Theme changes and reload the published Theme?')) return
  await refresh()
  if (error.value || !data.value) {
    saveStatus.value = 'The published Theme could not be reloaded. Your draft was preserved.'
    return
  }
  loadResponse(data.value)
  saveStatus.value = 'Reloaded the published Theme.'
}
</script>

<template>
  <SiteAdminSection
    section="themes"
    title="Themes"
    description="Edit and publish the one active, portable HaloPress Theme."
  >
    <template #actions>
      <UButton
        class="lg:hidden"
        color="neutral"
        variant="outline"
        icon="i-lucide-eye"
        @click="openPreview"
      >
        Preview published Theme
      </UButton>
    </template>

    <div v-if="pending" class="space-y-4" aria-busy="true" aria-label="Loading active Theme">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <div v-else class="space-y-6">
      <UAlert
        v-if="error"
        title="The active Theme could not be loaded"
        :description="error.statusMessage || 'Refresh before editing or publishing.'"
        color="error"
        variant="subtle"
        icon="i-lucide-shield-alert"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refresh()">
            Refresh
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-if="data?.malformedStoredValue || data?.legacyAppearanceMalformed"
        title="Stored Theme data needs repair"
        description="HaloPress recovered with safe built-in defaults. Review every field and publish to replace the malformed value."
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
      />

      <UAlert
        v-else-if="data?.source === 'legacy-appearance'"
        title="Adapted from Appearance settings"
        description="These values are a deterministic, read-only adaptation of the existing presentation. Publishing creates the canonical active Theme without changing its initial look."
        color="info"
        variant="subtle"
        icon="i-lucide-copy-check"
      />

      <UPageCard
        title="Active theme"
        :description="`Contract v${data?.contractVersion ?? 1} · revision ${data?.revision?.slice(0, 12) ?? 'unavailable'}`"
        icon="i-lucide-palette"
        variant="outline"
      >
        <div class="space-y-2 text-sm">
          <p class="font-medium text-highlighted">Published stylesheet</p>
          <a
            v-if="data?.stylesheetUrl"
            :href="data.stylesheetUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="break-all text-primary underline underline-offset-2"
          >
            {{ data.stylesheetUrl }}
          </a>
          <p class="text-muted">Revisioned CSS is immutable; the current manifest revalidates when this Theme is published.</p>
        </div>
      </UPageCard>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <UForm
          :schema="siteThemeSchema"
          :state="working"
          class="space-y-8"
          :disabled="Boolean(error) || saving"
          @submit="save"
          @error="focusFirstError"
        >
          <fieldset class="space-y-4 rounded-lg border border-muted p-4 sm:p-5">
            <legend class="px-2 text-base font-semibold text-highlighted">Color preference</legend>
            <UFormField
              name="colorMode"
              label="Default color mode"
              description="System follows the consumer's preferred color scheme; explicit light and dark always win."
              required
            >
              <USelect
                v-model="working.colorMode"
                :items="[
                  { label: 'System', value: 'system' },
                  { label: 'Light', value: 'light' },
                  { label: 'Dark', value: 'dark' }
                ]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </fieldset>

          <fieldset
            v-for="mode in colorModes"
            :key="mode.key"
            class="space-y-4 rounded-lg border border-muted p-4 sm:p-5"
          >
            <legend class="px-2 text-base font-semibold text-highlighted">{{ mode.label }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                v-for="field in colorFields"
                :key="field.key"
                :name="`colors.${mode.key}.${field.key}`"
                :label="field.label"
                :description="field.description"
                required
              >
                <div class="flex items-center gap-2">
                  <span
                    class="size-8 shrink-0 rounded-md border border-muted"
                    :style="{ backgroundColor: working.colors[mode.key][field.key] }"
                    aria-hidden="true"
                  />
                  <UInput
                    v-model="working.colors[mode.key][field.key]"
                    :name="`colors.${mode.key}.${field.key}`"
                    pattern="#[0-9A-Fa-f]{6}"
                    placeholder="#ad46ff"
                    autocomplete="off"
                    class="w-full font-mono"
                  />
                </div>
              </UFormField>
            </div>
          </fieldset>

          <fieldset class="space-y-4 rounded-lg border border-muted p-4 sm:p-5">
            <legend class="px-2 text-base font-semibold text-highlighted">Typography</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField name="typography.bodyFontFamily" label="Body font family" description="Predefined local and system stacks never load a remote font." required>
                <USelect v-model="working.typography.bodyFontFamily" :items="fontOptions" value-key="value" class="w-full" />
              </UFormField>
              <UFormField name="typography.headingFontFamily" label="Heading font family" description="Headings use a separate safe local or system stack." required>
                <USelect v-model="working.typography.headingFontFamily" :items="fontOptions" value-key="value" class="w-full" />
              </UFormField>
              <UFormField name="typography.fontSizeBase" label="Base size (rem / 1em)" description="Defines the root size used by portable content." required>
                <UInputNumber v-model="working.typography.fontSizeBase" :min="0.875" :max="1.25" :step="0.0625" class="w-full" />
              </UFormField>
              <UFormField name="typography.lineHeightBody" label="Body line height" required>
                <UInputNumber v-model="working.typography.lineHeightBody" :min="1.2" :max="2" :step="0.05" class="w-full" />
              </UFormField>
              <UFormField name="typography.lineHeightHeading" label="Heading line height" required>
                <UInputNumber v-model="working.typography.lineHeightHeading" :min="1" :max="1.6" :step="0.05" class="w-full" />
              </UFormField>
            </div>
          </fieldset>

          <fieldset class="space-y-4 rounded-lg border border-muted p-4 sm:p-5">
            <legend class="px-2 text-base font-semibold text-highlighted">Radius scale</legend>
            <p class="text-sm text-muted">Values are rem units and must remain ordered from control through large.</p>
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <UFormField v-for="key in (['control', 'sm', 'md', 'lg'] as const)" :key="key" :name="`radii.${key}`" :label="key === 'control' ? 'Control' : key.toUpperCase()" required>
                <UInputNumber v-model="working.radii[key]" :min="0" :max="2" :step="0.0625" class="w-full" />
              </UFormField>
            </div>
          </fieldset>

          <fieldset class="space-y-4 rounded-lg border border-muted p-4 sm:p-5">
            <legend class="px-2 text-base font-semibold text-highlighted">Portable layout tokens</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField name="spacing.block" label="Block gap (rem)" required>
                <UInputNumber v-model="working.spacing.block" :min="0.25" :max="4" :step="0.0625" class="w-full" />
              </UFormField>
              <UFormField name="spacing.inline" label="Inline gap (rem)" required>
                <UInputNumber v-model="working.spacing.inline" :min="0.25" :max="4" :step="0.0625" class="w-full" />
              </UFormField>
              <UFormField name="content.maxWidth" label="Content width (rem)" required>
                <UInputNumber v-model="working.content.maxWidth" :min="32" :max="120" :step="1" class="w-full" />
              </UFormField>
              <UFormField name="content.textWidth" label="Text width (rem)" required>
                <UInputNumber v-model="working.content.textWidth" :min="24" :max="80" :step="1" class="w-full" />
              </UFormField>
            </div>
          </fieldset>

          <div
            v-if="workingWarnings.length || structuralValidationMessage"
            class="space-y-3"
            aria-label="Theme accessibility warnings"
            aria-live="polite"
          >
            <UAlert
              v-if="structuralValidationMessage"
              title="Draft validation required"
              :description="structuralValidationMessage"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
            />
            <UAlert
              v-for="warning in workingWarnings"
              :key="warning"
              title="Accessibility warning"
              :description="warning"
              color="warning"
              variant="subtle"
              icon="i-lucide-scan-eye"
            />
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-muted pt-5">
            <div class="space-y-1 text-sm" aria-live="polite">
              <p v-if="saveStatus" :class="saveStatus.includes('failed') || saveStatus.includes('changed elsewhere') ? 'text-error' : 'text-muted'">
                {{ saveStatus }}
              </p>
              <p class="text-muted">
                {{ isDirty ? 'Unsaved custom token changes.' : 'Published Theme is up to date.' }}
              </p>
            </div>
            <div class="flex gap-2">
              <UButton color="neutral" variant="outline" :disabled="saving" @click="discardAndReload">
                {{ isDirty ? 'Discard and reload' : 'Reload published' }}
              </UButton>
              <UButton type="submit" icon="i-lucide-save" :loading="saving" :disabled="!isDirty || Boolean(error)">
                Publish active Theme
              </UButton>
            </div>
          </div>
        </UForm>

        <aside class="sticky top-4 hidden space-y-3 lg:block" aria-label="Published Theme preview">
          <div>
            <h2 class="font-semibold text-highlighted">Published portable preview</h2>
            <p class="text-sm text-muted">This isolated frame loads the current digest artifact, not unsaved local CSS.</p>
          </div>
          <SiteThemeArtifactPreview />
        </aside>
      </div>
    </div>

    <USlideover
      v-model:open="previewOpen"
      title="Published Theme preview"
      description="The isolated portable Page renderer uses the current digest artifact."
      side="right"
      :ui="{ body: 'p-4 sm:p-6' }"
    >
      <template #body>
        <SiteThemeArtifactPreview />
      </template>
    </USlideover>
  </SiteAdminSection>
</template>
