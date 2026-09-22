<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const { presentation } = await useSitePresentation()
const { theme: siteTheme } = useSiteTheme()
const siteModeEnabled = computed(() => siteTheme.value?.siteModeEnabled === true)
const colorMode = useColorMode()
const systemPrefersDark = ref(false)
const configuredColorModePreference = computed(() => siteModeEnabled.value && siteTheme.value
  ? siteTheme.value.colorMode
  : presentation.value.appearance.colorMode)
const shellColorMode = computed(() => colorMode.preference === 'dark'
  ? 'dark'
  : (colorMode.preference === 'light' ? 'light' : 'default'))
const visitorColorModeIsDark = computed(() => colorMode.preference === 'dark'
  || (colorMode.preference === 'system' && systemPrefersDark.value))
const visitorColorModeIcon = computed(() => visitorColorModeIsDark.value ? 'i-lucide-moon' : 'i-lucide-sun')
const visitorColorModeLabel = computed(() => visitorColorModeIsDark.value ? 'Switch to light mode' : 'Switch to dark mode')
const explicitColorModeClass = computed(() => shellColorMode.value === 'default' ? undefined : shellColorMode.value)
const colorModeBridgeScript = computed(() => {
  const preference = configuredColorModePreference.value
  return `(function(){var p="${preference}",m=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p,e=document.documentElement,h=window.__NUXT_COLOR_MODE__;e.classList.remove("light","dark");e.classList.add(m);e.style.colorScheme=m;if(h){h.preference=p;h.value=m}})()`
})
const { data: membership } = useFetch<{ registrationEnabled: boolean }>('/api/membership')
const { data: session, status, signOut } = useAuth()

const navigationItems = computed(() => siteNavigationItems(presentation.value, route.path))
const footerLinks = computed(() => siteFooterLinks(presentation.value, route.path))
const themeStyle = computed(() => siteThemeStyle(presentation.value, siteModeEnabled.value))
useHead(() => ({
  htmlAttrs: {
    lang: presentation.value.general.locale,
    class: explicitColorModeClass.value,
    style: explicitColorModeClass.value ? `color-scheme: ${explicitColorModeClass.value}` : undefined
  },
  bodyAttrs: {
    class: 'site-theme-adapter',
    'data-halo-theme-enabled': String(siteModeEnabled.value),
    'data-halo-color-mode': siteModeEnabled.value ? shellColorMode.value : undefined,
    style: themeStyle.value
  },
  link: [
    ...(presentation.value.general.faviconUrl === '/favicon.ico'
      ? [
          { rel: 'icon' as const, type: 'image/x-icon', href: '/favicon.ico' },
          { rel: 'icon' as const, type: 'image/png', sizes: '64x64', href: '/favicon.png' },
          { rel: 'apple-touch-icon' as const, sizes: '180x180', href: '/apple-touch-icon.png' }
        ]
      : [
          { rel: 'icon' as const, href: presentation.value.general.faviconUrl },
          { rel: 'apple-touch-icon' as const, href: presentation.value.general.faviconUrl }
        ]),
    ...(siteModeEnabled.value && siteTheme.value
      ? [{
          key: `halo-stylesheet-${siteTheme.value.stylesheetUrl}`,
          rel: 'stylesheet' as const,
          href: siteTheme.value.stylesheetUrl
        }]
      : [])
  ],
  titleTemplate: title => title || presentation.value.general.siteName,
  meta: [
    { key: 'halo-built-in-description', name: 'description', content: presentation.value.general.description, tagPriority: 'low' },
    { key: 'halo-built-in-og-title', property: 'og:title', content: presentation.value.general.siteName, tagPriority: 'low' },
    { key: 'halo-built-in-og-description', property: 'og:description', content: presentation.value.general.description, tagPriority: 'low' },
    { key: 'halo-built-in-og-image', property: 'og:image', content: presentation.value.general.socialImageUrl, tagPriority: 'low' },
    { key: 'halo-built-in-twitter-image', name: 'twitter:image', content: presentation.value.general.socialImageUrl, tagPriority: 'low' },
    { key: 'halo-built-in-twitter-card', name: 'twitter:card', content: 'summary_large_image', tagPriority: 'low' }
  ],
  script: [{
    key: 'halo-public-color-mode-bridge',
    id: 'halo-public-color-mode-bridge',
    tagPriority: 'low',
    innerHTML: colorModeBridgeScript.value
  }]
}))
function applyConfiguredColorMode(preference: 'system' | 'light' | 'dark') {
  colorMode.preference = preference
}
watch(configuredColorModePreference, applyConfiguredColorMode, { immediate: true, flush: 'sync' })
if (import.meta.client) {
  const systemColorModeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  const syncSystemColorMode = () => {
    systemPrefersDark.value = systemColorModeMedia.matches
  }
  onMounted(() => {
    syncSystemColorMode()
    systemColorModeMedia.addEventListener('change', syncSystemColorMode)
  })
  onBeforeUnmount(() => systemColorModeMedia.removeEventListener('change', syncSystemColorMode))
  useNuxtApp().hook('app:mounted', () => applyConfiguredColorMode(configuredColorModePreference.value))
}
const copyright = computed(() => presentation.value.footer.copyright
  || `© ${new Date().getUTCFullYear()} ${presentation.value.general.siteName}`)
