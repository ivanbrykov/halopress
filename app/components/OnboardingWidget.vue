<script setup lang="ts">
import {
  formatOnboardingProgressLabel,
  formatOnboardingProgressValue,
  getOnboardingItems,
  getOnboardingProgress,
  type OnboardingStatus
} from '../utils/onboarding'

const dismissed = useCookie<boolean>('halopress_onboarding_dismissed_v2', {
  default: () => false,
  path: '/_desk',
  sameSite: 'lax'
})

const { data, pending, error, refresh } = await useLazyFetch<OnboardingStatus>('/api/settings/onboarding', {
  immediate: !dismissed.value,
  server: false
})

const items = computed(() => data.value ? getOnboardingItems(data.value) : [])
const progress = computed(() => getOnboardingProgress(items.value))
const completedCount = computed(() => progress.value.completed)
const itemCount = computed(() => progress.value.total)
const isComplete = computed(() => data.value ? progress.value.complete : false)
const isVisible = computed(() => !dismissed.value && !isComplete.value)
let lastRefreshAt = 0

function getProgressLabel() {
  return formatOnboardingProgressLabel()
}

function getProgressValue(value: number | null | undefined, max: number) {
  return formatOnboardingProgressValue(value ?? 0, max)
}

function dismiss() {
  dismissed.value = true
}

function refreshWhenVisible() {
  if (document.visibilityState !== 'visible' || dismissed.value) return

  const now = Date.now()
  if (now - lastRefreshAt < 30_000) return

  lastRefreshAt = now
  void refresh()
}

onMounted(() => {
  lastRefreshAt = Date.now()
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  window.removeEventListener('focus', refreshWhenVisible)
})
</script>

<template>
  <UCard
    v-if="isVisible"
    variant="subtle"
    aria-labelledby="onboarding-widget-title"
    :ui="{
      body: 'p-3 sm:p-3'
    }"
  >
    <header class="flex items-start justify-between gap-2">
      <div class="flex min-w-0 items-baseline gap-2">
        <h2 id="onboarding-widget-title" class="truncate text-sm font-semibold text-highlighted">
          Setup checklist
        </h2>
        <p class="shrink-0 text-xs text-muted">
          <template v-if="data">
            {{ completedCount }}/{{ itemCount }} complete
          </template>
          <template v-else-if="error">
            Unavailable
          </template>
          <template v-else>
            Checking…
          </template>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-0.5">
        <UButton
          v-if="data"
          icon="i-lucide-rotate-cw"
          aria-label="Refresh onboarding status"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          :loading="pending"
          @click="refresh()"
        />
        <UButton
          label="Dismiss"
          aria-label="Dismiss onboarding for now"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="dismiss"
        />
      </div>
    </header>

    <UProgress
      v-if="data && itemCount > 0"
      :model-value="completedCount"
      :max="itemCount"
      :get-value-label="getProgressLabel"
      :get-value-text="getProgressValue"
      size="xs"
      class="mt-2"
    />

    <ul v-if="data" class="mt-2 space-y-0.5" aria-label="Recommended setup checklist">
      <li v-for="item in items" :key="item.key">
        <ULink
          :to="item.to"
          :external="item.external"
          :target="item.external ? '_blank' : undefined"
          raw
          class="group flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 outline-primary/25 transition-colors hover:bg-elevated focus-visible:outline-3"
        >
          <UIcon
            :name="item.complete ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
            :class="item.complete ? 'text-success' : 'text-dimmed group-hover:text-primary'"
            class="size-4 shrink-0 transition-colors"
            aria-hidden="true"
          />
          <span
            class="min-w-0 truncate text-sm"
            :class="item.complete ? 'text-muted' : 'font-medium text-highlighted'"
          >
            {{ item.title }}
          </span>
          <span class="sr-only">
            — {{ item.complete ? 'Complete' : 'Not complete' }}<template v-if="item.external">, opens in a new tab</template>
          </span>
        </ULink>
      </li>
    </ul>

    <div v-else-if="error" class="mt-2 flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted">
      <span>Could not load the checklist.</span>
      <UButton
        label="Retry"
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-lucide-rotate-cw"
        :loading="pending"
        @click="refresh()"
      />
    </div>

    <div v-else class="flex min-h-20 items-center justify-center" aria-live="polite">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
      <span class="sr-only">Loading onboarding status</span>
    </div>
  </UCard>
</template>
