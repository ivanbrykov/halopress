<script setup lang="ts">
import type { BreadcrumbItem, NavigationMenuItem } from '@nuxt/ui'
import {
  schemaPresentationFromEditor,
  schemaPresentationForEditor,
  type SchemaPresentation
} from '~/utils/schema-presentation-settings'
import type { SchemaSearchField } from '~/utils/schema-search-configuration'

definePageMeta({
  layout: 'desk'
})

type RolePermission = {
  roleKey: string
  title: string | null
  level: number
  canRead: boolean
  canWrite: boolean
  canPublish: boolean
  canArchive: boolean
  canDelete: boolean
  canAdmin: boolean
  locked?: boolean
}

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirmDialog()

const schemaKey = computed(() => String(route.params.schemaKey))
const isNew = computed(() => schemaKey.value === 'new')

const toolbarItems = computed<NavigationMenuItem[]>(() => ([
  {
    label: 'Schema',
    icon: 'i-lucide-braces',
    to: `/_desk/schemas/${schemaKey.value}`,
    active: !route.path.endsWith('/settings')
  },
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: `/_desk/schemas/${schemaKey.value}/settings`,
    active: route.path.endsWith('/settings'),
    disabled: isNew.value
  }
]))

const breadcrumbItems = computed<BreadcrumbItem[]>(() => ([
  { label: 'Schemas', to: '/_desk/schemas' },
  { label: schemaKey.value },
  { label: 'Settings' }
]))

const {
  ast,
  published,
  pending: draftPending,
  status: draftStatus,
  error: draftError,
  saving: draftSaving,
  isDirty: draftDirty,
  differsFromPublished,
  conflict,
  save: saveDraftSettings,
  reloadLatest
} = await useSchemaSettingsDraft(schemaKey, () => !isNew.value)

useUnsavedNavigationGuard(draftDirty, 'You have unsaved Schema Settings changes. Leave and discard them?')

const fields = computed<SchemaSearchField[]>({
  get: () => (ast.value?.fields ?? []) as SchemaSearchField[],
  set: value => {
    if (ast.value) ast.value.fields = value
  }
})

const presentation = computed<SchemaPresentation>({
  get: () => schemaPresentationForEditor(ast.value?.presentation),
  set: value => {
    if (ast.value) {
      ast.value.presentation = schemaPresentationFromEditor(value, ast.value.presentation)
    }
  }
})

async function saveSettings() {
  try {
    if (await saveDraftSettings()) {
      toast.add({
        title: 'Schema Settings saved',
        description: 'The changes are in the Schema draft and remain unpublished.'
      })
    }
  } catch (error: any) {
    toast.add({
      title: 'Failed to save Schema Settings',
      description: error?.statusMessage || 'Error',
      color: 'error'
    })
  }
}

async function confirmReloadLatest() {
  if (draftDirty.value) {
    const accepted = await confirm({
      title: 'Reload the latest Schema draft?',
      body: 'Your local presentation and search selections will be discarded.',
      confirmLabel: 'Reload latest',
      confirmColor: 'warning'
    })
    if (!accepted) return
  }
  await reloadLatest()
}

const rolesUrl = computed(() => `/api/schema/${schemaKey.value}/roles`)
const { data: roleData, pending: rolesPending, refresh: refreshRoles } = await useFetch<{ items: RolePermission[] }>(rolesUrl, {
  server: true,
  immediate: !isNew.value
})

const roles = ref<RolePermission[]>([])
watch(roleData, value => {
  roles.value = value?.items ?? []
}, { immediate: true })

watch(schemaKey, async (value, previous) => {
  if (value === previous) return
  if (!value || value === 'new') {
    roles.value = []
    return
  }
  await refreshRoles()
})

const permissionSaving = reactive<Record<string, boolean>>({})

async function updatePermission(
  role: RolePermission,
  key: 'canRead' | 'canWrite' | 'canPublish' | 'canArchive' | 'canDelete' | 'canAdmin',
  value: boolean
) {
  if (role.locked || permissionSaving[role.roleKey]) return
  const previous = role[key]
  role[key] = value
  permissionSaving[role.roleKey] = true
  try {
    await $fetch(`/api/schema/${schemaKey.value}/roles`, {
      method: 'PATCH',
      body: {
        roleKey: role.roleKey,
        canRead: role.canRead,
        canWrite: role.canWrite,
        canPublish: role.canPublish,
        canArchive: role.canArchive,
        canDelete: role.canDelete,
        canAdmin: role.canAdmin
      }
    })
  } catch (error: any) {
    role[key] = previous
    toast.add({
      title: 'Failed to update permission',
      description: error?.statusMessage || 'Error',
      color: 'error'
    })
  } finally {
    permissionSaving[role.roleKey] = false
  }
}

const permissionColumns = [
  ['canRead', 'Read'],
  ['canWrite', 'Write'],
  ['canPublish', 'Publish'],
  ['canArchive', 'Archive'],
  ['canDelete', 'Delete'],
  ['canAdmin', 'Admin']
] as const
</script>

