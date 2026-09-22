<script setup lang="ts">
import { h } from 'vue'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { UBadge, UDropdownMenu, UButton } from '#components'

definePageMeta({
  layout: 'desk',
  key: (route) => route.fullPath
})

type UserRow = {
  id: string
  email: string
  name: string | null
  roleKey: string
  roleTitle: string | null
  roleLevel: number | null
  status: string
  createdAt: string
  canDelete: boolean
}

type RoleItem = { roleKey: string; title: string | null; level: number }

type PendingState = {
  name: boolean
  delete: boolean
}

const toast = useToast()
const { confirm } = useConfirmDialog()
const route = useRoute()
const router = useRouter()
const locale = useDisplayLocale()

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const statusFilter = ref(typeof route.query.status === 'string' ? route.query.status : 'all')
const roleFilter = ref(typeof route.query.role === 'string' ? route.query.role : 'all')

const query = computed(() => ({
  limit: 200,
  q: typeof route.query.q === 'string' && route.query.q.trim().length ? route.query.q.trim() : undefined,
  status: typeof route.query.status === 'string' && route.query.status !== 'all' ? route.query.status : undefined,
  role: typeof route.query.role === 'string' && route.query.role !== 'all' ? route.query.role : undefined
}))

const { data, pending, refresh } = await useFetch<{ items: UserRow[] }>('/api/users/list', {
  query
})

const { data: roleData, refresh: refreshRoles } = await useFetch<{ items: RoleItem[] }>('/api/users/roles')

const roleOptions = computed(() => (roleData.value?.items || []).map(role => ({
  label: role.title || role.roleKey,
  value: role.roleKey
})))

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Disabled', value: 'disabled' },
  { label: 'Deleted', value: 'deleted' }
]

const filterStatusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Disabled', value: 'disabled' },
  { label: 'Deleted', value: 'deleted' }
]

const filterRoleOptions = computed(() => [
  { label: 'All roles', value: 'all' },
  ...roleOptions.value
])

const pendingState = reactive<Record<string, PendingState>>({})

function getPending(id: string) {
  if (!pendingState[id]) {
    pendingState[id] = { name: false, delete: false }
  }
  return pendingState[id]
}

async function applySearch() {
  await router.push({
    path: route.path,
    query: {
      q: search.value.trim(),
      role: roleFilter.value,
      status: statusFilter.value
    }
  })
}

const editOpen = ref(false)
const editRow = ref<UserRow | null>(null)
const editState = reactive({
  name: '',
  roleKey: '',
  status: ''
})
const editFormId = 'edit-user-form'

function openEdit(row: UserRow) {
  editRow.value = row
  editState.name = row.name || ''
  editState.roleKey = row.roleKey
  editState.status = row.status
  editOpen.value = true
}

watch(editOpen, (open) => {
  if (!open) editRow.value = null
})

