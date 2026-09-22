<script setup lang="ts">
import {
  defaultSitePresentation,
  SITE_NEUTRAL_COLORS,
  SITE_PRIMARY_COLORS,
  SITE_THEME_PRESETS,
  siteThemePresetTokens,
  type PublicNavigationLeaf,
  type SitePresentation
} from '~~/shared/site-presentation'
import {
  applySiteGeneralServerSections,
  type SiteGeneralDraftSection
} from '~/utils/site-general-drafts'

definePageMeta({ layout: 'desk' })

const toast = useToast()
const defaults = defaultSitePresentation()
const modeState = reactive({ enabled: false })
const siteLayoutId = ref<string | null>(null)
const savedSiteLayoutId = ref<string | null>(null)
const state = reactive({
  general: { ...defaults.general },
  shell: { ...defaults.shell },
  appearance: { ...defaults.appearance },
  footer: structuredClone(defaults.footer)
})
const {
  data: modeData,
  pending: modePending,
  status: modeStatus,
  error: modeError,
  refresh: refreshMode,
  saving: modeSaving,
  saveEnabled
} = useSiteModeSettings()
const { data, pending, error, refresh, saving, savePatch } = await useSitePresentationSettings()
const {
  data: layoutAssignmentData,
  pending: layoutAssignmentPending,
  error: layoutAssignmentError,
  refresh: refreshLayoutAssignment,
  saving: layoutAssignmentSaving,
  saveLayoutAssignment
} = useSiteLayoutAssignmentSettings()

const modeBadge = computed(() => {
  if (modeError.value) return { label: 'Unavailable', color: 'error' as const }
  if (modeStatus.value !== 'success' || !modeData.value) {
    return { label: 'Checking…', color: 'neutral' as const }
  }
  return modeData.value.value.enabled
    ? { label: 'Enabled', color: 'success' as const }
    : { label: 'Disabled', color: 'neutral' as const }
})
const modeControlsDisabled = computed(() => (
  modeStatus.value !== 'success'
  || !modeData.value
  || Boolean(modeError.value)
))

watch(modeData, (response) => {
  modeState.enabled = response?.value.enabled === true
}, { immediate: true })

function applyPresentationSections(sections: readonly SiteGeneralDraftSection[]) {
  if (!data.value) return
  applySiteGeneralServerSections(state, data.value.value, sections)
}

applyPresentationSections(['general', 'shell', 'appearance', 'footer'])

watch(layoutAssignmentData, (response) => {
  if (!response) return
  siteLayoutId.value = response.storedLayoutId ?? response.value.layoutId
  savedSiteLayoutId.value = siteLayoutId.value
}, { immediate: true })

const siteLayoutDirty = computed(() => siteLayoutId.value !== savedSiteLayoutId.value)
const presetItems = Object.entries(SITE_THEME_PRESETS).map(([value, preset]) => ({ label: preset.label, value }))
const primaryItems = SITE_PRIMARY_COLORS.map(value => ({ label: value[0]!.toUpperCase() + value.slice(1), value }))
const neutralItems = SITE_NEUTRAL_COLORS.map(value => ({ label: value[0]!.toUpperCase() + value.slice(1), value }))

function applyPreset(value: string) {
  if (!(value in SITE_THEME_PRESETS)) return
  Object.assign(state.appearance, siteThemePresetTokens(value as keyof typeof SITE_THEME_PRESETS))
}

function addFooterLink() {
  const id = `footer-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`
  state.footer.links.push({ id, label: 'New link', destination: { type: 'home' } } as PublicNavigationLeaf)
}

function removeFooterLink(index: number) {
  state.footer.links.splice(index, 1)
}