<template>
  <UDashboardPanel id="desk-schema-settings">
    <template #header>
      <DeskNavbar :title="`Schema: ${schemaKey}`">
        <template #title>
          <div class="flex min-w-0 flex-col">
            <UBreadcrumb :items="breadcrumbItems" />
            <span class="truncate text-xs text-muted">Configure public presentation, search behavior, and role access for this content type.</span>
          </div>
        </template>

        <template #actions>
          <UButton
            v-if="!isNew"
            icon="i-lucide-save"
            :loading="draftSaving"
            :disabled="!draftDirty || draftSaving || draftStatus !== 'success'"
            aria-label="Save Schema Settings draft"
            @click="saveSettings"
          >
            <span class="hidden sm:inline">Save draft Settings</span>
          </UButton>
        </template>
      </DeskNavbar>

      <UDashboardToolbar :ui="{ left: 'flex w-full' }">
        <template #left>
          <div class="w-full px-2">
            <UNavigationMenu
              :items="toolbarItems"
              highlight
              highlight-color="primary"
              variant="link"
              class="w-full border-default data-[orientation=horizontal]:border-b"
            />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="space-y-8">
        <UAlert
          v-if="isNew"
          title="Create the Schema first"
          description="Save the initial Schema draft before opening its Settings."
          icon="i-lucide-alert-circle"
          variant="subtle"
        />

        <template v-else>
          <UAlert
            v-if="conflict"
            title="A newer Schema draft is available"
            description="Your local presentation and search selections are preserved. Review them before deciding whether to reload the newer draft."
            icon="i-lucide-git-compare-arrows"
            color="warning"
            variant="subtle"
          >
            <template #actions>
              <UButton color="warning" variant="soft" @click="confirmReloadLatest">Reload latest</UButton>
              <UButton :to="`/_desk/schemas/${schemaKey}`" color="neutral" variant="outline">Open Schema editor</UButton>
            </template>
          </UAlert>

          <UAlert
            v-if="draftError"
            title="Schema draft unavailable"
            :description="draftError.statusMessage || 'The Schema draft could not be loaded.'"
            icon="i-lucide-cloud-off"
            color="error"
            variant="subtle"
          >
            <template #actions>
              <UButton color="error" variant="soft" @click="confirmReloadLatest">Retry</UButton>
            </template>
          </UAlert>

          <div v-if="draftPending" class="space-y-3" aria-label="Loading Schema Settings">
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-64 w-full" />
            <USkeleton class="h-48 w-full" />
          </div>

          <template v-else-if="ast">
            <UAlert
              :title="draftDirty ? 'Unsaved Schema draft changes' : differsFromPublished ? 'Saved draft differs from published' : 'Settings match the published Schema'"
              :description="draftDirty
                ? 'Save these Settings to create the next immutable Schema draft revision.'
                : differsFromPublished
                  ? 'Public routes and active search keep the published configuration until you publish from the Schema editor.'
                  : 'Any new Settings change will remain draft-only until explicit publication.'"
              :icon="draftDirty || differsFromPublished ? 'i-lucide-file-pen-line' : 'i-lucide-circle-check'"
              :color="draftDirty || differsFromPublished ? 'warning' : 'success'"
              variant="subtle"
            >
              <template #actions>
                <UButton :to="`/_desk/schemas/${schemaKey}`" color="neutral" variant="outline">
                  Open Schema editor to publish
                </UButton>
              </template>
            </UAlert>

            <CmsSchemaPresentationEditor
              v-model="presentation"
              :fields="fields"
              :schema-key="schemaKey"
              :published-presentation="published?.ast?.presentation ?? null"
              :published-version="published?.version ?? null"
              :draft-differs-from-published="differsFromPublished"
            />

            <USeparator />

            <CmsSchemaSearchConfigurationEditor v-model="fields" />
          </template>

          <USeparator />

          <fieldset class="min-w-0 space-y-4">
            <legend class="text-sm font-semibold text-highlighted">Permissions</legend>
            <p class="text-xs text-muted">
              Permissions apply immediately and are not included in the Schema draft save state above.
            </p>

            <div v-if="rolesPending" class="space-y-2" aria-label="Loading Schema permissions">
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
            </div>

            <div v-else class="overflow-x-auto rounded-lg border border-default">
              <div class="min-w-[52rem]">
                <div class="grid grid-cols-[minmax(10rem,1fr)_repeat(6,72px)] items-center gap-2 border-b px-4 py-2 text-xs uppercase tracking-wide text-muted">
                  <span>Role</span>
                  <span v-for="[, label] in permissionColumns" :key="label" class="text-center">{{ label }}</span>
                </div>
                <div
                  v-for="role in roles"
                  :key="role.roleKey"
                  class="grid grid-cols-[minmax(10rem,1fr)_repeat(6,72px)] items-center gap-2 border-b px-4 py-3 last:border-b-0"
                >
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{{ role.title || role.roleKey }}</div>
                    <div class="truncate font-mono text-xs text-muted">{{ role.roleKey }}</div>
                  </div>
                  <div v-for="[key, label] in permissionColumns" :key="key" class="flex justify-center">
                    <USwitch
                      :model-value="role[key]"
                      :loading="permissionSaving[role.roleKey]"
                      :disabled="permissionSaving[role.roleKey] || role.locked"
                      :aria-label="`${label} permission for ${role.title || role.roleKey}`"
                      @update:model-value="value => updatePermission(role, key, value)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
