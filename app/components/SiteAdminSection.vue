<script setup lang="ts">
import type { BreadcrumbItem, NavigationMenuItem } from '@nuxt/ui'
import {
  SITE_ADMIN_SECTIONS,
  findSiteAdminSection,
  isSiteAdminRouteActive,
  type SiteAdminSectionId
} from '~~/shared/site-admin-sections'

const props = defineProps<{
  section: SiteAdminSectionId
  title: string
  description: string
}>()

const route = useRoute()
const {
  data: modeData,
  enabled,
  pending,
  status,
  error,
  refresh
} = useSiteMode()
const verifyingMode = computed(() => (
  pending.value
  || (!error.value && (status.value === 'idle' || !modeData.value))
))
const currentSection = computed(() => findSiteAdminSection(props.section))

const breadcrumbItems = computed<BreadcrumbItem[]>(() => [
  {
    label: 'Site',
    icon: 'i-lucide-globe-2',
    to: props.section === 'overview' ? undefined : '/_desk/site'
  },
  ...(props.section === 'overview'
    ? []
    : [{
        label: currentSection.value.label,
        icon: currentSection.value.icon
      }])
])

const navigationItems = computed<NavigationMenuItem[]>(() => SITE_ADMIN_SECTIONS
  .filter(section => enabled.value || section.id === 'general')
  .map(section => ({
  label: section.label,
  description: section.description,
  icon: section.icon,
  to: section.to,
  active: isSiteAdminRouteActive(route.path, section)
  })))
const generalSection = computed(() => props.section === 'general')

defineSlots<{
  actions?: () => unknown
  default?: () => unknown
}>()
</script>

<template>
  <UDashboardPanel :id="`desk-site-${section}`">
    <template #header>
      <DeskNavbar :title="title" :description="description">
        <template v-if="$slots.actions && (generalSection || (enabled && !verifyingMode && !error))" #actions>
          <slot name="actions" />
        </template>
      </DeskNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-6xl space-y-6 pb-10">
        <UBreadcrumb :items="breadcrumbItems" aria-label="Site location" />

        <div v-if="!generalSection && verifyingMode" class="space-y-3" aria-busy="true" aria-label="Loading Site mode">
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-40 w-full" />
        </div>

        <UAlert
          v-else-if="!generalSection && error"
          title="Site mode could not be verified"
          :description="error.statusMessage || 'Site tools remain unavailable until the current mode can be verified.'"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
        >
          <template #actions>
            <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="refresh()">
              Try again
            </UButton>
            <UButton to="/_desk/site/general" icon="i-lucide-settings">
              Open Site General
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-else-if="!generalSection && !enabled"
          title="Site features are disabled"
          description="Enable Site features in General to use Themes, HaloPress Layouts, and Menus. Existing presentation settings, content, and pages are preserved."
          color="neutral"
          variant="subtle"
          icon="i-lucide-circle-off"
        >
          <template #actions>
            <UButton to="/_desk/site/general" icon="i-lucide-settings">
              Open Site General
            </UButton>
          </template>
        </UAlert>

        <template v-else>
          <nav aria-label="Site sections">
            <UNavigationMenu
              :items="navigationItems"
              orientation="horizontal"
              class="w-full overflow-x-auto"
            />
          </nav>

          <slot />
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
