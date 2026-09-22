<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

const [{ data }, { presentation }] = await Promise.all([
  useFetch<{ items: Array<{ schemaKey: string; title?: string; activeVersion: number }> }>('/api/schema/list'),
  useSitePresentation()
])
const schemas = computed(() => data.value?.items ?? [])

const schemaLinks = computed(() =>
  schemas.value.map((schema) => ({
    label: `${schema.title || schema.schemaKey} · v${schema.activeVersion}`,
    to: `/${schema.schemaKey}/`,
    icon: 'i-lucide-folder'
  }))
)

const heroLinks = [
  { label: 'Open Desk', to: '/_desk', color: 'primary' },
  { label: 'View Collections', to: '/#collections', variant: 'outline' }
] satisfies ButtonProps[]

const highlightFeatures = [
  {
    title: 'Schema-first',
    description: 'Define content once, ship to every channel.',
    icon: 'i-lucide-layers'
  },
  {
    title: 'Versioned content',
    description: 'Promote drafts with confidence and audit changes.',
    icon: 'i-lucide-git-branch'
  },
  {
    title: 'Composable delivery',
    description: 'Render collections anywhere with predictable APIs.',
    icon: 'i-lucide-panel-top'
  }
]

const curationSchema = computed(() => schemas.value[0]?.schemaKey || null)
const curationField = 'featured'
const curationValues = ['home']
const showCuration = computed(() => Boolean(curationSchema.value))
const showHaloPressBrandArtwork = computed(() =>
  presentation.value.general.siteName === 'HaloPress' && !presentation.value.general.logoUrl
)
</script>

