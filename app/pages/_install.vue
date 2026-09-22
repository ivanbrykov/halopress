<script setup lang="ts">
import type { FormErrorEvent, StepperItem } from '@nuxt/ui'
import { z } from 'zod'

definePageMeta({
  layout: 'blank'
})

type InstallPhase =
  | 'binding_missing'
  | 'migration_required'
  | 'configuration_required'
  | 'ready_for_setup'
  | 'installing'
  | 'setup_locked'
  | 'resume_required'
  | 'complete'

type InstallStatus = {
  ready: boolean
  canStartSetup?: boolean
  canInstall: boolean
  phase: InstallPhase
  missingTables?: string[]
  roleCount?: number
  userCount?: number
  schemaCount?: number
  hasSecret?: boolean
  setupSessionOwned?: boolean
  retryAfterSeconds?: number
  missingBindings?: string[]
  hasLastError?: boolean
  runtime?: 'local' | 'cloudflare' | 'node'
}

type InstallIssue = {
  path?: string
  message?: string
}

type InstallFailureDetails = {
  phase?: InstallPhase
  issues?: InstallIssue[]
  missingTables?: string[]
}

type FetchFailure = {
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: {
    statusMessage?: string
    phase?: InstallPhase
    issues?: InstallIssue[]
    missingTables?: string[]
    data?: InstallFailureDetails
  }
}

const steps = [
  { value: 1, title: 'Ready', icon: 'i-lucide-cloud-check' },
  { value: 2, title: 'Your account', icon: 'i-lucide-user-cog' },
  { value: 3, title: 'Starter content', icon: 'i-lucide-sparkles' },
  { value: 4, title: 'Review', icon: 'i-lucide-list-checks' }
] satisfies StepperItem[]

const activeStep = ref(1)
const stepHeading = ref<HTMLElement | null>(null)
const stateHeading = ref<HTMLElement | null>(null)
const refreshing = ref(false)
const migratingDatabase = ref(false)
const commandCopied = ref(false)
const claimingSession = ref(false)
const submitting = ref(false)
const installationComplete = ref(false)
const completedInThisSession = ref(false)
const signedIn = ref(false)
const signInWarning = ref('')
const installError = ref<{ title: string; description: string } | null>(null)
const reservationError = ref<{ title: string; description: string } | null>(null)
const migrationError = ref<{ title: string; description: string } | null>(null)
const serverFieldErrors = reactive<Record<string, string | undefined>>({})
const { signIn, status: authStatus } = useAuth()
const toast = useToast()

const state = reactive({
  email: '',
  name: '',
  password: '',
  passwordConfirm: '',
  sampleData: true
})

const {
  data: installStatus,
  error: installStatusError,
  status: installStatusRequest,
  refresh: refreshInstallStatus
} = await useFetch<InstallStatus>('/api/system/install/status', { server: true })

installationComplete.value = Boolean(installStatus.value?.ready || installStatus.value?.phase === 'complete')

const phase = computed(() => installStatus.value?.phase)
const isMigrationRequired = computed(() => phase.value === 'migration_required')
const isCloudflareRuntime = computed(() => installStatus.value?.runtime === 'cloudflare')
const isCheckingReadiness = computed(() => refreshing.value || claimingSession.value || installStatusRequest.value === 'pending')
const setupSessionOwned = computed(() => Boolean(installStatus.value?.setupSessionOwned))
const canEnterSetup = computed(() => Boolean(
  !installStatus.value?.ready
  && (installStatus.value?.canStartSetup || (setupSessionOwned.value && installStatus.value?.canInstall))
))
const isReadinessReady = computed(() => Boolean(
  !installStatus.value?.ready
  && setupSessionOwned.value
  && installStatus.value?.canInstall
))
const showExternalInstalling = computed(() => (
  phase.value === 'installing' || phase.value === 'setup_locked'
) && !submitting.value && !installationComplete.value)
const showSuccess = computed(() => installationComplete.value && !submitting.value)
const hasDeskSession = computed(() => signedIn.value || authStatus.value === 'authenticated')
const currentStep = computed(() => steps[activeStep.value - 1] || steps[0]!)

const administratorSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254, 'Email is too long.'),
  name: z.string().trim().max(100, 'Name must be 100 characters or fewer.'),
  password: z.string().min(12, 'Use at least 12 characters.').max(256, 'Password is too long.'),
  passwordConfirm: z.string().min(1, 'Confirm your password.')
}).refine(values => values.password === values.passwordConfirm, {
  path: ['passwordConfirm'],
  message: 'Passwords do not match.'
})

const summaryItems = computed(() => [
  { label: 'Account email', value: state.email || 'Not set' },
  { label: 'Name', value: state.name.trim() || 'Not set' },
  { label: 'Starter content', value: state.sampleData ? 'Article schema + Welcome guide' : 'Skip' }
])

const missingBindingsDescription = computed(() => {
  const bindings = installStatus.value?.missingBindings || []
  const requirements: string[] = []
  if (bindings.includes('DB')) requirements.push('a D1 database binding named DB')
  if (bindings.includes('CONTENT_ASSETS')) requirements.push('an R2 bucket binding named CONTENT_ASSETS')
  const unknown = bindings.filter(binding => binding !== 'DB' && binding !== 'CONTENT_ASSETS')
  requirements.push(...unknown.map(binding => `a binding named ${binding}`))
  return requirements.length
    ? `Add ${requirements.join(' and ')} to this Worker, redeploy, and check again.`
    : 'Add the required Cloudflare bindings to this Worker, redeploy, and check again.'
})

const readinessMessage = computed(() => {
  if (installStatusError.value) {
    return {
      color: 'error' as const,
      icon: 'i-lucide-cloud-off',
      title: 'We could not check your HaloPress',
      description: 'Check your connection and try again. If this keeps happening, ask the deployment owner to review the logs.'
    }
  }

  switch (phase.value) {
    case 'binding_missing':
      return {
        color: 'error' as const,
        icon: 'i-lucide-database-zap',
        title: 'Storage needs attention',
        description: 'HaloPress cannot reach all the storage it needs yet. Open the troubleshooting details for repair steps.'
      }
    case 'migration_required':
      return {
        color: 'warning' as const,
        icon: 'i-lucide-database-backup',
        title: 'Deployment setup needs a quick repair',
        description: 'A required setup step is unfinished. Open the troubleshooting details for the repair command.'
      }
    case 'configuration_required':
      return {
        color: 'warning' as const,
        icon: 'i-lucide-settings',
        title: 'Deployment setup needs a quick repair',
        description: 'The automatic deployment configuration is incomplete. Open the troubleshooting details for repair steps.'
      }
    case 'resume_required':
      return {
        color: 'warning' as const,
        icon: 'i-lucide-rotate-ccw',
        title: 'Continue setting up HaloPress',
        description: 'A previous attempt stopped before completion. Continue with the same account email and password.'
      }
    case 'ready_for_setup':
      return {
        color: 'success' as const,
        icon: 'i-lucide-circle-check-big',
        title: 'Your HaloPress is ready to set up',
        description: setupSessionOwned.value
          ? 'Continue where you left off in this browser.'
          : 'Start setup to begin. This browser will hold your place while you finish.'
      }
    default:
      return {
        color: 'neutral' as const,
        icon: 'i-lucide-loader-circle',
        title: 'Checking your HaloPress',
        description: 'This will only take a moment.'
      }
  }
})

const remediationCommand = computed(() => {
  if (!isMigrationRequired.value) return ''
  if (installStatus.value?.runtime === 'cloudflare') return 'pnpm exec wrangler d1 migrations apply DB --remote'
  if (installStatus.value?.runtime === 'local') return 'pnpm db:d1:apply:local'
  return 'pnpm db:migrate'
})

watch(() => state.email, () => {
  serverFieldErrors.email = undefined
})
watch(() => state.password, () => {
  serverFieldErrors.password = undefined
})
watch(activeStep, () => {
  void focusHeading(stepHeading)
})

watch([showExternalInstalling, showSuccess], ([installing, complete]) => {
  if (installing || complete) void focusHeading(stateHeading)
})

async function focusHeading(target: Ref<HTMLElement | null>) {
  await nextTick()
  if (!import.meta.client || !target.value) return
  target.value.focus({ preventScroll: true })
  target.value.scrollIntoView({ block: 'start', behavior: 'auto' })
}

function goToStep(step: number) {
  if (submitting.value) return
  activeStep.value = Math.min(Math.max(step, 1), steps.length)
}

