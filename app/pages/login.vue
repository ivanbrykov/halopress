<script setup lang="ts">
import { z } from 'zod'
import { resolvePostAuthPath } from '~~/shared/auth-redirect'

definePageMeta({ layout: 'default' })

const route = useRoute()
const toast = useToast()
const { signIn, getSession } = useAuth()
const loading = ref(false)
const callbackUrl = computed(() => typeof route.query.callbackUrl === 'string' ? route.query.callbackUrl : '/')
const state = reactive({ email: '', password: '' })
const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password')
})

async function submit() {
  loading.value = true
  try {
    const result = await signIn('credentials', {
      identifier: state.email,
      password: state.password,
      redirect: false,
      callbackUrl: callbackUrl.value
    })
    if (result?.error) throw new Error(result.error)
    const session = await getSession()
    if (!session?.user) throw new Error('The account is unavailable or inactive')
    await navigateTo(resolvePostAuthPath(callbackUrl.value, session.user), { replace: true })
  } catch {
    toast.add({
      title: 'Sign in failed',
      description: 'Check your email and password, or ask an administrator to review your account status.',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="flex min-h-[70vh] items-center justify-center py-12">
    <UCard class="w-full max-w-md" variant="subtle">
      <template #header>
        <div class="space-y-1">
          <AppLogo class="mb-4 h-8 w-auto" />
          <h1 class="text-xl font-semibold text-highlighted">Sign in</h1>
          <p class="text-sm text-muted">Use your HaloPress account to continue.</p>
        </div>
      </template>

      <div class="space-y-5">
        <PublicAuthProviders :callback-url="callbackUrl" />
        <UForm :schema="schema" :state="state" class="space-y-4" @submit="submit">
          <UFormField label="Email" name="email" required>
            <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
          </UFormField>
          <UFormField label="Password" name="password" required>
            <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
          </UFormField>
          <UButton type="submit" block :loading="loading">Sign in</UButton>
        </UForm>

        <p class="text-center text-sm text-muted">
          Need an account?
          <ULink to="/signup" class="font-medium text-primary">Sign up</ULink>
        </p>
        <UAlert
          title="No self-service password recovery yet"
          description="Contact a site administrator if you lose access."
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
        />
      </div>
    </UCard>
  </UContainer>
</template>
