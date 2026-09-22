import {
  normalizeDeskColorModePreference,
  type DeskColorModePreference
} from '~~/shared/desk-preferences'

const DESK_COLOR_MODE_COOKIE = 'halopress_desk_color_mode'

export function useDeskColorMode() {
  const colorMode = useColorMode()
  const storedPreference = useCookie<DeskColorModePreference>(DESK_COLOR_MODE_COOKIE, {
    default: () => 'system',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  })
  const preference = computed<DeskColorModePreference>({
    get: () => normalizeDeskColorModePreference(storedPreference.value),
    set: (value) => {
      storedPreference.value = normalizeDeskColorModePreference(value)
    }
  })

  watch(preference, (value) => {
    colorMode.preference = value
  }, { immediate: true })

  const explicitColorMode = computed(() => preference.value === 'system' ? undefined : preference.value)
  const colorModeBridgeScript = computed(() => {
    const value = preference.value
    return `(function(){var p="${value}",m=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p,e=document.documentElement,h=window.__NUXT_COLOR_MODE__;e.classList.remove("light","dark");e.classList.add(m);e.style.colorScheme=m;if(h){h.preference=p;h.value=m}})()`
  })

  useHead(() => ({
    htmlAttrs: {
      class: explicitColorMode.value,
      style: explicitColorMode.value ? `color-scheme: ${explicitColorMode.value}` : undefined
    },
    script: [{
      key: 'halo-desk-color-mode-bridge',
      id: 'halo-desk-color-mode-bridge',
      tagPosition: 'bodyOpen',
      innerHTML: colorModeBridgeScript.value
    }]
  }))

  return {
    preference,
    value: computed(() => colorMode.value)
  }
}
