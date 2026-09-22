<script setup lang="ts">
import { isSiteMenuStaticItem } from '~~/shared/site-menu'
import {
  deriveLayoutAssignmentOverviewStatus,
  deriveLayoutResourceOverviewStatus,
  deriveThemeOverviewStatus
} from '~/utils/site-overview-status'

definePageMeta({ layout: 'desk' })

const retrying = ref(false)
const {
  data: themeData,
  pending: themePending,
  error: themeError,
  refresh: refreshTheme
} = useSiteThemeStatus()
const {
  data: layoutData,
  pending: layoutsPending,
  error: layoutsError,
  refresh: refreshLayouts
} = useLayoutResourceStatus()
const {
  data: layoutAssignmentData,
  pending: layoutAssignmentPending,
  error: layoutAssignmentError,
  refresh: refreshLayoutAssignment
} = useSiteLayoutAssignmentSettings()
const {
  data: menuData,
  pending: menusPending,
  error: menusError,
  refresh: refreshMenus
} = useSiteMenusStatus()

const themeOverviewStatus = computed(() => deriveThemeOverviewStatus({
  data: themeData.value,
  pending: themePending.value,
  failed: Boolean(themeError.value)
}))
const layoutResourceOverviewStatus = computed(() => deriveLayoutResourceOverviewStatus({
  data: layoutData.value,
  pending: layoutsPending.value,
  failed: Boolean(layoutsError.value)
}))
const layoutAssignmentOverviewStatus = computed(() => deriveLayoutAssignmentOverviewStatus({
  data: layoutAssignmentData.value,
  pending: layoutAssignmentPending.value,
  failed: Boolean(layoutAssignmentError.value)
}, layoutData.value?.items))

const menuSetCount = computed(() => menuData.value?.items.length ?? 0)
const menuLinkCount = computed(() => (menuData.value?.items ?? []).reduce((total, menu) => (
  total + menu.document.items.reduce((count, item) => count + 1 + (isSiteMenuStaticItem(item) ? item.children.length : 0), 0)
), 0))
const menuOverviewStatus = computed(() => {
  if (menusPending.value) return { state: 'loading', label: 'Loading', color: 'neutral' as const }
  if (menusError.value || !menuData.value) return { state: 'unavailable', label: 'Unavailable', color: 'error' as const }
  return {
    state: 'ready',
    label: `${menuSetCount.value} menu ${menuSetCount.value === 1 ? 'set' : 'sets'}`,
    color: 'success' as const
  }
})
const menuLinkSummary = computed(() => {
  if (menusPending.value) return 'Saved links: loading'
  if (menusError.value || !menuData.value) return 'Saved links unavailable'
  return `${menuLinkCount.value} saved ${menuLinkCount.value === 1 ? 'link' : 'links'}`
})

const unavailableResourceLabels = computed(() => [
  themeOverviewStatus.value.state === 'unavailable' ? 'Theme' : null,
  layoutResourceOverviewStatus.value.state === 'unavailable' ? 'Layout resources' : null,
  layoutAssignmentOverviewStatus.value.state === 'unavailable' ? 'default Layout' : null,
  menuOverviewStatus.value.state === 'unavailable' ? 'Menus' : null
].filter((label): label is string => Boolean(label)))
const unavailableDescription = computed(() => (
  `${unavailableResourceLabels.value.join(', ')} ${unavailableResourceLabels.value.length === 1 ? 'is' : 'are'} unavailable. Other Site status remains current.`
))

async function retryUnavailableStatus() {
  retrying.value = true
  try {
    const refreshes: Array<Promise<unknown>> = []
    if (themeOverviewStatus.value.state === 'unavailable') refreshes.push(refreshTheme())
    if (layoutResourceOverviewStatus.value.state === 'unavailable') refreshes.push(refreshLayouts())
    if (layoutAssignmentOverviewStatus.value.state === 'unavailable') refreshes.push(refreshLayoutAssignment())
    if (menuOverviewStatus.value.state === 'unavailable') refreshes.push(refreshMenus())
    await Promise.allSettled(refreshes)
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <SiteAdminSection
    section="overview"
    title="Site"
    description="Review Site status and manage Themes, Layouts, and Menus."
  >
    <div class="space-y-6">
      <UAlert
        title="Site administration is enabled"
        description="Desk tools are available. Public pages continue to use the current presentation contract until a HaloPress Layout is explicitly created and selected."
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
      />

      <UAlert
        v-if="unavailableResourceLabels.length > 0"
        title="Some Site status is unavailable"
        :description="unavailableDescription"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
      >
        <template #actions>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-cw"
            :loading="retrying"
            @click="retryUnavailableStatus"
          >
            Retry unavailable status
          </UButton>
        </template>
      </UAlert>

      <div class="grid gap-4 md:grid-cols-3">
        <UPageCard
          title="Themes"
          description="Prepare reusable visual tokens for independently rendered content."
          icon="i-lucide-palette"
          to="/_desk/site/themes"
          variant="outline"
          data-site-overview-resource="theme"
        >
          <template #footer>
            <div
              class="flex w-full flex-col items-start gap-2"
              :aria-busy="themePending"
              aria-live="polite"
            >
              <UBadge :color="themeOverviewStatus.color" variant="soft">
                {{ themeOverviewStatus.label }}
              </UBadge>
              <span class="text-xs text-muted">{{ themeOverviewStatus.detail }}</span>
            </div>
          </template>
        </UPageCard>

        <UPageCard
          title="Layouts"
          description="Define HaloPress page-layout resources for public rendering."
          icon="i-lucide-panels-top-left"
          to="/_desk/site/layouts"
          variant="outline"
          data-site-overview-resource="layouts"
        >
          <template #footer>
            <div
              class="flex w-full flex-col items-start gap-2"
              :aria-busy="layoutsPending || layoutAssignmentPending"
              aria-live="polite"
            >
              <UBadge :color="layoutResourceOverviewStatus.color" variant="soft">
                {{ layoutResourceOverviewStatus.label }}
              </UBadge>
              <span
                class="text-xs"
                :class="layoutAssignmentOverviewStatus.color === 'error'
                  ? 'text-error'
                  : layoutAssignmentOverviewStatus.color === 'warning'
                    ? 'text-warning'
                    : 'text-muted'"
              >
                {{ layoutAssignmentOverviewStatus.label }}
              </span>
            </div>
          </template>
        </UPageCard>

        <UPageCard
          title="Menus"
          description="Build reusable static and dynamic navigation sets."
          icon="i-lucide-menu"
          to="/_desk/site/menus"
          variant="outline"
          data-site-overview-resource="menus"
        >
          <template #footer>
            <div
              class="flex w-full flex-col items-start gap-2"
              :aria-busy="menusPending"
              aria-live="polite"
            >
              <UBadge :color="menuOverviewStatus.color" variant="soft">
                {{ menuOverviewStatus.label }}
              </UBadge>
              <span class="text-xs text-muted">
                {{ menuLinkSummary }}
              </span>
            </div>
          </template>
        </UPageCard>
      </div>
    </div>
  </SiteAdminSection>
</template>
