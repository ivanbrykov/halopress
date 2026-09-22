import { eq } from 'drizzle-orm'

import { user } from '../db/schema'

export type ActiveAuthUser = {
  id: string
  email: string
  name: string
  role: string
  accountType: 'staff' | 'member'
}

export function isAuthTenantAllowed(tokenTenant: unknown, currentTenant: string) {
  return typeof tokenTenant !== 'string' || tokenTenant === currentTenant
}

export async function getActiveAuthUser(db: any, userId: string): Promise<ActiveAuthUser | null> {
  if (!userId) return null
  const row = await db.select({
    id: user.id,
    email: user.email,
    name: user.name,
    roleKey: user.roleKey,
    accountType: user.accountType,
    status: user.status
  }).from(user).where(eq(user.id, userId)).get()

  if (!row || row.status !== 'active') return null
  return {
    id: row.id,
    email: row.email,
    name: row.name || row.email,
    role: row.roleKey,
    accountType: row.accountType === 'member' ? 'member' : 'staff'
  }
}
