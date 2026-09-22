<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'default' })

type MembershipStatus = {
  mode: 'disabled' | 'open' | 'invite' | 'approval'
  registrationEnabled: boolean
  passwordRegistrationEnabled: boolean
  inviteRequired: boolean
  approvalRequired: boolean
}

const { data: membership } = await useFetch<MembershipStatus>('/api/membership')
const route = useRoute()
const { signIn, getSession } = useAuth()
const toast = useToast()
const loading = ref(false)
const completedStatus = ref<string | null>(route.query.status === 'pending' ? 'pending' : null)
const state = reactive({ name: '', email: '', password: '', confirmPassword: '', inviteCode: '' })
const schema = z.object({
  name: z.string().trim().max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(12, 'Use at least 12 characters').max(128),
  confirmPassword: z.string(),
  inviteCode: z.string().optional()
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match'
})

async function submit() {
  loading.value = true
  try {
    const created = await $fetch<{ status: string }>('/api/membership/register', {
      method: 'POST',
      body: {
        name: state.name,
        email: state.email,
        password: state.password,
        inviteCode: state.inviteCode
      }
    })
    completedStatus.value = created.status
    if (created.status === 'active') {
      await signIn('credentials', { identifier: state.email, password: state.password, redirect: false })
      const session = await getSession()
      if (session?.user) {
        await navigateTo('/', { replace: true })
        return
      }
    }
  } catch (error: any) {
    toast.add({
      title: 'Could not create account',
      description: error?.data?.statusMessage || error?.statusMessage || 'Check the form and try again.',
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
          <h1 class="text-xl font-semibold text-highlighted">Create an account</h1>
          <p class="text-sm text-muted">Join this HaloPress site as a public member.</p>
        </div>
      </template>

      <UAlert
        v-if="completedStatus === 'pending'"
        title="Account awaiting approval"
        description="An administrator must activate your account before you can sign in."
        color="info"
        variant="subtle"
        icon="i-lucide-clock-3"
      />
      <UAlert
        v-else-if="!membership?.registrationEnabled"
        title="Registration is closed"
        description="An administrator has not enabled public membership."
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock"
      />
      <div v-else class="space-y-5">
        <PublicAuthProviders callback-url="/" action="signup" />
        <UForm v-if="membership?.passwordRegistrationEnabled" :schema="schema" :state="state" class="space-y-4" @submit="submit">
          <UFormField label="Name" name="name">
            <UInput v-model="state.name" autocomplete="name" class="w-full" />
          </UFormField>
          <UFormField label="Email" name="email" required>
            <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
          </UFormField>
          <UFormField label="Password" name="password" description="Use at least 12 characters." required>
            <UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField label="Confirm password" name="confirmPassword" required>
            <UInput v-model="state.confirmPassword" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField v-if="membership?.inviteRequired" label="Invitation code" name="inviteCode" required>
            <UInput v-model="state.inviteCode" autocomplete="one-time-code" class="w-full font-mono" />
          </UFormField>
          <UButton type="submit" block :loading="loading">
            {{ membership?.approvalRequired ? 'Request membership' : 'Create account' }}
          </UButton>
        </UForm>
        <UAlert
          v-else
          title="Password registration is not available"
          description="Use an enabled sign-in provider above, or ask the site administrator which sign-in methods are available."
          color="neutral"
          variant="subtle"
          icon="i-lucide-key-round"
        />
        <UAlert
          v-if="membership?.passwordRegistrationEnabled"
          title="Recovery and verification email are not configured"
          description="Use a unique password you can retain. Open registration is disabled by default because password reset and verification email delivery are not yet available."
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
        />
      </div>

      <template #footer>
        <p class="text-center text-sm text-muted">Already have an account? <ULink to="/login" class="font-medium text-primary">Sign in</ULink></p>
      </template>
    </UCard>
  </UContainer>
</template>
