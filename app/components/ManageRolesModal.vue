<script setup lang="ts">
import { h } from 'vue'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { UButton, UDropdownMenu } from '#components'

type RoleItem = { roleKey: string; title: string | null; level: number }

type SchemaUsage = { schemaKey: string; title: string; canRead: boolean; canWrite: boolean; canAdmin: boolean }

type RoleUsage = { schemas: SchemaUsage[]; userCount: number }

const open = ref(false)
const toast = useToast()
const emit = defineEmits<{ updated: [] }>()

const { data, pending, refresh } = await useFetch<{ items: RoleItem[] }>('/api/users/roles')

const roles = computed(() => data.value?.items || [])

const roleOptions = computed(() => roles.value.map(role => ({
  label: role.title || role.roleKey,
  value: role.roleKey
})))

const systemRoles = new Set(['admin', 'anonymous'])

const creating = ref(false)
const newRoleKey = ref('')
const newRoleTitle = ref('')
const newRoleLevel = ref('50')

function resetNewRole() {
  newRoleKey.value = ''
  newRoleTitle.value = ''
  newRoleLevel.value = '50'
}

function parseLevel(value: string) {
  const level = Number(value)
  return Number.isFinite(level) ? level : 50
}

async function createRole() {
  const roleKey = newRoleKey.value.trim()
  if (!roleKey) {
    toast.add({ title: 'Role key required', color: 'error' })
    return
  }
  creating.value = true
  try {
    await $fetch('/api/roles', {
      method: 'POST',
      body: {
        roleKey,
        title: newRoleTitle.value.trim() || null,
        level: parseLevel(newRoleLevel.value)
      }
    })
    resetNewRole()
    await refresh()
    emit('updated')
    toast.add({ title: 'Role created', description: roleKey })
  } catch (err: any) {
    toast.add({ title: 'Create failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    creating.value = false
  }
}

const editOpen = ref(false)
const editRole = ref<RoleItem | null>(null)
const editTitle = ref('')
const editLevel = ref('50')
const editing = ref(false)

function openEdit(role: RoleItem) {
  editRole.value = role
  editTitle.value = role.title || ''
  editLevel.value = String(role.level ?? 50)
  editOpen.value = true
}

watch(editOpen, (value) => {
  if (!value) editRole.value = null
})

async function saveEdit() {
  if (!editRole.value) return
  editing.value = true
  try {
    await $fetch(`/api/roles/${editRole.value.roleKey}`, {
      method: 'PATCH',
      body: {
        title: editTitle.value.trim() || null,
        level: parseLevel(editLevel.value)
      }
    })
    await refresh()
    emit('updated')
    editOpen.value = false
    toast.add({ title: 'Role updated', description: editRole.value.roleKey })
  } catch (err: any) {
    toast.add({ title: 'Update failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    editing.value = false
  }
}

const deleteOpen = ref(false)
const deleteRole = ref<RoleItem | null>(null)
const deleteUsage = ref<RoleUsage | null>(null)
const deleteTransferRoleKey = ref('')
const deleteLoading = ref(false)
const deleting = ref(false)

const deleteRoleOptions = computed(() => {
  const target = deleteRole.value?.roleKey
  return roleOptions.value.filter(option => option.value !== target)
})

const needsTransfer = computed(() => {
  const usage = deleteUsage.value
  if (!usage) return false
  return usage.userCount > 0 || usage.schemas.length > 0
})

function openDelete(role: RoleItem) {
  deleteRole.value = role
  deleteUsage.value = null
  deleteTransferRoleKey.value = ''
  deleteOpen.value = true
  loadUsage(role.roleKey)
}

watch(deleteOpen, (value) => {
  if (!value) {
    deleteRole.value = null
    deleteUsage.value = null
    deleteTransferRoleKey.value = ''
  }
})

async function loadUsage(roleKey: string) {
  deleteLoading.value = true
  try {
    deleteUsage.value = await $fetch<RoleUsage>('/api/roles/usage', { query: { roleKey } })
  } catch (err: any) {
    toast.add({ title: 'Failed to load usage', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    deleteLoading.value = false
  }
}

async function confirmDelete() {
  if (!deleteRole.value) return
  if (needsTransfer.value && !deleteTransferRoleKey.value) return
  deleting.value = true
  try {
    await $fetch(`/api/roles/${deleteRole.value.roleKey}`, {
      method: 'DELETE',
      body: needsTransfer.value ? { transferRoleKey: deleteTransferRoleKey.value } : {}
    })
    await refresh()
    emit('updated')
    deleteOpen.value = false
    toast.add({ title: 'Role deleted', description: deleteRole.value.roleKey })
  } catch (err: any) {
    toast.add({ title: 'Delete failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    deleting.value = false
  }
}

const columns = computed<TableColumn<RoleItem>[]>(() => ([
  {
    accessorKey: 'roleKey',
    header: 'Role',
    cell: ({ row }) => {
      const role = row.original
      return h('div', { class: 'flex flex-col min-w-0' }, [
        h('span', { class: 'text-sm font-medium truncate' }, role.title || role.roleKey),
        h('span', { class: 'text-xs text-muted font-mono truncate' }, role.roleKey)
      ])
    }
  },
  {
    accessorKey: 'level',
    header: 'Level',
    cell: ({ row }) => h('span', { class: 'text-sm' }, String(row.original.level))
  },
  {
    id: 'actions',
    meta: { class: { td: 'text-right' } },
    cell: ({ row }) => {
      const role = row.original
      const isSystem = systemRoles.has(role.roleKey)
      const items: DropdownMenuItem[][] = [[
        { label: 'Edit', icon: 'i-lucide-pen-line', onSelect: () => openEdit(role) },
        { type: 'separator' },
        { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', disabled: isSystem, onSelect: () => openDelete(role) }
      ]]

      return h(UDropdownMenu as any, { items, content: { align: 'end' } }, () => h(UButton, {
        icon: 'i-lucide-more-vertical',
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        'aria-label': 'Role actions'
      }))
    }
  }
]))
</script>

<template>
  <UButton color="neutral" variant="outline" icon="i-lucide-users" @click="open = true;">
    Manage role
  </UButton>

  <UModal v-model:open="open" title="Manage roles" :ui="{ content: 'max-w-4xl' }">
    <template #body>
      <div class="space-y-6">
        <div class="rounded-lg border border-default p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-sm font-semibold">Add role</p>
              <p class="text-xs text-muted">Create a role key, label, and access level.</p>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-end gap-3">
            <UInput
              v-model="newRoleKey"
              placeholder="role key"
              class="w-48"
              :disabled="creating"
            />
            <UInput
              v-model="newRoleTitle"
              placeholder="title (optional)"
              class="w-56"
              :disabled="creating"
            />
            <UInput
              v-model="newRoleLevel"
              type="number"
              min="0"
              class="w-28"
              :disabled="creating"
            />
            <UButton color="primary" :loading="creating" @click="createRole">
              Add role
            </UButton>
          </div>
        </div>

        <UTable
          :data="roles"
          :columns="columns"
          :loading="pending"
          empty="No roles defined."
          class="w-full"
        />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="open = false;">
        Close
      </UButton>
    </template>
  </UModal>

  <UModal v-model:open="editOpen" title="Edit role" :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="space-y-3">
        <div v-if="editRole" class="text-sm text-muted">
          {{ editRole.roleKey }}
        </div>
        <UInput v-model="editTitle" placeholder="Title" />
        <UInput v-model="editLevel" type="number" min="0" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="editOpen = false;">
        Cancel
      </UButton>
      <UButton color="primary" :loading="editing" @click="saveEdit">
        Save
      </UButton>
    </template>
  </UModal>

  <UModal v-model:open="deleteOpen" title="Delete role" :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Deleting a role removes its access rules. If it is used by schemas or users, choose a replacement.
        </p>

        <div v-if="deleteLoading" class="text-sm text-muted">Loading usage…</div>

        <div v-else-if="deleteUsage" class="space-y-3">
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span>Users: <strong>{{ deleteUsage.userCount }}</strong></span>
            <span>Schemas: <strong>{{ deleteUsage.schemas.length }}</strong></span>
          </div>

          <div v-if="deleteUsage.schemas.length" class="space-y-2">
            <p class="text-xs text-muted">Schemas using this role</p>
            <div class="flex flex-wrap gap-2">
              <UBadge v-for="schema in deleteUsage.schemas" :key="schema.schemaKey" variant="soft" color="neutral">
                {{ schema.title }}
              </UBadge>
            </div>
          </div>

          <div v-if="needsTransfer" class="space-y-2">
            <p class="text-xs text-muted">Reassign affected users & schemas to</p>
            <USelect
              v-model="deleteTransferRoleKey"
              :items="deleteRoleOptions"
              placeholder="Select replacement role"
              class="w-64"
            />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="deleteOpen = false;">
        Cancel
      </UButton>
      <UButton
        color="error"
        :loading="deleting"
        :disabled="deleteLoading || (needsTransfer && !deleteTransferRoleKey)"
        @click="confirmDelete"
      >
        Delete role
      </UButton>
    </template>
  </UModal>
</template>