<template>
  <UContainer>
    <UPage class="space-y-8">
      <template #left>
        <UPageAside>
          <UPageLinks title="Schemas" :links="schemaLinks" />
          <UAlert v-if="schemaLinks.length === 0" title="No schemas yet"
            description="Open Desk to publish your first schema." icon="i-lucide-info" variant="subtle"
            class="mt-4" />
        </UPageAside>
      </template>
      <template #right />

      <UPageBody>
        <UPageHero
          :title="presentation.general.siteName"
          headline="Schema-driven publishing"
          description="Design schemas once, publish structured content everywhere, and keep teams aligned with clear versions."
          :links="heroLinks"
          :orientation="showHaloPressBrandArtwork ? 'horizontal' : 'vertical'"
          :ui="showHaloPressBrandArtwork
            ? {
                container: 'gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]',
                wrapper: 'text-left',
                links: 'justify-start'
              }
            : { container: 'py-12 sm:py-16' }"
        >
          <AppBrandArtwork
            v-if="showHaloPressBrandArtwork"
            class="aspect-square w-full max-w-lg rounded-2xl border border-default shadow-lg"
            loading="eager"
            fetchpriority="high"
          />
        </UPageHero>

        <UPageSection title="Recent updates" description="Latest published entries by schema.">
          <UPageGrid v-if="schemas.length" class="gap-6">
            <RecentItems
              v-for="schema in schemas"
              :key="schema.schemaKey"
              :schema="schema.schemaKey"
              :title="schema.title || schema.schemaKey"
              subtitle="Recently published"
              :view-all-to="`/${schema.schemaKey}/`"
              sort="-created"
            >
              <template #default="{ items, pending, error, title, subtitle, viewAllTo, viewAllLabel, linkBase }">
                <UCard>
                  <template #header>
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <p v-if="subtitle" class="text-xs text-muted">{{ subtitle }}</p>
                        <h3 class="text-base font-semibold truncate">{{ title }}</h3>
                      </div>
                      <UButton
                        v-if="viewAllTo"
                        :to="viewAllTo"
                        size="xs"
                        variant="outline"
                        color="neutral"
                        trailing-icon="i-lucide-arrow-right"
                      >
                        {{ viewAllLabel }}
                      </UButton>
                    </div>
                  </template>

                  <div class="space-y-3">
                    <div v-if="pending && items.length === 0" class="space-y-3">
                      <div v-for="n in 3" :key="n" class="flex items-center gap-3">
                        <USkeleton class="h-12 w-12 rounded-md" />
                        <div class="flex-1 space-y-2">
                          <USkeleton class="h-4 w-2/3" />
                          <USkeleton class="h-3 w-1/2" />
                        </div>
                      </div>
                    </div>

                    <UAlert
                      v-else-if="error"
                      title="Unable to load"
                      description="Please try again in a moment."
                      icon="i-lucide-alert-circle"
                      color="neutral"
                      variant="subtle"
                    />

                    <UAlert
                      v-else-if="items.length === 0"
                      title="No items yet"
                      description="Publish content from Desk to populate the widgets."
                      icon="i-lucide-info"
                      variant="subtle"
                    />

                    <div v-else class="space-y-3">
                      <NuxtLink
                        v-for="item in items"
                        :key="item.id"
                        :to="item.publicPath || `${linkBase}/${item.id}`"
                        class="group flex items-center gap-3 rounded-md border border-default px-3 py-2 transition hover:bg-elevated/60"
                      >
                        <UAvatar
                          :src="item.image || undefined"
                          icon="i-lucide-image"
                          size="lg"
                          class="shrink-0 rounded-md"
                        />
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-highlighted truncate group-hover:underline">
                            {{ item.title || item.id }}
                          </div>
                          <p v-if="item.description" class="text-xs text-muted line-clamp-2">
                            {{ item.description }}
                          </p>
                        </div>
                      </NuxtLink>
                    </div>
                  </div>
                </UCard>
              </template>
            </RecentItems>
          </UPageGrid>

          <UAlert
            v-else
            title="No recent items"
            description="Publish content from Desk to populate the widgets."
            icon="i-lucide-info"
            variant="subtle"
            class="mt-6"
          />
        </UPageSection>

        <UPageSection title="Curated picks" description="Curations based on a field value filter.">
          <div v-if="showCuration">
            <CurationItems
              :schema="curationSchema!"
              :field="curationField"
              :values="curationValues"
              subtitle="Curated selection"
            >
              <template #default="{ items, pending, error, title, subtitle, linkBase }">
                <UCard>
                  <template #header>
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <p v-if="subtitle" class="text-xs text-muted">{{ subtitle }}</p>
                        <h3 class="text-base font-semibold truncate">{{ title }}</h3>
                      </div>
                    </div>
                  </template>

                  <div class="space-y-3">
                    <div v-if="pending && items.length === 0" class="space-y-3">
                      <div v-for="n in 3" :key="n" class="flex items-center gap-3">
                        <USkeleton class="h-12 w-12 rounded-md" />
                        <div class="flex-1 space-y-2">
                          <USkeleton class="h-4 w-2/3" />
                          <USkeleton class="h-3 w-1/2" />
                        </div>
                      </div>
                    </div>

                    <UAlert
                      v-else-if="error"
                      title="Unable to load"
                      description="Please try again in a moment."
                      icon="i-lucide-alert-circle"
                      color="neutral"
                      variant="subtle"
                    />

                    <UAlert
                      v-else-if="items.length === 0"
                      title="No curated items"
                      description="Nothing matched the curations yet."
                      icon="i-lucide-info"
                      variant="subtle"
                    />

                    <div v-else class="space-y-3">
                      <NuxtLink
                        v-for="item in items"
                        :key="item.id"
                        :to="item.publicPath || `${linkBase}/${item.id}`"
                        class="group flex items-center gap-3 rounded-md border border-default px-3 py-2 transition hover:bg-elevated/60"
                      >
                        <UAvatar
                          :src="item.image || undefined"
                          icon="i-lucide-image"
                          size="lg"
                          class="shrink-0 rounded-md"
                        />
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-highlighted truncate group-hover:underline">
                            {{ item.title || item.id }}
                          </div>
                          <p v-if="item.description" class="text-xs text-muted line-clamp-2">
                            {{ item.description }}
                          </p>
                        </div>
                      </NuxtLink>
                    </div>
                  </div>
                </UCard>
              </template>
            </CurationItems>
          </div>

          <UAlert
            v-else
            title="Curation not configured"
            description="Publish a schema to render curated picks."
            icon="i-lucide-info"
            variant="subtle"
            class="mt-6"
          />
        </UPageSection>

        <UPageSection title="Why HaloPress" description="Everything you need to move from schema to delivery."
          :features="highlightFeatures" />

        <UPageSection id="collections" title="Collections" description="Active schemas published in this tenant.">
          <UPageGrid>
            <UPageCard v-for="s in schemas" :key="s.schemaKey" :title="s.title || s.schemaKey"
              :description="`v${s.activeVersion}`" :to="`/${s.schemaKey}/`" icon="i-lucide-folder" />
          </UPageGrid>

          <UAlert v-if="schemas.length === 0" title="No schemas published yet"
            description="Go to Desk → Schemas to publish your first schema." icon="i-lucide-info" variant="subtle"
            class="mt-6" />
        </UPageSection>
      </UPageBody>
    </UPage>
  </UContainer>
</template>