async function save() {
  try {
    const response = await savePatch({ general: state.general, shell: state.shell })
    applySiteGeneralServerSections(state, response.value, ['general', 'shell'])
    toast.add({ title: 'Site settings saved', color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    toast.add({
      title: 'Could not save site settings',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the values and try again.',
      color: 'error'
    })
  }
}

async function saveBuiltInAppearance() {
  if (modeData.value?.value.enabled === true) return
  try {
    const response = await savePatch({ appearance: state.appearance as SitePresentation['appearance'] })
    applySiteGeneralServerSections(state, response.value, ['appearance'])
    toast.add({ title: 'Built-in appearance saved', color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    toast.add({
      title: 'Could not save built-in appearance',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the values and try again.',
      color: 'error'
    })
  }
}

async function saveBuiltInFooter() {
  try {
    const response = await savePatch({ footer: state.footer })
    applySiteGeneralServerSections(state, response.value, ['footer'])
    toast.add({ title: 'Built-in footer saved', color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    toast.add({
      title: 'Could not save built-in footer',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the values and try again.',
      color: 'error'
    })
  }
}

async function saveMode() {
  if (modeControlsDisabled.value) return

  try {
    await saveEnabled(modeState.enabled)
    toast.add({
      title: modeState.enabled ? 'Site features enabled' : 'Site features disabled',
      description: modeState.enabled
        ? 'The Site area is now available in Desk.'
        : 'Site resources and presentation settings were preserved.',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (saveError: any) {
    modeState.enabled = modeData.value?.value.enabled === true
    toast.add({
      title: 'Could not save Site mode',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Try again.',
      color: 'error'
    })
  }
}

async function saveSiteLayout() {
  if (!siteLayoutDirty.value || modeData.value?.value.enabled !== true) return
  try {
    const response = await saveLayoutAssignment(siteLayoutId.value)
    siteLayoutId.value = response.storedLayoutId ?? response.value.layoutId
    savedSiteLayoutId.value = siteLayoutId.value
    toast.add({
      title: 'Site Layout saved',
      description: siteLayoutId.value
        ? 'Public inheritors now follow the current revision of this Layout.'
        : 'Public inheritors now use the built-in shell fallback.',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (saveError: any) {
    toast.add({
      title: 'Could not save Site Layout',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Choose a ready Layout and try again.',
      color: 'error'
    })
  }
}

async function refreshAll() {
  await Promise.all([refreshMode(), refresh(), refreshLayoutAssignment()])
  applyPresentationSections(['general', 'shell', 'appearance', 'footer'])
}
</script>

<template>
  <SiteAdminSection
    section="general"
    title="General"
    description="Configure Site availability, public identity, defaults, and built-in compatibility fallbacks."
  >
    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-rotate-cw"
        :loading="pending || modePending || layoutAssignmentPending"
        @click="refreshAll"
      >
        Refresh
      </UButton>
    </template>

    <div class="space-y-6">
      <section id="site-features" class="scroll-mt-6 space-y-5 rounded-lg border border-default p-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="max-w-2xl space-y-1">
            <h2 class="font-semibold text-highlighted">
              Site features
            </h2>
            <p class="text-sm text-muted">
              Enable the Desk area for Themes, HaloPress Layouts, and Menus. Disabling it hides those tools without deleting Site resources, presentation settings, content, or pages.
            </p>
          </div>
          <UBadge :color="modeBadge.color" variant="soft">
            {{ modeBadge.label }}
          </UBadge>
        </div>

        <UAlert
          v-if="modeError"
          title="Site mode is unavailable"
          :description="modeError.statusMessage || 'Refresh the page and try again.'"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
        />
        <UAlert
          v-if="modeData?.malformedStoredValue"
          title="Stored Site mode is invalid"
          description="Site features are safely disabled. Saving this control will replace the invalid value."
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
        />

        <UForm :state="modeState" class="space-y-5" @submit="saveMode">
          <USwitch
            v-model="modeState.enabled"
            label="Enable Site features"
            description="Show the Site area in Desk and allow Site administration routes."
            :disabled="modeControlsDisabled"
          />
          <div class="flex justify-end border-t border-muted pt-5">
            <UButton type="submit" icon="i-lucide-save" :loading="modeSaving" :disabled="modeControlsDisabled">
              Save Site mode
            </UButton>
          </div>
        </UForm>
      </section>

      <section class="space-y-5 rounded-lg border border-default p-5">
        <div class="space-y-1">
          <h2 class="font-semibold text-highlighted">
            Default public Layout
          </h2>
          <p class="text-sm text-muted">
            Pages and Schema routes without their own assignment inherit this value immediately. Assignments store a stable Layout ID and follow its current revision.
          </p>
        </div>
        <UAlert
          v-if="layoutAssignmentData?.malformedStoredValue"
          title="Stored Site Layout assignment needs repair"
          description="The invalid value is preserved for diagnostics. Choose a ready Layout or clear it while Site features are enabled."
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
        />
        <UAlert
          v-if="layoutAssignmentError"
          title="Site Layout assignment is unavailable"
          :description="layoutAssignmentError.statusMessage || 'Refresh the page and try again.'"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
        />
        <UForm :state="{ layoutId: siteLayoutId }" class="space-y-5" @submit="saveSiteLayout">
          <LayoutAssignmentSelect
            v-model="siteLayoutId"
            label="Site default Layout"
            description="Used by inheriting public routes. Later Layout edits propagate live."
            placeholder="Use the built-in shell fallback"
            :mode-enabled="modeData?.value.enabled === true"
          />
          <div class="flex justify-end border-t border-muted pt-5">
            <UButton
              type="submit"
              icon="i-lucide-save"
              :loading="layoutAssignmentSaving"
              :disabled="!siteLayoutDirty || modeData?.value.enabled !== true || Boolean(layoutAssignmentError)"
            >
              Save default Layout
            </UButton>
          </div>
        </UForm>
      </section>

      <UAlert
        v-if="error"
        title="Site settings are unavailable"
        :description="error.statusMessage || 'Refresh the page and try again.'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
      />
      <UAlert
        v-if="data?.malformedStoredValue"
        title="Stored site settings are invalid"
        description="Safe HaloPress defaults are active. Saving this form will replace the invalid value."
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
      />
      <UAlert
        v-if="data?.missingAssetIds.length"
        title="Some branding assets are unavailable"
        :description="`Public fallbacks are active for: ${data.missingAssetIds.join(', ')}`"
        color="warning"
        variant="subtle"
        icon="i-lucide-image-off"
      />

      <UForm :state="state" class="space-y-8" @submit="save">
        <fieldset class="space-y-5">
          <legend class="text-base font-semibold text-highlighted">
            General
          </legend>
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField label="Site name" name="siteName" required>
              <UInput v-model="state.general.siteName" class="w-full" maxlength="120" />
            </UFormField>
            <UFormField label="Locale" name="locale" description="Use a BCP 47 language tag such as en or ko-KR.">
              <UInput v-model="state.general.locale" class="w-full" placeholder="en" />
            </UFormField>
            <UFormField label="Description" name="description" class="sm:col-span-2">
              <UTextarea v-model="state.general.description" class="w-full" :rows="3" maxlength="320" />
            </UFormField>
          </div>
        </fieldset>

        <fieldset class="space-y-5">
          <legend class="text-base font-semibold text-highlighted">
            Branding assets
          </legend>
          <div class="grid gap-6 md:grid-cols-3">
            <CmsAssetPicker v-model="state.general.logoAssetId" label="Header logo" />
            <CmsAssetPicker v-model="state.general.faviconAssetId" label="Favicon" />
            <CmsAssetPicker v-model="state.general.socialImageAssetId" label="Default social image" />
          </div>
          <p class="text-sm text-muted">
            Missing or cleared assets fall back to the built-in HaloPress identity. In-use branding assets cannot be deleted or replaced until they are cleared here.
          </p>
        </fieldset>

        <fieldset class="space-y-5">
          <legend class="text-base font-semibold text-highlighted">
            Built-in shell compatibility
          </legend>
          <p class="text-sm text-muted">
            These values remain the fallback when no composed HaloPress Layout is assigned. New public composition belongs in Layouts and Menus.
          </p>
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField label="Content width">
              <USelect v-model="state.shell.width" :items="['default', 'wide', 'centered']" class="w-full" />
            </UFormField>
            <UFormField label="Header variant">
              <USelect v-model="state.shell.headerVariant" :items="['standard', 'centered', 'minimal']" class="w-full" />
            </UFormField>
            <USwitch v-model="state.shell.showDeskLink" label="Show Desk link" />
            <USwitch v-model="state.shell.showColorMode" label="Show color mode control" />
          </div>
        </fieldset>

        <div class="flex justify-end border-t border-muted pt-5">
          <UButton type="submit" icon="i-lucide-save" :loading="saving">
            Save site settings
          </UButton>
        </div>
      </UForm>

      <section id="built-in-appearance" class="scroll-mt-6 space-y-5 rounded-lg border border-default p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="max-w-2xl space-y-1">
            <h2 class="font-semibold text-highlighted">
              Built-in appearance compatibility
            </h2>
            <p class="text-sm text-muted">
              These legacy Site presentation values are preserved for the built-in renderer. When Site features are enabled, the active Theme is the only editable visual source.
            </p>
          </div>
          <UButton to="/_desk/site/themes" color="neutral" variant="outline" trailing-icon="i-lucide-arrow-right">
            Open Themes
          </UButton>
        </div>

        <UAlert
          v-if="modeData?.value.enabled"
          title="The active Theme owns Site appearance"
          description="Disable Site features only if you need to edit the preserved built-in fallback. Existing Theme data is not deleted."
          color="info"
          variant="subtle"
          icon="i-lucide-palette"
        />

        <UForm :state="state.appearance" class="space-y-5" @submit="saveBuiltInAppearance">
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField label="Theme preset" description="Changing the preset applies its complete token bundle.">
              <USelect
                :model-value="state.appearance.preset"
                :items="presetItems"
                value-key="value"
                class="w-full"
                :disabled="modeData?.value.enabled === true"
                @update:model-value="applyPreset"
              />
            </UFormField>
            <UFormField label="Color mode">
              <USelect v-model="state.appearance.colorMode" :items="['system', 'light', 'dark']" class="w-full" :disabled="modeData?.value.enabled === true" />
            </UFormField>
            <UFormField label="Primary color">
              <USelect v-model="state.appearance.primaryColor" :items="primaryItems" value-key="value" class="w-full" :disabled="modeData?.value.enabled === true" />
            </UFormField>
            <UFormField label="Neutral color">
              <USelect v-model="state.appearance.neutralColor" :items="neutralItems" value-key="value" class="w-full" :disabled="modeData?.value.enabled === true" />
            </UFormField>
            <UFormField label="Typography scale">
              <USelect v-model="state.appearance.typographyScale" :items="['compact', 'default', 'relaxed']" class="w-full" :disabled="modeData?.value.enabled === true" />
            </UFormField>
            <UFormField label="Corner radius">
              <USelect v-model="state.appearance.radius" :items="['none', 'sm', 'md', 'lg']" class="w-full" :disabled="modeData?.value.enabled === true" />
            </UFormField>
          </div>
          <div class="flex justify-end border-t border-muted pt-5">
            <UButton type="submit" icon="i-lucide-save" :loading="saving" :disabled="modeData?.value.enabled === true">
              Save built-in appearance
            </UButton>
          </div>
        </UForm>
      </section>

      <section id="built-in-footer" class="scroll-mt-6 space-y-5 rounded-lg border border-default p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="max-w-2xl space-y-1">
            <h2 class="font-semibold text-highlighted">
              Built-in footer compatibility
            </h2>
            <p class="text-sm text-muted">
              Preserve the built-in renderer fallback here. Composed Sites should place footer elements in Layouts and source footer links from named Menus.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton to="/_desk/site/layouts" color="neutral" variant="outline">Open Layouts</UButton>
            <UButton to="/_desk/site/menus" color="neutral" variant="outline">Open Menus</UButton>
          </div>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField label="Footer variant">
            <USelect v-model="state.footer.variant" :items="['route', 'simple', 'links']" class="w-full" />
          </UFormField>
          <UFormField label="Copyright" description="Leave blank to use the current year and site name.">
            <UInput v-model="state.footer.copyright" class="w-full" maxlength="200" />
          </UFormField>
          <USwitch v-model="state.footer.showRoute" label="Show current route" />
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-muted pt-5">
          <h3 class="font-medium text-highlighted">Built-in footer links</h3>
          <UButton type="button" icon="i-lucide-plus" color="neutral" variant="outline" @click="addFooterLink">
            Add link
          </UButton>
        </div>

        <div class="space-y-3">
          <fieldset v-for="(link, index) in state.footer.links" :key="link.id" class="rounded-lg border border-default p-4">
            <legend class="sr-only">Footer link {{ index + 1 }}</legend>
            <div class="mb-3 flex justify-end">
              <UButton type="button" icon="i-lucide-trash-2" color="error" variant="ghost" aria-label="Remove footer link" @click="removeFooterLink(index)" />
            </div>
            <SettingsNavigationItemEditor v-model="state.footer.links[index]!" />
          </fieldset>
        </div>

        <div class="flex justify-end border-t border-muted pt-5">
          <UButton type="button" icon="i-lucide-save" :loading="saving" @click="saveBuiltInFooter">
            Save built-in footer
          </UButton>
        </div>
      </section>
    </div>
  </SiteAdminSection>
</template>
