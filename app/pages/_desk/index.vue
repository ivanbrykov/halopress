<script setup lang="ts">
definePageMeta({
  layout: 'desk'
})

const { data: schemas, refresh } = await useFetch<{ items: Array<{ schemaKey: string; title?: string; activeVersion: number }> }>('/api/schema/list')
const { data: userStats } = await useFetch<{ total: number }>('/api/users/stats')
const toast = useToast()

const schemaCount = computed(() => schemas.value?.items?.length ?? 0)
const userCount = computed(() => userStats.value?.total ?? 0)
const hasSchemas = computed(() => schemaCount.value > 0)

async function bootstrap() {
  try {
    await $fetch('/api/system/bootstrap', { method: 'POST' })
    toast.add({ title: 'Starter Article ready', description: 'You can start creating content now.' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Starter setup failed', description: e?.statusMessage || 'Error', color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="desk-home">
    <template #header>
      <DeskNavbar title="Dashboard" description="Track setup progress and jump back into your work.">
      </DeskNavbar>
    </template>

    <template #body>
      <section class="relative mb-6 min-h-44 overflow-hidden rounded-xl border border-default">
        <AppBrandArtwork class="absolute inset-0 size-full" />
        <div class="absolute inset-0 bg-default/70 backdrop-blur-[1px]" />
        <div class="relative flex min-h-44 flex-col justify-end gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div class="max-w-xl rounded-lg bg-default/85 p-4 backdrop-blur-sm">
            <AppLogo class="mb-3 h-7 w-auto" />
            <h2 class="text-xl font-semibold text-highlighted">
              Welcome to HaloPress Desk
            </h2>
            <p class="mt-1 text-sm text-muted">
              Shape structured content, guide it through review, and publish with confidence.
            </p>
          </div>
          <UButton class="self-start sm:self-auto" to="/" color="neutral" variant="soft" trailing-icon="i-lucide-arrow-up-right">
            View site
          </UButton>
        </div>
      </section>

      <UPageGrid class="mb-6 items-start gap-4 sm:gap-6">
        <OnboardingWidget class="sm:col-span-2 lg:col-span-1" />

        <UCard class="transition hover:bg-elevated/40">
          <NuxtLink to="/_desk/users" class="block">
            <div class="flex items-center justify-between text-sm text-muted">
              <span>Users</span>
              <UIcon name="i-lucide-users" class="text-muted" />
            </div>
            <div class="mt-3 text-3xl font-semibold">
              {{ userCount }}
            </div>
            <p class="mt-1 text-xs text-muted">Active users</p>
          </NuxtLink>
        </UCard>

        <UCard class="transition hover:bg-elevated/40">
          <NuxtLink to="/_desk/schemas" class="block">
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">Schemas</span>
              <UBadge variant="soft" color="neutral">
                {{ schemaCount }}
              </UBadge>
            </div>
            <div class="mt-3 text-3xl font-semibold">
              {{ schemaCount }}
            </div>
            <p class="mt-1 text-xs text-muted">Registered schemas</p>
          </NuxtLink>
        </UCard>
      </UPageGrid>

      <UAlert v-if="!hasSchemas" title="No schemas yet"
        description="Create a content structure from scratch, or start with the ready-made Article setup." icon="i-lucide-sparkles"
        variant="subtle">
        <template #actions>
          <UButton to="/_desk/schemas/new" icon="i-lucide-plus">
            New schema
          </UButton>
          <UButton color="neutral" variant="outline" icon="i-lucide-wand-2" @click="bootstrap">
            Use starter Article
          </UButton>
        </template>
      </UAlert>
    </template>
  </UDashboardPanel>
</template>
