<script setup lang="ts">
definePageMeta({
  layout: 'desk'
})

const locale = useDisplayLocale()
const status = ref<'all' | 'draft' | 'published' | 'archived' | 'deleted'>('all')
const query = computed(() => ({
  limit: 100,
  status: status.value === 'all' ? undefined : status.value
}))
const statusOptions = [
  { label: 'Active pages', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Archived', value: 'archived' },
  { label: 'Deleted', value: 'deleted' }
]
const { data, pending, refresh } = await useFetch<{ items: Array<{ id: string; title: string | null; status: string; createdAt: string; updatedAt: string }> }>('/api/page', {
  query
})

const formatUpdatedAt = (value: string) => formatDateTime(value, locale.value)
</script>

<template>
  <UDashboardPanel id="desk-pages">
    <template #header>
      <DeskNavbar title="Pages" description="Build and publish standalone pages for your site.">
        <template #actions>
          <UButton icon="i-lucide-plus" color="primary" to="/_desk/pages/new">
            New Page
          </UButton>
        </template>
      </DeskNavbar>

      <UDashboardToolbar>
        <template #left>
          <USelect v-model="status" :items="statusOptions" class="w-44" />
        </template>
        <template #right>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-cw"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <UPageGrid>
        <UCard
          v-for="page in (data?.items || [])"
          :key="page.id"
          :ui="{ root: 'overflow-hidden', body: 'p-4', footer: 'p-3 sm:p-4' }"
        >
          <template #default>
            <NuxtLink :to="`/_desk/pages/${page.id}`" class="block">
              <div class="text-base font-semibold truncate">
                {{ page.title || 'Untitled Page' }}
              </div>
              <div class="text-xs text-muted mt-1">
                Updated {{ formatUpdatedAt(page.updatedAt) }}
              </div>
            </NuxtLink>
          </template>

          <template #footer>
            <div class="flex items-center justify-between">
              <UBadge variant="soft">
                {{ page.status }}
              </UBadge>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                :loading="pending"
                @click="refresh()"
              />
            </div>
          </template>
        </UCard>
      </UPageGrid>
    </template>
  </UDashboardPanel>
</template>