const headerUi = computed(() => {
  if (presentation.value.shell.headerVariant === 'minimal') return { root: 'border-b-0' }
  if (presentation.value.shell.headerVariant === 'centered') return { left: 'md:flex-1', center: 'md:flex-none', right: 'md:flex-1 md:justify-end' }
  return {}
})

const isAdmin = computed(() => session.value?.user?.role === 'admin' && session.value.user.accountType === 'staff')
function toggleVisitorColorMode() {
  colorMode.preference = visitorColorModeIsDark.value ? 'light' : 'dark'
}
function logout() {
  void signOut({ callbackUrl: '/' })
}
const accountItems = computed<DropdownMenuItem[][]>(() => {
  const user = session.value?.user
  if (!user) return []
  const actions: DropdownMenuItem[] = [
    { label: 'Sign-in methods', icon: 'i-lucide-shield-keyhole', to: '/account/security' }
  ]
  if (isAdmin.value) actions.unshift({ label: 'Open Desk', icon: 'i-lucide-layout-dashboard', to: '/_desk' })
  return [
    [{ label: user.name || user.email || 'Account', description: user.email || undefined, type: 'label' }],
    actions,
    [{ label: 'Log out', icon: 'i-lucide-log-out', color: 'error', onSelect: logout }]
  ]
})
</script>

<template>
  <div
    class="site-shell"
    :style="themeStyle"
    :data-theme-preset="presentation.appearance.preset"
    :data-theme-revision="siteModeEnabled ? siteTheme?.revision : undefined"
    :data-halo-theme-enabled="siteModeEnabled"
    :data-halo-color-mode="siteModeEnabled ? shellColorMode : undefined"
    :data-shell-width="presentation.shell.width"
    data-built-in-layout-renderer
  >
    <UHeader :title="presentation.general.siteName" mode="drawer" :toggle="true" :ui="headerUi">
      <template #left>
        <NuxtLink to="/" :aria-label="`${presentation.general.siteName} home`" class="h-7">
          <SiteLogo :site-name="presentation.general.siteName" :logo-url="presentation.general.logoUrl" class="h-7 w-auto shrink-0" />
        </NuxtLink>
      </template>

      <UNavigationMenu v-if="navigationItems.length" :items="navigationItems" class="hidden md:flex" />

      <template #right>
        <ClientOnly>
          <div v-if="status === 'authenticated' && session?.user" class="flex items-center gap-2">
            <UDropdownMenu :items="accountItems" :content="{ align: 'end' }">
              <UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down">
                {{ session.user.name || session.user.email || 'Account' }}
              </UButton>
            </UDropdownMenu>
          </div>
          <div v-else-if="status !== 'loading'" class="flex items-center gap-1">
            <UButton to="/login" color="neutral" variant="ghost">Log in</UButton>
            <UButton v-if="membership?.registrationEnabled" to="/signup" variant="soft">Sign up</UButton>
            <UButton v-if="presentation.shell.showDeskLink" to="/_desk" icon="i-lucide-layout-dashboard" color="neutral" variant="ghost">Desk</UButton>
          </div>
          <template #fallback><USkeleton class="h-8 w-24" /></template>
        </ClientOnly>
        <UButton
          v-if="presentation.shell.showColorMode"
          color="neutral"
          variant="ghost"
          square
          :icon="visitorColorModeIcon"
          :aria-label="visitorColorModeLabel"
          data-public-color-mode-toggle
          @click="toggleVisitorColorMode"
        />
      </template>

      <template #body>
        <div class="space-y-4">
          <UNavigationMenu :items="navigationItems" orientation="vertical" class="-mx-2.5" />
          <USeparator />
          <ClientOnly>
            <div v-if="status === 'authenticated' && session?.user" class="space-y-2">
              <UButton v-if="isAdmin" to="/_desk" block color="neutral" variant="soft" icon="i-lucide-layout-dashboard">Open Desk</UButton>
              <UButton to="/account/security" block color="neutral" variant="ghost" icon="i-lucide-shield-keyhole">Sign-in methods</UButton>
              <UButton block color="error" variant="ghost" icon="i-lucide-log-out" @click="logout">Log out</UButton>
            </div>
            <div v-else class="grid grid-cols-2 gap-2">
              <UButton to="/login" block color="neutral" variant="outline">Log in</UButton>
              <UButton v-if="membership?.registrationEnabled" to="/signup" block>Sign up</UButton>
            </div>
          </ClientOnly>
        </div>
      </template>
    </UHeader>

    <UMain><slot /></UMain>

    <USeparator />
    <UFooter>
      <template #left><p class="text-sm text-muted">{{ copyright }}</p></template>
      <template #right>
        <UNavigationMenu v-if="presentation.footer.variant === 'links' && footerLinks.length" :items="footerLinks" />
        <span v-else-if="presentation.footer.showRoute" class="text-sm text-muted">{{ route.fullPath }}</span>
      </template>
    </UFooter>
  </div>
</template>
