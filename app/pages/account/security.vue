<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'default' })

const route = useRoute()
const toast = useToast()
const { getProviders, signIn } = useAuth()
const providers = await getProviders().catch(() => ({} as Record<string, unknown>))
const googleAvailable = Boolean(providers?.google)
const loading = ref(false)
const state = reactive({ password: '' })
const schema = z.object({ password: z.string().min(1, 'Enter your current password') })

async function connectGoogle() {
  loading.value = true
  try {
    await $fetch('/api/account/link/google', { method: 'POST', body: { password: state.password } })
    await signIn('google', { callbackUrl: '/account/security?linked=google' })
  } catch (error: any) {
    toast.add({
      title: 'Could not link Google',
      description: error?.data?.statusMessage || error?.statusMessage || 'Reauthentication failed.',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="py-12">
    <UPageHeader
      title="Sign-in methods"
      description="Manage provider access without changing your public profile."
    />
    <div class="mt-8 max-w-2xl space-y-6">
      <UAlert
        v-if="route.query.linked === 'google'"
        title="Google account linked"
        description="Future Google sign-ins use the provider's stable account identity, even if its email later changes."
        color="success"
        variant="subtle"
        icon="i-lucide-shield-check"
      />
      <UCard>
        <template #header>
          <div class="space-y-1">
            <h2 class="font-semibold text-highlighted">Connect Google</h2>
            <p class="text-sm text-muted">Re-enter your HaloPress password before linking. Matching email alone never links accounts.</p>
          </div>
        </template>
        <UAlert
          v-if="!googleAvailable"
          title="Google sign-in is not available"
          description="A site administrator must configure and enable the Google provider first."
          color="neutral"
          variant="subtle"
        />
        <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="connectGoogle">
          <UFormField label="Current password" name="password" required>
            <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
          </UFormField>
          <UButton type="submit" icon="i-simple-icons-google" :loading="loading">Reauthenticate and connect Google</UButton>
        </UForm>
      </UCard>
      <UAlert
        title="Password reset and verification email are not available"
        description="Linking Google provides an additional sign-in method, but HaloPress does not yet send recovery or verification email."
        color="warning"
        variant="subtle"
        icon="i-lucide-mail-warning"
      />
    </div>
  </UContainer>
</template>
