<script setup lang="ts">
type AuthenticationSettings = {
  provider: 'google'
  enabled: boolean
  configured: boolean
  envManaged: boolean
  canEditCredentials: boolean
  canToggle: boolean
  passwordEnabled: boolean
  clientIdConfigured: boolean
  clientIdMasked: string | null
  secretConfigured: boolean
  invalidStoredSecret: boolean
  encryptionKeyAvailable: boolean
  callbackUrl: string
  environment: {
    clientIdConfigured: boolean
    clientSecretConfigured: boolean
    enabledOverride: boolean | null
  }
}

const toast = useToast()
const saving = ref(false)
const copied = ref(false)
const state = reactive({
  enabled: false,
  clientId: '',
  clientSecret: ''
})

const { data, pending, error, refresh } = useFetch<AuthenticationSettings>('/api/settings/authentication')

watch(data, (settings) => {
  if (settings) state.enabled = settings.enabled
}, { immediate: true })

const statusLabel = computed(() => {
  if (data.value?.enabled) return 'Enabled'
  if (data.value?.configured) return 'Ready to enable'
  return 'Not configured'
})

const statusColor = computed(() => {
  if (data.value?.enabled) return 'success'
  if (data.value?.configured) return 'info'
  return 'neutral'
})

function validate(formState: typeof state) {
  const errors: Array<{ name: string, message: string }> = []
  const clientId = formState.clientId.trim()
  const clientSecret = formState.clientSecret.trim()

  if (clientId && !/^[A-Za-z0-9][A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    errors.push({ name: 'clientId', message: 'Enter a Google web client ID ending in .apps.googleusercontent.com.' })
  }
  if (clientSecret && (clientSecret.length < 16 || /\s/.test(clientSecret))) {
    errors.push({ name: 'clientSecret', message: 'Use a client secret of at least 16 characters with no spaces.' })
  }
  if (formState.enabled && data.value?.canEditCredentials) {
    if (!clientId && !data.value.clientIdConfigured) {
      errors.push({ name: 'clientId', message: 'A Google client ID is required before enabling sign-in.' })
    }
    if (!clientSecret && !data.value.secretConfigured) {
      errors.push({ name: 'clientSecret', message: 'A Google client secret is required before enabling sign-in.' })
    }
  }
  return errors
}

async function copyCallbackUrl() {
  const callbackUrl = data.value?.callbackUrl
  if (!callbackUrl) return
  try {
    await navigator.clipboard.writeText(callbackUrl)
    copied.value = true
    toast.add({ title: 'Callback URL copied', color: 'success', icon: 'i-lucide-check' })
    window.setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    toast.add({ title: 'Copy failed', description: 'Select and copy the callback URL manually.', color: 'error' })
  }
}

async function save() {
  saving.value = true
  try {
    await $fetch<AuthenticationSettings>('/api/settings/authentication', {
      method: 'PUT',
      body: {
        enabled: state.enabled,
        clientId: data.value?.canEditCredentials ? state.clientId : '',
        clientSecret: data.value?.canEditCredentials ? state.clientSecret : ''
      }
    })
    state.clientId = ''
    state.clientSecret = ''
    await refresh()
    toast.add({
      title: 'Authentication settings saved',
      description: state.enabled ? 'Google sign-in is available on the Desk login page.' : 'Google sign-in is disabled.',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (saveError: any) {
    toast.add({
      title: 'Could not save authentication settings',
      description: saveError?.data?.statusMessage || saveError?.statusMessage || 'Check the values and try again.',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

function discardChanges() {
  state.enabled = Boolean(data.value?.enabled)
  state.clientId = ''
  state.clientSecret = ''
}
</script>

<template>
  <section id="authentication" class="scroll-mt-6 space-y-6 rounded-lg border border-default p-5" aria-labelledby="authentication-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h2 id="authentication-heading" class="text-lg font-semibold text-highlighted">
          Authentication
        </h2>
        <p class="text-sm text-muted">
          Configure Google sign-in while keeping password access and explicit account linking.
        </p>
      </div>
      <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" :loading="pending" @click="refresh()">
        Refresh authentication
      </UButton>
    </div>
    <div class="mx-auto w-full max-w-3xl space-y-6">
        <UAlert
          v-if="error"
          title="Authentication settings are unavailable"
          :description="error.statusMessage || 'Refresh the page and try again.'"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
        />

        <section v-else-if="data" class="space-y-6" aria-labelledby="google-sign-in-heading">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
              <h3 id="google-sign-in-heading" class="text-base font-semibold text-highlighted">
                Google sign-in
              </h3>
              <p class="text-sm text-muted">
                Allow active users to sign in through a stable Google account identity. New accounts follow the Membership admission policy.
              </p>
            </div>
            <UBadge :color="statusColor" variant="soft">
              {{ statusLabel }}
            </UBadge>
          </div>

          <UForm :state="state" :validate="validate" class="space-y-8" @submit="save">
            <UAlert
              title="Password sign-in remains your recovery path"
              description="Enabling Google does not replace or disable the administrator email and password created during installation."
              :color="data.passwordEnabled ? 'success' : 'error'"
              variant="subtle"
              :icon="data.passwordEnabled ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
            />

            <fieldset class="min-w-0 border-0 p-0">
              <legend class="font-medium text-highlighted">
                Google Cloud setup
              </legend>
              <div class="mt-3 space-y-3">
                <p class="mt-1 text-sm text-muted">
                  Create a Web application client in Google Cloud, then add the redirect URI below.
                </p>
                <UButton
                  to="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  color="neutral"
                  variant="link"
                  trailing-icon="i-lucide-external-link"
                  class="mt-2 px-0"
                >
                  Open Google Cloud credentials
                </UButton>

                <UFormField label="Authorized redirect URI" description="The URI in Google Cloud must match exactly.">
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <UInput
                      :model-value="data.callbackUrl"
                      readonly
                      aria-label="Google OAuth callback URL"
                      class="min-w-0 flex-1 font-mono"
                      size="lg"
                    />
                    <UButton
                      type="button"
                      color="neutral"
                      variant="outline"
                      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                      class="min-h-11 justify-center"
                      @click="copyCallbackUrl"
                    >
                      {{ copied ? 'Copied' : 'Copy' }}
                    </UButton>
                  </div>
                </UFormField>
              </div>
            </fieldset>

            <UAlert
              v-if="data.envManaged"
              title="Credentials are managed by Cloudflare"
              description="This deployment supplies NUXT_OAUTH_GOOGLE_CLIENT_ID or NUXT_OAUTH_GOOGLE_CLIENT_SECRET through Cloudflare runtime values. Update them in Workers settings; Desk will never reveal or overwrite them."
              color="info"
              variant="subtle"
              icon="i-lucide-cloud-cog"
            >
              <template #actions>
                <div class="flex flex-wrap gap-2">
                  <UBadge :color="data.environment.clientIdConfigured ? 'success' : 'warning'" variant="soft">
                    Client ID {{ data.environment.clientIdConfigured ? 'configured' : 'missing' }}
                  </UBadge>
                  <UBadge :color="data.environment.clientSecretConfigured ? 'success' : 'warning'" variant="soft">
                    Client secret {{ data.environment.clientSecretConfigured ? 'configured' : 'missing' }}
                  </UBadge>
                </div>
              </template>
            </UAlert>

            <fieldset v-if="data.canEditCredentials" class="min-w-0 border-0 p-0">
              <legend class="font-medium text-highlighted">
                Google credentials
              </legend>
              <div class="mt-3 grid gap-5 sm:grid-cols-2">
                <UFormField
                  label="Google client ID"
                  name="clientId"
                  :description="data.clientIdConfigured ? `Current: ${data.clientIdMasked}. Leave blank to keep it.` : 'Paste the Web application client ID.'"
                >
                  <UInput
                    v-model="state.clientId"
                    autocomplete="off"
                    placeholder="1234…apps.googleusercontent.com"
                    class="w-full"
                    size="lg"
                  />
                </UFormField>

                <UFormField
                  label="Google client secret"
                  name="clientSecret"
                  :description="data.secretConfigured ? 'A secret is stored. Leave blank to keep it.' : 'The secret is encrypted before it is stored.'"
                >
                  <UInput
                    v-model="state.clientSecret"
                    type="password"
                    autocomplete="new-password"
                    placeholder="Paste client secret"
                    class="w-full"
                    size="lg"
                  />
                </UFormField>
              </div>
            </fieldset>

            <UAlert
              v-if="data.canEditCredentials && !data.encryptionKeyAvailable"
              title="A strong runtime secret is required"
              description="Configure a strong NUXT_AUTH_SECRET, NUXT_SECRET_KEY, or provider encryption key before saving a Google client secret."
              color="warning"
              variant="subtle"
              icon="i-lucide-key-round"
            />

            <UAlert
              v-if="data.invalidStoredSecret"
              title="Stored Google secret cannot be decrypted"
              description="The encryption key may have changed. Paste the current Google client secret again before enabling Google sign-in."
              color="warning"
              variant="subtle"
              icon="i-lucide-shield-alert"
            />

            <div class="border-t border-muted pt-6">
              <USwitch
                v-model="state.enabled"
                label="Enable Google sign-in"
              description="Verified new Google accounts follow Membership settings. Existing password accounts are never linked by email alone; users must sign in and explicitly reauthenticate before connecting Google."
                :disabled="!data.canToggle"
                class="w-full"
              />
              <p v-if="!data.canToggle" class="mt-3 text-xs text-warning">
                {{ data.passwordEnabled
                  ? 'The deployment environment controls whether Google sign-in is enabled.'
                  : 'Restore password sign-in in the deployment environment before changing Google. This prevents administrator lockout.' }}
              </p>
            </div>

            <div class="flex flex-col-reverse gap-2 border-t border-muted pt-5 sm:flex-row sm:justify-end">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                class="min-h-11 justify-center"
                :disabled="saving"
                @click="discardChanges"
              >
                Discard changes
              </UButton>
              <UButton
                type="submit"
                icon="i-lucide-save"
                class="min-h-11 justify-center"
                :loading="saving"
                :disabled="!data.canToggle"
              >
                Save authentication settings
              </UButton>
            </div>
          </UForm>
        </section>

        <div v-else class="flex min-h-56 items-center justify-center" aria-live="polite">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
          <span class="sr-only">Loading authentication settings</span>
        </div>
    </div>
  </section>
</template>
