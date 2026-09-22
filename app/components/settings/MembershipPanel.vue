<script setup lang="ts">
type Role = { roleKey: string; title: string | null; level: number }
type MembershipSettings = {
  mode: 'disabled' | 'open' | 'invite' | 'approval'
  defaultRole: string
  roles: Role[]
}
type Invitation = {
  id: string
  email: string
  roleKey: string
  status: string
  expiresAt: string
  createdAt: string
}

const props = defineProps<{ scrollToInvitations?: boolean }>()

const toast = useToast()
const saving = ref(false)
const inviting = ref(false)
const invitationCode = ref('')
const state = reactive({ mode: 'disabled' as MembershipSettings['mode'], defaultRole: 'user' })
const invitationState = reactive({ email: '', roleKey: 'user', expiresInDays: 7 })
const { data, pending, error, refresh } = useFetch<MembershipSettings>('/api/settings/membership')
const {
  data: invitations,
  pending: invitationsPending,
  error: invitationsError,
  refresh: refreshInvitations
} = useFetch<{ items: Invitation[] }>('/api/settings/membership/invitations')
const locale = useDisplayLocale()

watch(data, (value) => {
  if (!value) return
  state.mode = value.mode
  state.defaultRole = value.defaultRole
  invitationState.roleKey = value.defaultRole
}, { immediate: true })

const invitationNavigationHandled = ref(false)
watch([() => props.scrollToInvitations, data, pending], async ([shouldScroll, settings, isPending]) => {
  if (!shouldScroll) {
    invitationNavigationHandled.value = false
    return
  }
  if (!import.meta.client || isPending || invitationNavigationHandled.value) return

  await nextTick()
  const target = document.getElementById(settings?.mode === 'invite' ? 'invitations' : 'membership')
  if (!target) return

  target.scrollIntoView({ block: 'start' })
  invitationNavigationHandled.value = true
}, { immediate: true })

const modeItems = [
  { label: 'Disabled', description: 'No new public accounts. Existing active members may still sign in.', value: 'disabled' },
  { label: 'Open', description: 'Visitors can create an active account immediately. Use only when you accept the recovery limitations below.', value: 'open' },
  { label: 'Invitation only', description: 'Registration requires a single-use code bound to the invited email.', value: 'invite' },
  { label: 'Approval required', description: 'Visitors may register, but remain pending until an administrator activates them.', value: 'approval' }
]
const roleOptions = computed(() => (data.value?.roles || []).map(role => ({
  label: role.title || role.roleKey,
  value: role.roleKey
})))
const formatExpiry = (value: string) => formatDate(value, locale.value, {
  month: 'short',
  timeZone: 'UTC'
})

async function refreshAll() {
  await Promise.all([refresh(), refreshInvitations()])
}

