<script setup lang="ts">
const props = withDefaults(defineProps<{
  callbackUrl?: string
  action?: 'login' | 'signup'
}>(), {
  callbackUrl: '/',
  action: 'login'
})

const { signIn, getProviders } = useAuth()
const providers = ref<Record<string, { id: string; name: string } | undefined>>({})
const loading = ref(true)

try {
  providers.value = await getProviders() || {}
} catch {
  providers.value = {}
} finally {
  loading.value = false
}

const oauthProviders = computed(() => Object.values(providers.value)
  .filter((provider): provider is { id: string; name: string } => Boolean(provider?.id) && provider?.id !== 'credentials'))
const providerIcon = (providerId: string) => providerId === 'google'
  ? 'i-simple-icons-google'
  : 'i-lucide-key-round'

async function continueWith(providerId: string) {
  const continuation = `/auth/continue?callbackUrl=${encodeURIComponent(props.callbackUrl)}`
  await signIn(providerId, { callbackUrl: continuation })
}
</script>

<template>
  <div v-if="oauthProviders.length" class="space-y-3">
    <UButton
      v-for="provider in oauthProviders"
      :key="provider.id"
      type="button"
      block
      color="neutral"
      variant="outline"
      :icon="providerIcon(provider.id)"
      :loading="loading"
      @click="continueWith(provider.id)"
    >
      {{ action === 'signup' ? 'Sign up' : 'Continue' }} with {{ provider.name }}
    </UButton>
    <USeparator label="or" />
  </div>
</template>