async function onFormError(event: FormErrorEvent) {
  if (!import.meta.client) return
  const firstError = event.errors[0]
  if (!firstError) return
  await nextTick()
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
  const byId = firstError.id ? document.getElementById(firstError.id) : null
  const byName = firstError.name
    ? document.querySelector<HTMLElement>(`[name="${firstError.name}"]`)
    : null
  const invalidField = document.querySelector<HTMLElement>('[aria-invalid="true"]')
  const target = byName || invalidField || byId
  target?.focus()
}

async function refreshReadiness() {
  if (refreshing.value) return
  refreshing.value = true
  installError.value = null
  reservationError.value = null
  try {
    await refreshInstallStatus()
    if (installStatus.value?.ready || installStatus.value?.phase === 'complete') {
      installationComplete.value = true
    }
  } finally {
    refreshing.value = false
  }
}

async function migrateCloudflareDatabase() {
  if (migratingDatabase.value || !isCloudflareRuntime.value || !isMigrationRequired.value) return
  migratingDatabase.value = true
  migrationError.value = null
  try {
    await $fetch('/api/system/install/migrate', {
      method: 'POST',
      credentials: 'include'
    })
    await refreshInstallStatus()
    if (installStatus.value?.ready) await navigateTo('/')
  } catch (rawError) {
    migrationError.value = {
      title: 'Database update did not finish',
      description: failureMessage(rawError as FetchFailure)
    }
  } finally {
    migratingDatabase.value = false
  }
}

onMounted(() => {
  if (isCloudflareRuntime.value && isMigrationRequired.value) {
    void migrateCloudflareDatabase()
  }
})