async function save() {
  saving.value = true
  try {
    await $fetch('/api/settings/membership', { method: 'PUT', body: state })
    await refresh()
    toast.add({ title: 'Membership settings saved', color: 'success', icon: 'i-lucide-check' })
  } catch (saveError: any) {
    toast.add({ title: 'Could not save membership settings', description: saveError?.data?.statusMessage || saveError?.statusMessage, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function createInvitation() {
  inviting.value = true
  try {
    const result = await $fetch<{ code: string }>('/api/settings/membership/invitations', {
      method: 'POST',
      body: invitationState
    })
    invitationCode.value = result.code
    invitationState.email = ''
    await refreshInvitations()
    toast.add({ title: 'Invitation created', description: 'Copy the code now; only its hash is stored.', color: 'success' })
  } catch (inviteError: any) {
    toast.add({ title: 'Could not create invitation', description: inviteError?.data?.statusMessage || inviteError?.statusMessage, color: 'error' })
  } finally {
    inviting.value = false
  }
}

async function copyInvitation() {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
    toast.add({ title: 'Clipboard access is not available', color: 'error' })
    return
  }
  try {
    await navigator.clipboard.writeText(invitationCode.value)
    toast.add({ title: 'Invitation code copied', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy invitation code', color: 'error' })
  }
}
</script>

<template>
  <section id="membership" class="scroll-mt-6 space-y-6 rounded-lg border border-default p-5" aria-labelledby="membership-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h2 id="membership-heading" class="text-lg font-semibold text-highlighted">
          Membership
        </h2>
        <p class="text-sm text-muted">
          Control who can create a public account and which non-administrator role they receive.
        </p>
      </div>
      <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" :loading="pending || invitationsPending" @click="refreshAll">
        Refresh membership
      </UButton>
    </div>
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <UAlert v-if="error" title="Membership settings are unavailable" :description="error.statusMessage" color="error" variant="subtle" />
      <UForm v-else-if="data" :state="state" class="space-y-7" @submit="save">
        <UFormField label="Registration mode" name="mode" required>
          <URadioGroup v-model="state.mode" :items="modeItems" variant="card" indicator="end" class="w-full" />
        </UFormField>
        <UFormField
          label="Default member role"
          name="defaultRole"
          description="Administrator and anonymous roles are never eligible. Public-member accounts remain outside Desk regardless of role."
          required
        >
          <USelect v-model="state.defaultRole" :items="roleOptions" class="w-full" />
        </UFormField>
        <UAlert
          title="Open registration is off by default"
          description="HaloPress currently has no password-reset or verification-email delivery. Invitation and approval modes reduce exposure but do not add email recovery."
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
        />
        <div v-if="state.mode === 'approval'" class="flex items-center justify-between gap-4 rounded-lg border border-muted p-4">
          <div>
            <p class="font-medium text-highlighted">Pending approvals</p>
            <p class="text-sm text-muted">Activate pending accounts from the Users section.</p>
          </div>
          <UButton to="/_desk/users?status=pending" color="neutral" variant="outline" trailing-icon="i-lucide-arrow-right">Review users</UButton>
        </div>
        <div class="flex justify-end border-t border-muted pt-5">
          <UButton type="submit" icon="i-lucide-save" :loading="saving">Save membership settings</UButton>
        </div>
      </UForm>
      <div v-else class="flex min-h-40 items-center justify-center" aria-live="polite">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        <span class="sr-only">Loading membership settings</span>
      </div>

      <UCard v-if="data && state.mode === 'invite'" id="invitations" class="scroll-mt-6">
        <template #header>
          <div>
            <h2 class="font-semibold text-highlighted">Create invitation</h2>
            <p class="text-sm text-muted">Codes are single-use, email-bound, and stored only as hashes.</p>
          </div>
        </template>
        <UAlert
          v-if="invitationsError"
          title="Invitations are unavailable"
          :description="invitationsError.statusMessage || 'Refresh invitations and try again.'"
          color="error"
          variant="subtle"
          class="mb-5"
        />
        <UForm :state="invitationState" class="grid gap-4 sm:grid-cols-2" @submit="createInvitation">
          <UFormField label="Email" name="email" required>
            <UInput v-model="invitationState.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Role" name="roleKey" required>
            <USelect v-model="invitationState.roleKey" :items="roleOptions" class="w-full" />
          </UFormField>
          <UFormField label="Expires in days" name="expiresInDays">
            <UInput v-model.number="invitationState.expiresInDays" type="number" min="1" max="30" class="w-full" />
          </UFormField>
          <div class="flex items-end">
            <UButton type="submit" block icon="i-lucide-user-plus" :loading="inviting">Create invitation</UButton>
          </div>
        </UForm>
        <UAlert
          v-if="invitationCode"
          class="mt-5"
          title="Copy this code now"
          description="It cannot be recovered after leaving this page."
          color="success"
          variant="subtle"
        >
          <template #actions>
            <div class="flex w-full items-center gap-2">
              <UInput :model-value="invitationCode" readonly class="min-w-0 flex-1 font-mono" />
              <UButton type="button" color="neutral" variant="outline" icon="i-lucide-copy" @click="copyInvitation">Copy</UButton>
            </div>
          </template>
        </UAlert>
        <div v-if="invitations?.items?.length" class="mt-6 space-y-2">
          <div v-for="invitation in invitations.items" :key="invitation.id" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-muted p-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">{{ invitation.email }}</p>
              <p class="text-xs text-muted">{{ invitation.roleKey }} · expires {{ formatExpiry(invitation.expiresAt) }}</p>
            </div>
            <UBadge :color="invitation.status === 'pending' ? 'info' : invitation.status === 'used' ? 'success' : 'neutral'" variant="soft">{{ invitation.status }}</UBadge>
          </div>
        </div>
      </UCard>
    </div>
  </section>
</template>
