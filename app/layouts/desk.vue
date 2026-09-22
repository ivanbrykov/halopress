<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { buildSettingsNavigation } from '~~/shared/settings-sections'
import { buildSiteAdminNavigation } from '~~/shared/site-admin-sections'
import { buildDeskNavigationGroups } from '~/utils/desk-navigation'

const route = useRoute()
useDeskColorMode()
useHaloPressBrandHead()
useHead({
  titleTemplate: title => title ? `${title} · HaloPress Desk` : 'HaloPress Desk'
})

const { data, signOut } = useAuth()
const { enabled: siteModeEnabled } = useSiteMode()
const { data: schemaList } = await useFetch<{ items: any[] }>('/api/schema/list')
const openNavItems = ref<string[]>(['content'])

function setNavigationOpen(value: string, open: boolean) {
  const next = new Set(openNavItems.value)
  if (open) next.add(value)
  else next.delete(value)
  openNavItems.value = [...next]
}

watch(siteModeEnabled, enabled => {
  const siteRoute = route.path === '/_desk/site' || route.path.startsWith('/_desk/site/')
  setNavigationOpen('site', enabled || siteRoute)
}, { immediate: true })
watch(() => route.path, path => {
  if (path === '/_desk/site' || path.startsWith('/_desk/site/')) setNavigationOpen('site', true)
  if (path === '/_desk/settings' || path.startsWith('/_desk/settings/')) setNavigationOpen('settings', true)
}, { immediate: true })

const activeContentBase = computed(() => {
  const parts = route.path.split('/').filter(Boolean)
  if (parts[0] !== '_desk' || parts[1] !== 'content') return null
  const schemaKey = parts[2]
  if (!schemaKey) return '/_desk/content'
  return `/_desk/content/${schemaKey}`
})

const isSchemasRoute = computed(() => route.path === '/_desk/schemas' || route.path.startsWith('/_desk/schemas/'))
const isUsersRoute = computed(() => route.path === '/_desk/users' || route.path.startsWith('/_desk/users/'))
const isContentRoute = computed(() => activeContentBase.value !== null)
const isAssetsRoute = computed(() => route.path === '/_desk/assets' || route.path.startsWith('/_desk/assets/'))
const isPagesRoute = computed(() => route.path === '/_desk/pages' || route.path.startsWith('/_desk/pages/'))

const contentChildren = computed(() => {
  const items = schemaList.value?.items ?? []
  return items.map((s: any) => ({
    label: s.title ?? s.schemaKey,
    to: `/_desk/content/${s.schemaKey}`,
    icon: 'i-lucide-file-text',
    active: activeContentBase.value === `/_desk/content/${s.schemaKey}`
  }))
})

const siteNavigation = computed(() => buildSiteAdminNavigation(route.path, siteModeEnabled.value))
const settingsNavigation = computed(() => buildSettingsNavigation(route.path))

const navItems = computed<NavigationMenuItem[][]>(() => buildDeskNavigationGroups({
  contentChildren: contentChildren.value,
  siteNavigation: siteNavigation.value,
  settingsNavigation: settingsNavigation.value,
  siteModeEnabled: siteModeEnabled.value,
  active: {
    schemas: isSchemasRoute.value,
    users: isUsersRoute.value,
    content: isContentRoute.value,
    pages: isPagesRoute.value,
    assets: isAssetsRoute.value
  }
}))

async function logout() {
  await signOut({ callbackUrl: '/_desk/login' })
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar class="min-h-dvh" resizable collapsible :min-size="12" :max-size="25" :default-size="15">
      <template #header="{ collapsed }">
        <div class="flex items-center justify-between gap-2">
          <NuxtLink to="/_desk" aria-label="HaloPress Desk">
            <AppLogo :mark-only="collapsed" class="h-7 w-auto" />
          </NuxtLink>
          <UDashboardSidebarToggle />
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          v-model="openNavItems"
          :items="navItems"
          aria-label="Desk navigation"
          orientation="vertical"
          :collapsed="collapsed"
          :tooltip="collapsed"
          :popover="collapsed"
          :ui="{ linkLabel: collapsed ? '!block sr-only' : undefined }"
        />
      </template>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <ClientOnly>
            <span class="text-xs text-muted truncate">{{ data?.user?.email || 'Guest' }}</span>
            <template #fallback>
              <span class="text-xs text-muted truncate">Guest</span>
            </template>
          </ClientOnly>
          <UButton icon="i-lucide-log-out" color="neutral" variant="ghost" @click="logout" />
        </div>
      </template>
    </UDashboardSidebar>

    <NuxtPage />
  </UDashboardGroup>
</template>