async function copyRemediationCommand() {
  if (!import.meta.client || !remediationCommand.value) return
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    toast.add({
      title: 'Could not copy the command',
      description: 'Select the command and copy it manually.',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
    return
  }
  try {
    await navigator.clipboard.writeText(remediationCommand.value)
    commandCopied.value = true
    toast.add({
      title: 'Migration command copied',
      color: 'success',
      icon: 'i-lucide-check'
    })
    window.setTimeout(() => {
      commandCopied.value = false
    }, 2000)
  } catch {
    toast.add({
      title: 'Could not copy the command',
      description: 'Select the command and copy it manually.',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  }
}

async function reserveSetupSession() {
  if (claimingSession.value || !canEnterSetup.value) return
  if (isReadinessReady.value) {
    goToStep(2)
    return
  }
  claimingSession.value = true
  reservationError.value = null
  try {
    await $fetch('/api/system/install/session', {
      method: 'POST',
      credentials: 'include'
    })
    await refreshInstallStatus()
    goToStep(2)
  } catch (rawError) {
    const error = rawError as FetchFailure
    await refreshInstallStatus()
    const statusCode = error.statusCode || error.status
    reservationError.value = {
      title: statusCode === 409 ? 'Setup is reserved in another browser' : 'Could not start setup',
      description: statusCode === 409
        ? `Another browser is setting up this site. Try again${installStatus.value?.retryAfterSeconds ? ` in about ${installStatus.value.retryAfterSeconds} seconds` : ' after the current session expires'}.`
        : failureMessage(error)
    }
  } finally {
    claimingSession.value = false
  }
}

function clearServerErrors() {
  for (const key of Object.keys(serverFieldErrors)) {
    serverFieldErrors[key] = undefined
  }
}

function failureDetails(error: FetchFailure): InstallFailureDetails {
  return error.data?.data || error.data || {}
}

function failureMessage(error: FetchFailure) {
  return error.statusMessage
    || error.data?.statusMessage
    || error.message
    || 'Please check the setup details and try again.'
}

function applyServerIssues(issues: InstallIssue[]) {
  let targetStep = activeStep.value
  for (const issue of issues) {
    if (!issue.path || !issue.message) continue
    serverFieldErrors[issue.path] = issue.message
    if (['email', 'name', 'password'].includes(issue.path)) targetStep = 2
  }
  goToStep(targetStep)
}

async function attemptAutomaticSignIn() {
  signedIn.value = false
  signInWarning.value = ''

  try {
    const result = await signIn('credentials', {
      identifier: state.email,
      password: state.password,
      redirect: false,
      callbackUrl: '/_desk'
    })
    if (result?.error) throw new Error(result.error)
    signedIn.value = true
  } catch {
    signInWarning.value = 'Setup finished successfully, but automatic sign-in did not. Sign in with the administrator account you just created.'
  }
}

async function recoverAmbiguousInstall() {
  try {
    await refreshInstallStatus()
  } catch {
    return false
  }

  if (!installStatus.value?.ready && installStatus.value?.phase !== 'complete') return false
  completedInThisSession.value = true
  await attemptAutomaticSignIn()
  installationComplete.value = true
  return true
}

async function completeSetup() {
  if (submitting.value || !isReadinessReady.value) return
  submitting.value = true
  installError.value = null
  signInWarning.value = ''
  clearServerErrors()
  await focusHeading(stateHeading)

  try {
    await $fetch('/api/system/install', {
      method: 'POST',
      credentials: 'include',
      body: {
        email: state.email,
        name: state.name,
        password: state.password,
        sampleData: state.sampleData
      }
    })

    completedInThisSession.value = true
    await refreshInstallStatus()
    await attemptAutomaticSignIn()
    installationComplete.value = true
  } catch (rawError) {
    const error = rawError as FetchFailure
    if (await recoverAmbiguousInstall()) return

    const details = failureDetails(error)
    if (details.issues?.length) applyServerIssues(details.issues)

    const statusCode = error.statusCode || error.status
    const message = failureMessage(error)
    const normalizedMessage = message.toLowerCase()
    const invalidSetupSession = statusCode === 401 && normalizedMessage.includes('setup session')
    const invalidAdminCredentials = statusCode === 401 && normalizedMessage.includes('admin credentials')

    if (invalidSetupSession) {
      goToStep(1)
      await refreshInstallStatus()
    } else if (invalidAdminCredentials) {
      serverFieldErrors.email = 'Use the administrator email from the previous setup attempt.'
      serverFieldErrors.password = 'The administrator email and password did not match.'
      goToStep(2)
    } else if (details.phase === 'binding_missing'
      || details.phase === 'migration_required'
      || details.phase === 'configuration_required') {
      goToStep(1)
      await refreshInstallStatus()
    }

    installError.value = {
      title: statusCode === 409
        ? 'Setup is already running'
        : invalidAdminCredentials
          ? 'Administrator credentials did not match'
          : 'Setup did not finish',
      description: statusCode === 409
        ? 'Another setup request is in progress. Wait a moment, check readiness, and then continue.'
        : invalidAdminCredentials
          ? 'This is a resumed setup. Enter the same administrator email and password used by the previous attempt.'
          : message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-muted/30">
    <main class="flex min-h-dvh items-center">
      <UContainer class="w-full py-6 sm:py-10 lg:py-12">
        <section aria-labelledby="install-page-title" class="mx-auto w-full max-w-4xl space-y-6">
          <div
            v-if="!isMigrationRequired"
            class="relative aspect-[3/1] overflow-hidden rounded-xl border border-default bg-inverted shadow-lg"
          >
            <img
              src="/branding/halopress-install-wizard-journey.png"
              alt=""
              aria-hidden="true"
              width="2172"
              height="724"
              fetchpriority="high"
              decoding="async"
              class="size-full object-cover"
            >
            <div class="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-3 sm:p-4">
              <div class="rounded-lg bg-default/90 px-3 py-2 shadow-sm backdrop-blur">
                <AppLogo class="h-6 w-auto shrink-0 sm:h-7" />
              </div>
              <UColorModeButton class="min-h-11 min-w-11 rounded-lg bg-default/90 shadow-sm backdrop-blur" />
            </div>
          </div>

          <div v-else class="flex items-center justify-between gap-4">
            <AppLogo class="h-7 w-auto shrink-0" />
            <UColorModeButton class="min-h-11 min-w-11" />
          </div>

          <div class="space-y-2">
            <p class="text-sm font-medium text-primary">
              {{ isMigrationRequired ? 'Site maintenance' : 'First-run setup' }}
            </p>
            <h1 id="install-page-title" class="text-2xl font-semibold text-highlighted sm:text-3xl">
              {{ isMigrationRequired ? 'Database update required' : 'Welcome to HaloPress' }}
            </h1>
            <p class="max-w-2xl text-sm text-muted sm:text-base">
              <template v-if="isMigrationRequired">
                HaloPress detected a newer database structure. Update it before the site can continue.
              </template>
              <template v-else>
                Create your account, choose helpful starter content, and start publishing.
                HaloPress will guide you through each step.
              </template>
            </p>
          </div>

          <UCard v-if="isMigrationRequired" variant="subtle">
            <div class="space-y-6 py-4 sm:px-4 sm:py-6">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <UIcon name="i-lucide-database-backup" class="size-6" />
                </div>
                <div class="space-y-2">
                  <h2 class="text-xl font-semibold text-highlighted">Update the HaloPress database</h2>
                  <p class="text-sm text-muted sm:text-base">
                    This is database maintenance, not first-run setup.
                    It will not recreate the administrator account or start the setup wizard again.
                  </p>
                </div>
              </div>

              <UAlert
                color="info"
                variant="subtle"
                icon="i-lucide-shield-check"
                title="Your site data stays in place"
                description="The migration applies the versioned database changes included with this HaloPress update. It does not reset the site or replace existing content."
              />

              <div class="space-y-3 rounded-lg border border-default bg-muted/30 px-4 py-4">
                <p class="text-sm font-medium text-highlighted">
                  {{ isCloudflareRuntime ? 'Update with Wrangler' : 'Update the local database' }}
                </p>
                <p class="text-sm text-muted">
                  <template v-if="isCloudflareRuntime">
                    Run this from a cloned repository with Cloudflare credentials:
                  </template>
                  <template v-else>
                    Stop the development server, run this from the repository, and then start <code>pnpm dev</code> again:
                  </template>
                </p>
                <div class="flex items-center rounded-lg bg-elevated">
                  <code class="min-w-0 flex-1 overflow-x-auto px-4 py-3 text-xs text-highlighted sm:text-sm">{{ remediationCommand }}</code>
                  <UTooltip :text="commandCopied ? 'Copied' : 'Copy command'">
                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      square
                      :icon="commandCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                      :aria-label="commandCopied ? 'Migration command copied' : 'Copy migration command'"
                      class="mr-2 shrink-0"
                      @click="copyRemediationCommand"
                    />
                  </UTooltip>
                </div>
                <p v-if="installStatus?.missingTables?.length" class="break-words text-xs text-muted sm:text-sm">
                  Missing tables: {{ installStatus.missingTables.join(', ') }}
                </p>
              </div>

              <div v-if="isCloudflareRuntime" class="space-y-3 rounded-lg border border-default px-4 py-4">
                <div class="space-y-1">
                  <p class="text-sm font-medium text-highlighted">
                    {{ migratingDatabase ? 'Updating the database automatically' : 'Automatic database update' }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ migratingDatabase
                      ? 'Keep this page open. HaloPress is applying the bundled migrations through the deployed Worker.'
                      : migrationError
                        ? 'The automatic update stopped. Retry it here or use the Wrangler command above.'
                        : 'HaloPress will apply the bundled migrations through the deployed Worker.' }}
                  </p>
                </div>
                <UProgress
                  v-if="migratingDatabase"
                  animation="swing"
                  size="sm"
                  aria-label="Database update in progress"
                />
                <UButton
                  v-if="migrationError"
                  type="button"
                  icon="i-lucide-database-zap"
                  class="min-h-11 justify-center"
                  :loading="migratingDatabase"
                  :disabled="migratingDatabase"
                  @click="migrateCloudflareDatabase"
                >
                  Retry database update
                </UButton>
              </div>

              <UAlert
                v-if="migrationError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :title="migrationError.title"
                :description="migrationError.description"
              />

              <div class="flex justify-start">
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-refresh-cw"
                  class="min-h-11 justify-center"
                  :loading="isCheckingReadiness"
                  @click="refreshReadiness"
                >
                  Check again
                </UButton>
              </div>
            </div>
          </UCard>

          <UCard v-else-if="submitting || showExternalInstalling" variant="subtle">
            <div class="space-y-6 py-4 sm:px-4 sm:py-8">
              <div class="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin motion-reduce:animate-none" />
              </div>
              <div class="mx-auto max-w-xl space-y-2 text-center">
                <h2
                  ref="stateHeading"
                  tabindex="-1"
                  class="scroll-mt-24 text-xl font-semibold text-highlighted outline-none"
                >
                  {{ submitting
                    ? 'Preparing your HaloPress'
                    : setupSessionOwned
                      ? 'Your setup is still active'
                      : 'Setup is open in another browser' }}
                </h2>
                <p class="text-sm text-muted" role="status" aria-live="polite">
                  {{ submitting
                    ? 'We are creating your account and getting your content space ready. Keep this tab open.'
                    : setupSessionOwned
                      ? 'Check again in a moment to continue.'
                      : `Another browser is setting up this site. Check again${installStatus?.retryAfterSeconds ? ` in about ${installStatus.retryAfterSeconds} seconds` : ' after its place is released'}.` }}
                </p>
              </div>
              <UProgress animation="swing" size="sm" aria-label="Setup in progress" />
              <div v-if="showExternalInstalling" class="flex justify-center">
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-refresh-cw"
                  class="min-h-11"
                  :loading="refreshing"
                  @click="refreshReadiness"
                >
                  Check again
                </UButton>
              </div>
            </div>
          </UCard>

          <UCard v-else-if="showSuccess" variant="subtle">
            <div class="space-y-6 py-4 sm:px-4 sm:py-8">
              <div class="mx-auto flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
                <UIcon name="i-lucide-circle-check-big" class="size-9" />
              </div>
              <div class="mx-auto max-w-xl space-y-2 text-center">
                <h2
                  ref="stateHeading"
                  tabindex="-1"
                  class="scroll-mt-24 text-2xl font-semibold text-highlighted outline-none"
                >
                  HaloPress is ready
                </h2>
                <p class="text-sm text-muted sm:text-base">
                  Your account and content space are ready. Choose where you want to begin.
                </p>
              </div>

              <UAlert
                v-if="signInWarning"
                color="warning"
                variant="subtle"
                icon="i-lucide-log-in"
                title="Sign in to continue"
                :description="signInWarning"
              />

              <div class="mx-auto grid max-w-xl gap-3 sm:grid-cols-2">
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <p class="text-sm font-medium text-highlighted">Your account</p>
                  <p class="mt-1 text-sm text-muted">{{ state.email || `${installStatus?.userCount || 1} account ready` }}</p>
                </div>
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <p class="text-sm font-medium text-highlighted">Content</p>
                  <p class="mt-1 text-sm text-muted">
                    {{ completedInThisSession && state.sampleData
                      ? 'Article schema and Welcome guide created'
                      : `${installStatus?.schemaCount || 0} schemas ready` }}
                  </p>
                </div>
              </div>

              <div class="flex flex-col justify-center gap-3 sm:flex-row">
                <UButton
                  :to="hasDeskSession ? '/_desk' : '/_desk/login'"
                  icon="i-lucide-layout-dashboard"
                  class="min-h-11 justify-center"
                >
                  {{ hasDeskSession ? 'Open Desk' : 'Sign in to Desk' }}
                </UButton>
                <UButton
                  to="/"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-external-link"
                  class="min-h-11 justify-center"
                >
                  View site
                </UButton>
                <UButton
                  v-if="hasDeskSession && completedInThisSession && state.sampleData"
                  to="/_desk/content/article/halopress-welcome-guide"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-book-open"
                  class="min-h-11 justify-center"
                >
                  Open Welcome guide
                </UButton>
              </div>
            </div>
          </UCard>

          <UCard v-else variant="subtle">
            <div class="hidden md:block" aria-hidden="true">
              <UStepper :model-value="activeStep - 1" :items="steps" disabled aria-hidden="true" class="w-full" />
            </div>

            <p class="sr-only" role="status" aria-live="polite">
              Step {{ activeStep }} of {{ steps.length }}: {{ currentStep.title }}
            </p>

            <div class="space-y-3 md:hidden">
              <div class="flex items-center justify-between gap-4 text-sm">
                <span class="font-medium text-highlighted">Step {{ activeStep }} of {{ steps.length }}</span>
                <span class="truncate text-muted">{{ currentStep.title }}</span>
              </div>
              <UProgress
                :model-value="activeStep"
                :max="steps.length"
                size="sm"
                aria-label="Setup progress"
              />
            </div>

            <div class="mt-6 border-t border-default pt-6 sm:mt-8 sm:pt-8">
              <section v-if="activeStep === 1" class="space-y-6" aria-labelledby="readiness-heading">
                <div class="space-y-2">
                  <h2
                    id="readiness-heading"
                    ref="stepHeading"
                    tabindex="-1"
                    class="scroll-mt-24 text-xl font-semibold text-highlighted outline-none"
                  >
                    Make sure HaloPress is ready
                  </h2>
                  <p class="text-sm text-muted">
                    We will make sure everything is ready before you create your account.
                  </p>
                </div>

                <UAlert
                  :color="readinessMessage.color"
                  variant="subtle"
                  :icon="readinessMessage.icon"
                  :title="readinessMessage.title"
                  :description="readinessMessage.description"
                />

                <details
                  v-if="phase === 'binding_missing' || phase === 'migration_required' || phase === 'configuration_required'"
                  class="rounded-lg border border-default px-4 py-3"
                >
                  <summary class="cursor-pointer text-sm font-medium text-highlighted">Troubleshooting details</summary>
                  <div class="mt-3 space-y-3 text-xs text-muted sm:text-sm">
                    <template v-if="phase === 'binding_missing'">
                      <p>{{ missingBindingsDescription }}</p>
                      <p>For one-click deployments, redeploy the latest template. From a cloned repository, run <code>pnpm deploy</code> after checking the Cloudflare bindings.</p>
                    </template>
                    <template v-else-if="phase === 'migration_required'">
                      <p>The D1 database migrations are incomplete. Run this from a cloned repository:</p>
                      <code class="block overflow-x-auto rounded-lg bg-elevated px-4 py-3 text-xs text-highlighted sm:text-sm">{{ remediationCommand }}</code>
                      <p v-if="installStatus?.missingTables?.length" class="break-words">
                        Missing tables: {{ installStatus.missingTables.join(', ') }}
                      </p>
                      <p>For a one-click deployment, redeploy the latest template so the deployment process can apply migrations.</p>
                    </template>
                    <template v-else>
                      <p>The deployment secret was not provisioned. From a cloned repository, redeploy with this command to repair it:</p>
                      <code class="block overflow-x-auto rounded-lg bg-elevated px-4 py-3 text-xs text-highlighted sm:text-sm">pnpm deploy</code>
                      <p>For a one-click deployment, redeploy the latest template.</p>
                    </template>
                  </div>
                </details>

                <UAlert
                  v-if="installStatus?.hasLastError && phase === 'resume_required'"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-info"
                  title="Use the same account details"
                  description="HaloPress can safely finish the previous attempt without creating a duplicate account."
                />

                <UAlert
                  v-if="reservationError"
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-lock-keyhole"
                  :title="reservationError.title"
                  :description="reservationError.description"
                />

                <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-refresh-cw"
                    class="min-h-11 justify-center"
                    :loading="isCheckingReadiness"
                    @click="refreshReadiness"
                  >
                    Check again
                  </UButton>
                  <UButton
                    v-if="canEnterSetup"
                    type="button"
                    trailing-icon="i-lucide-arrow-right"
                    class="min-h-11 justify-center"
                    :loading="claimingSession"
                    @click="reserveSetupSession"
                  >
                    {{ isReadinessReady ? 'Continue setup' : 'Start setup' }}
                  </UButton>
                </div>
              </section>

              <section v-else-if="activeStep === 2" class="space-y-6" aria-labelledby="administrator-heading">
                <div class="space-y-2">
                  <h2
                    id="administrator-heading"
                    ref="stepHeading"
                    tabindex="-1"
                    class="scroll-mt-24 text-xl font-semibold text-highlighted outline-none"
                  >
                    Create your account
                  </h2>
                  <p class="text-sm text-muted">
                    Use an inbox you control. As the first account, you can manage content, people, and site settings.
                  </p>
                </div>

                <UForm
                  :state="state"
                  :schema="administratorSchema"
                  class="space-y-5"
                  @submit="goToStep(3)"
                  @error="onFormError"
                >
                  <UFormField
                    label="Email address"
                    name="email"
                    required
                    help="Used to sign in and identify changes in the Desk."
                    :error="serverFieldErrors.email"
                  >
                    <UInput
                      v-model="state.email"
                      type="email"
                      autocomplete="email"
                      inputmode="email"
                      class="w-full"
                      placeholder="admin@example.com"
                    />
                  </UFormField>

                  <UFormField
                    label="Name"
                    name="name"
                    help="Optional. Shown in author bylines and audit trails."
                    :error="serverFieldErrors.name"
                  >
                    <UInput v-model="state.name" autocomplete="name" class="w-full" placeholder="Your name" />
                  </UFormField>

                  <div class="grid gap-5 sm:grid-cols-2">
                    <UFormField
                      label="Password"
                      name="password"
                      required
                      help="Use at least 12 characters."
                      :error="serverFieldErrors.password"
                    >
                      <UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
                    </UFormField>
                    <UFormField
                      label="Confirm password"
                      name="passwordConfirm"
                      required
                      help="Type the same password again."
                    >
                      <UInput v-model="state.passwordConfirm" type="password" autocomplete="new-password" class="w-full" />
                    </UFormField>
                  </div>

                  <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-arrow-left" class="min-h-11 justify-center" @click="goToStep(1)">
                      Back
                    </UButton>
                    <UButton type="submit" trailing-icon="i-lucide-arrow-right" class="min-h-11 justify-center">
                      Continue
                    </UButton>
                  </div>
                </UForm>
              </section>

              <section v-else-if="activeStep === 3" class="space-y-6" aria-labelledby="starter-heading">
                <div class="space-y-2">
                  <h2
                    id="starter-heading"
                    ref="stepHeading"
                    tabindex="-1"
                    class="scroll-mt-24 text-xl font-semibold text-highlighted outline-none"
                  >
                    Add starter content
                  </h2>
                  <p class="text-sm text-muted">
                    The starter content makes it easier to learn the Desk. You can edit or delete it later.
                  </p>
                </div>

                <USwitch
                  id="sample-data"
                  v-model="state.sampleData"
                  name="sampleData"
                  size="lg"
                  label="Create an Article type and Welcome guide"
                  description="Adds an editable content type and one example guide. Recommended if this is your first time using HaloPress."
                  class="min-h-14 w-full cursor-pointer rounded-lg p-4 ring-1 ring-default"
                  :ui="{
                    base: 'after:absolute after:inset-0',
                    container: 'order-last',
                    wrapper: 'order-first ms-0 me-auto',
                    label: 'cursor-pointer',
                    description: 'cursor-pointer'
                  }"
                />

                <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-arrow-left" class="min-h-11 justify-center" @click="goToStep(2)">
                    Back
                  </UButton>
                  <UButton type="button" trailing-icon="i-lucide-arrow-right" class="min-h-11 justify-center" @click="goToStep(4)">
                    Review setup
                  </UButton>
                </div>
              </section>

              <section v-else class="space-y-6" aria-labelledby="review-heading">
                <div class="space-y-2">
                  <h2
                    id="review-heading"
                    ref="stepHeading"
                    tabindex="-1"
                    class="scroll-mt-24 text-xl font-semibold text-highlighted outline-none"
                  >
                    Review and start
                  </h2>
                  <p class="text-sm text-muted">
                    HaloPress will create your account, prepare its permissions, and add the starter content you selected.
                  </p>
                </div>

                <UAlert
                  v-if="installError"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  :title="installError.title"
                  :description="installError.description"
                />

                <div class="overflow-hidden rounded-lg border border-default bg-default">
                  <dl class="divide-y divide-default">
                    <div v-for="item in summaryItems" :key="item.label" class="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6">
                      <dt class="text-sm text-muted">{{ item.label }}</dt>
                      <dd class="break-words text-sm font-medium text-highlighted sm:text-right">{{ item.value }}</dd>
                    </div>
                  </dl>
                </div>

                <div class="flex flex-wrap gap-2" aria-label="Edit setup choices">
                  <UButton type="button" color="neutral" variant="outline" class="min-h-11" @click="goToStep(2)">Edit account</UButton>
                  <UButton type="button" color="neutral" variant="outline" class="min-h-11" @click="goToStep(3)">Edit starter content</UButton>
                </div>

                <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-arrow-left" class="min-h-11 justify-center" @click="goToStep(3)">
                    Back
                  </UButton>
                  <UButton
                    type="button"
                    icon="i-lucide-rocket"
                    class="min-h-11 justify-center"
                    :loading="submitting"
                    :disabled="!isReadinessReady"
                    @click="completeSetup"
                  >
                    Start HaloPress
                  </UButton>
                </div>
              </section>
            </div>
          </UCard>

          <p class="text-center text-xs text-muted">
            This browser holds your place while you work, so you can safely continue after an interruption.
          </p>
        </section>
      </UContainer>
    </main>
  </div>
</template>