async function saveUser() {
  const row = editRow.value
  if (!row) return
  const state = getPending(row.id)
  state.name = true
  try {
    await $fetch(`/api/users/${row.id}`, {
      method: 'PATCH',
      body: {
        name: editState.name,
        roleKey: editState.roleKey,
        status: editState.status
      }
    })
    await refresh()
    editOpen.value = false
    toast.add({ title: 'User updated', description: row.email })
  } catch (err: any) {
    toast.add({ title: 'Update failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    state.name = false
  }
}

async function deleteUser(row: UserRow) {
  const ok = await confirm({
    title: 'Delete user',
    body: `Delete ${row.email}? This can be restored by changing status later.`,
    confirmLabel: 'Delete',
    confirmColor: 'error'
  })
  if (!ok) return
  const state = getPending(row.id)
  state.delete = true
  try {
    await $fetch(`/api/users/${row.id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'User deleted', description: row.email })
  } catch (err: any) {
    toast.add({ title: 'Delete failed', description: err?.statusMessage || 'Error', color: 'error' })
  } finally {
    state.delete = false
  }
}

const columns = computed<TableColumn<UserRow>[]>(() => ([
  {
    accessorKey: 'name',
    header: 'User',
    cell: ({ row }) => {
      const name = row.original.name || row.original.email
      return h('div', { class: 'flex flex-col min-w-0' }, [
        h('span', { class: 'text-sm font-medium truncate' }, name),
        h('span', { class: 'text-xs text-muted truncate' }, row.original.email)
      ])
    }
  },
  {
    accessorKey: 'roleKey',
    header: 'Role',
    cell: ({ row }) => {
      const roleLabel = row.original.roleTitle || row.original.roleKey
      return h(UBadge, { variant: 'soft', color: 'neutral' }, () => roleLabel)
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const current = row.original.status
      const color = ({
        pending: 'info',
        active: 'success',
        suspended: 'warning',
        disabled: 'neutral',
        deleted: 'error'
      } as const)[current] ?? 'neutral'
      return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () => current)
    }
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => formatDateTime(row.getValue('createdAt') as string, locale.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  },
  {
    id: 'actions',
    meta: { class: { td: 'text-right' } },
    cell: ({ row }) => {
      const state = getPending(row.original.id)
      const isDeleted = row.original.status === 'deleted'
      const canDelete = row.original.canDelete && !isDeleted
      const items: DropdownMenuItem[][] = [[
        { label: 'Edit user', icon: 'i-lucide-pen-line', onSelect: () => openEdit(row.original) },
        { type: 'separator' },
        {
          label: isDeleted ? 'User deleted' : 'Delete user',
          icon: 'i-lucide-trash-2',
          color: 'error',
          disabled: !canDelete,
          onSelect: () => deleteUser(row.original)
        }
      ]]

      return h(UDropdownMenu as any, { items, content: { align: 'end' } }, () => h(UButton, {
        icon: 'i-lucide-more-vertical',
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        loading: state.delete,
        'aria-label': 'User actions'
      }))
    }
  }
]))
</script>

<template>
  <UDashboardPanel id="desk-users">
    <template #header>
      <DeskNavbar title="Users" description="Control who can access your site and what they can do.">
        <template #actions>
          <div class="flex items-center gap-2">
            <UBadge variant="soft" color="neutral">
              {{ data?.items?.length || 0 }} users
            </UBadge>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-rotate-cw"
              :loading="pending"
              @click="refresh()"
            >
              Refresh
            </UButton>
          </div>
        </template>
      </DeskNavbar>

      <UDashboardToolbar :ui="{ left: 'flex flex-wrap items-center gap-2' }">
        <template #left>
          <div class="flex flex-wrap items-center gap-2 p-2">
            <UInput
              v-model="search"
              placeholder="Search users..."
              icon="i-lucide-search"
              class="w-64"
              @keydown.enter.prevent="applySearch"
            />
            <USelect
              v-model="statusFilter"
              :items="filterStatusOptions"
              class="w-40"
            />
            <USelect
              v-model="roleFilter"
              :items="filterRoleOptions"
              class="w-40"
            />
            <UButton color="primary" @click="applySearch">
              Search
            </UButton>
          </div>
        </template>
        <template #right>
          <ManageRolesModal @updated="refreshRoles()" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <UTable
        :data="data?.items || []"
        :columns="columns"
        :loading="pending"
        empty="No users found."
        class="w-full"
      />
    </template>
  </UDashboardPanel>

  <UModal v-model:open="editOpen" title="Edit user" :ui="{ footer: 'justify-end' }">
    <template #body>
      <UForm :id="editFormId" :state="editState" class="flex flex-col gap-4" @submit="saveUser">
        <UFormField label="Name" name="name">
          <UInput v-model="editState.name" placeholder="Enter name" class="w-full" />
        </UFormField>
        <UFormField label="Role" name="roleKey">
          <USelect
            v-model="editState.roleKey"
            :items="roleOptions"
            placeholder="Select role"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Status" name="status">
          <USelect
            v-model="editState.status"
            :items="statusOptions"
            placeholder="Select status"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="editRow" label="Email">
          <UInput :model-value="editRow.email" disabled class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="editOpen = false;">
        Cancel
      </UButton>
      <UButton
        color="primary"
        :loading="editRow ? getPending(editRow.id).name : false"
        type="submit"
        :form="editFormId"
      >
        Save
      </UButton>
    </template>
  </UModal>
</template>
