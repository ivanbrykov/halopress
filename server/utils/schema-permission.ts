import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'

import { getDb } from '../db/db'
import { schemaRole as schemaRoleTable } from '../db/schema'
import { getAuthSession, requireAdmin } from './auth'
import { badRequest, forbidden } from './http'

export type SchemaPermissionAction = 'read' | 'write' | 'publish' | 'archive' | 'delete' | 'admin'

export type SchemaPermission = {
  roleKey: string
  canRead: boolean
  canWrite: boolean
  canPublish: boolean
  canArchive: boolean
  canDelete: boolean
  canAdmin: boolean
}

function isAdminRole(roleKey: string) {
  return roleKey === 'admin'
}

export async function getSchemaRoleKey(event: H3Event) {
  const session = await getAuthSession(event)
  const sessionUser = session?.user as { role?: string; accountType?: string } | undefined
  const roleKey = sessionUser?.accountType === 'member' ? 'anonymous' : sessionUser?.role || 'anonymous'

  if (isAdminRole(roleKey)) {
    await requireAdmin(event)
  }

  return roleKey
}

export async function getSchemaPermission(event: H3Event, schemaKey: string): Promise<SchemaPermission> {
  if (!schemaKey) throw badRequest('Missing schema key')
  const roleKey = await getSchemaRoleKey(event)

  if (isAdminRole(roleKey)) {
    return {
      roleKey,
      canRead: true,
      canWrite: true,
      canPublish: true,
      canArchive: true,
      canDelete: true,
      canAdmin: true
    }
  }

  const db = await getDb(event)
  const row = await db
    .select({
      canRead: schemaRoleTable.canRead,
      canWrite: schemaRoleTable.canWrite,
      canPublish: schemaRoleTable.canPublish,
      canArchive: schemaRoleTable.canArchive,
      canDelete: schemaRoleTable.canDelete,
      canAdmin: schemaRoleTable.canAdmin
    })
    .from(schemaRoleTable)
    .where(and(
      eq(schemaRoleTable.schemaKey, schemaKey),
      eq(schemaRoleTable.roleKey, roleKey)
    ))
    .get()

  return {
    roleKey,
    canRead: !!row?.canRead,
    canWrite: !!row?.canWrite,
    canPublish: !!row?.canPublish,
    canArchive: !!row?.canArchive,
    canDelete: !!row?.canDelete,
    canAdmin: !!row?.canAdmin
  }
}

export function hasSchemaPermission(permission: SchemaPermission, action: SchemaPermissionAction) {
  if (action === 'read') {
    return permission.canRead || permission.canWrite || permission.canPublish ||
      permission.canArchive || permission.canDelete || permission.canAdmin
  }
  if (action === 'write') return permission.canWrite || permission.canAdmin
  if (action === 'publish') return permission.canPublish || permission.canAdmin
  if (action === 'archive') return permission.canArchive || permission.canAdmin
  if (action === 'delete') return permission.canDelete || permission.canAdmin
  return permission.canAdmin
}

export async function requireSchemaPermission(event: H3Event, schemaKey: string, action: SchemaPermissionAction) {
  const permission = await getSchemaPermission(event, schemaKey)
  if (!hasSchemaPermission(permission, action)) {
    throw forbidden('Permission denied')
  }
  return permission
}
