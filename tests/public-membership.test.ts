import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  externalIdentity,
  membershipInvitation,
  registrationRateLimit,
  user,
  userRole
} from '../server/db/schema'
import { createGoogleLinkIntent, resolveGoogleIdentity } from '../server/utils/external-identities'
import { runMigrations, seedRoles } from '../server/utils/install'
import {
  claimMembershipInvitation,
  consumeRegistrationRateLimit,
  createMembershipInvitation,
  registerPasswordMember
} from '../server/utils/member-registration'
import { getMembershipSettings, toPublicMembershipSettings, updateMembershipSettings } from '../server/utils/membership'
import { getActiveAuthUser } from '../server/utils/auth-user'
import { hashPassword } from '../server/utils/password'
import { createTestSqliteDb } from './fixtures/sqlite'

const dbState = vi.hoisted(() => ({ current: null as any }))
vi.mock('../server/db/db', () => ({ getDb: vi.fn(async () => dbState.current) }))

const event = {
  context: {},
  node: { req: { headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } } }
} as any
const migrationNames = [
  '0000_restore_materialized_search_index.sql',
  '0001_add_installation_state.sql',
  '0002_add_browser_setup_session.sql',
  '0003_preserve_published_revisions.sql',
  '0004_add_editorial_safety_revisions.sql',
  '0005_add_schema_lifecycle_status.sql',
  '0006_add_public_member_identities.sql'
]

async function applyRawMigrations(sqlite: DatabaseSync, through: number, from = 0) {
  const root = resolve(import.meta.dirname, '..')
  for (const name of migrationNames.slice(from, through + 1)) {
    const raw = await readFile(resolve(root, 'server/db/migrations', name), 'utf8')
    for (const statement of raw.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) {
      sqlite.exec(statement)
    }
  }
}
let fixture: Awaited<ReturnType<typeof createTestSqliteDb>>

beforeEach(async () => {
  fixture = await createTestSqliteDb()
  dbState.current = fixture.db
  await runMigrations(fixture.db)
  await seedRoles(fixture.db)
})

afterEach(() => {
  fixture.close()
  dbState.current = null
})

describe('public membership policy and password registration', () => {
  it('keeps registration disabled by default and persists one typed policy value', async () => {
    await expect(getMembershipSettings(event)).resolves.toEqual({ mode: 'disabled', defaultRole: 'user' })
    await expect(registerPasswordMember(event, {
      email: 'member@example.com',
      password: 'correct horse battery staple'
    })).rejects.toMatchObject({ statusCode: 403 })

    await updateMembershipSettings(event, { mode: 'open', defaultRole: 'user' }, 'admin-1')
    await expect(getMembershipSettings(event)).resolves.toEqual({ mode: 'open', defaultRole: 'user' })
    expect(toPublicMembershipSettings('open', true).passwordRegistrationEnabled).toBe(true)
    expect(toPublicMembershipSettings('open', false).passwordRegistrationEnabled).toBe(false)
    expect(toPublicMembershipSettings('disabled', true).passwordRegistrationEnabled).toBe(false)
  })

  it('normalizes canonical email, rejects case duplicates, and creates public member accounts', async () => {
    await updateMembershipSettings(event, { mode: 'open', defaultRole: 'user' }, 'admin-1')
    const created = await registerPasswordMember(event, {
      email: '  Member@Example.COM ',
      name: 'Member',
      password: 'correct horse battery staple'
    })
    expect(created).toMatchObject({ email: 'member@example.com', status: 'active', role: 'user' })
    const row = await fixture.db.select().from(user).where(eq(user.id, created.id)).get()
    expect(row).toMatchObject({ email: 'member@example.com', accountType: 'member', status: 'active' })

    await expect(registerPasswordMember(event, {
      email: 'MEMBER@example.com',
      password: 'a different secure password'
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('creates pending accounts in approval mode and revokes them for auth refresh until activated', async () => {
    await updateMembershipSettings(event, { mode: 'approval', defaultRole: 'user' }, 'admin-1')
    const created = await registerPasswordMember(event, {
      email: 'pending@example.com',
      password: 'correct horse battery staple'
    })
    expect(created.status).toBe('pending')
    await expect(getActiveAuthUser(fixture.db, created.id)).resolves.toBeNull()

    await fixture.db.update(user).set({ status: 'active' }).where(eq(user.id, created.id))
    await expect(getActiveAuthUser(fixture.db, created.id)).resolves.toMatchObject({
      id: created.id,
      role: 'user',
      accountType: 'member'
    })
    await fixture.db.update(user).set({ status: 'suspended' }).where(eq(user.id, created.id))
    await expect(getActiveAuthUser(fixture.db, created.id)).resolves.toBeNull()
  })

  it('issues hashed email-bound invitations and consumes them only once', async () => {
    await updateMembershipSettings(event, { mode: 'invite', defaultRole: 'user' }, 'admin-1')
    await fixture.db.insert(user).values({
      id: 'admin-1', email: 'admin@example.com', name: 'Admin', accountType: 'staff', roleKey: 'admin', status: 'active', createdAt: new Date()
    })
    const invitation = await createMembershipInvitation(event, { email: 'Invitee@Example.com' }, 'admin-1')
    const stored = await fixture.db.select().from(membershipInvitation).get()
    expect(stored).toMatchObject({ email: 'invitee@example.com', status: 'pending' })
    expect(stored.tokenHash).not.toContain(invitation.code)

    await expect(registerPasswordMember(event, {
      email: 'invitee@example.com',
      password: 'correct horse battery staple',
      inviteCode: 'wrong'
    })).rejects.toMatchObject({ statusCode: 403 })

    const created = await registerPasswordMember(event, {
      email: 'invitee@example.com',
      password: 'correct horse battery staple',
      inviteCode: invitation.code
    })
    expect(created.status).toBe('active')
    await expect(fixture.db.select().from(membershipInvitation).get()).resolves.toMatchObject({
      status: 'used', usedBy: created.id
    })
  })

  it('supersedes older invitations so Google provisioning selects one deterministic role', async () => {
    await fixture.db.insert(userRole).values({ roleKey: 'supporter', title: 'Supporter', level: 25 })
    await updateMembershipSettings(event, { mode: 'invite', defaultRole: 'user' }, 'admin-1')
    await fixture.db.insert(user).values({
      id: 'admin-1', email: 'admin@example.com', name: 'Admin', accountType: 'staff', roleKey: 'admin', status: 'active', createdAt: new Date()
    })
    await createMembershipInvitation(event, { email: 'google-invite@example.com', roleKey: 'user' }, 'admin-1')
    await createMembershipInvitation(event, { email: 'google-invite@example.com', roleKey: 'supporter' }, 'admin-1')

    const invitations = await fixture.db.select().from(membershipInvitation).where(eq(
      membershipInvitation.email,
      'google-invite@example.com'
    ))
    expect(invitations.map(row => row.status).sort()).toEqual(['pending', 'superseded'])
    await expect(resolveGoogleIdentity(event, {
      subject: 'google-invited-subject',
      email: 'google-invite@example.com',
      emailVerified: true
    })).resolves.toMatchObject({ role: 'supporter' })
  })

  it('atomically rejects an invitation superseded between lookup and claim', async () => {
    await updateMembershipSettings(event, { mode: 'invite', defaultRole: 'user' }, 'admin-1')
    await fixture.db.insert(user).values({
      id: 'admin-1', email: 'admin@example.com', name: 'Admin', accountType: 'staff', roleKey: 'admin', status: 'active', createdAt: new Date()
    })
    await createMembershipInvitation(event, { email: 'race@example.com' }, 'admin-1')
    const stale = await fixture.db.select({ id: membershipInvitation.id }).from(membershipInvitation).where(eq(
      membershipInvitation.status,
      'pending'
    )).get()
    await createMembershipInvitation(event, { email: 'race@example.com' }, 'admin-1')
    await expect(claimMembershipInvitation(
      fixture.db,
      stale!.id,
      'race@example.com',
      new Date()
    )).rejects.toMatchObject({ statusCode: 403 })

    const current = await fixture.db.select({ id: membershipInvitation.id }).from(membershipInvitation).where(eq(
      membershipInvitation.status,
      'pending'
    )).get()
    await expect(claimMembershipInvitation(
      fixture.db,
      current!.id,
      'race@example.com',
      new Date()
    )).resolves.toBeUndefined()
    await expect(claimMembershipInvitation(
      fixture.db,
      current!.id,
      'race@example.com',
      new Date()
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it('uses atomic database counters for registration rate limits', async () => {
    const keys = ['ip-bucket', 'email-bucket']
    const now = new Date('2026-07-14T00:01:00.000Z')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await consumeRegistrationRateLimit(fixture.db, keys, now)
    }
    await expect(consumeRegistrationRateLimit(fixture.db, keys, now)).rejects.toMatchObject({
      statusCode: 429
    })
    const rows = await fixture.db.select().from(registrationRateLimit)
    expect(rows.find(row => row.bucketKey === 'ip-bucket')?.attemptCount).toBe(6)
  })
})

describe('stable external identities', () => {
  it('provisions only verified Google subjects and keeps subject ownership across email changes', async () => {
    await updateMembershipSettings(event, { mode: 'open', defaultRole: 'user' }, 'admin-1')
    await expect(resolveGoogleIdentity(event, {
      subject: 'google-sub-1', email: 'google@example.com', emailVerified: false
    })).rejects.toMatchObject({ code: 'unverified_email' })

    const created = await resolveGoogleIdentity(event, {
      subject: 'google-sub-1', email: 'google@example.com', emailVerified: true
    })
    expect(created).toMatchObject({ email: 'google@example.com', accountType: 'member', role: 'user' })
    const returning = await resolveGoogleIdentity(event, {
      subject: 'google-sub-1', email: 'changed@example.com', emailVerified: true
    })
    expect(returning.id).toBe(created.id)
    const withoutRepeatedClaims = await resolveGoogleIdentity(event, {
      subject: 'google-sub-1', email: '', emailVerified: false
    })
    expect(withoutRepeatedClaims.id).toBe(created.id)
    await expect(fixture.db.select().from(externalIdentity).get()).resolves.toMatchObject({
      subject: 'google-sub-1', userId: created.id, emailAtLink: 'changed@example.com', emailVerified: true
    })
  })

  it('rejects silent email linking and permits only an explicit target account', async () => {
    await fixture.db.insert(user).values({
      id: 'password-user',
      email: 'existing@example.com',
      name: 'Existing',
      accountType: 'member',
      roleKey: 'user',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      status: 'active',
      createdAt: new Date()
    })
    await updateMembershipSettings(event, { mode: 'open', defaultRole: 'user' }, 'admin-1')
    await expect(resolveGoogleIdentity(event, {
      subject: 'google-sub-existing', email: 'existing@example.com', emailVerified: true
    })).rejects.toMatchObject({ code: 'explicit_link_required' })

    const linked = await resolveGoogleIdentity(event, {
      subject: 'google-sub-existing',
      email: 'existing@example.com',
      emailVerified: true,
      linkUserId: 'password-user'
    })
    expect(linked.id).toBe('password-user')
  })

  it('handles concurrent first Google callbacks idempotently by stable subject', async () => {
    await updateMembershipSettings(event, { mode: 'open', defaultRole: 'user' }, 'admin-1')
    const input = { subject: 'concurrent-subject', email: 'concurrent@example.com', emailVerified: true }
    const results = await Promise.all([
      resolveGoogleIdentity(event, input),
      resolveGoogleIdentity(event, input)
    ])
    expect(results[0]?.id).toBe(results[1]?.id)
    expect(await fixture.db.select().from(externalIdentity).where(eq(
      externalIdentity.subject,
      'concurrent-subject'
    ))).toHaveLength(1)
  })

  it('rate limits password reauthentication with separate per-user and IP buckets', async () => {
    const password = await hashPassword('correct horse battery staple')
    await fixture.db.insert(user).values({
      id: 'reauth-user',
      email: 'reauth@example.com',
      accountType: 'member',
      roleKey: 'user',
      passwordHash: password.hash,
      passwordSalt: password.salt,
      status: 'active',
      createdAt: new Date()
    })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(createGoogleLinkIntent(event, 'reauth-user', 'incorrect password'))
        .rejects.toMatchObject({ code: 'invalid_password' })
    }
    await expect(createGoogleLinkIntent(event, 'reauth-user', 'incorrect password'))
      .rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: expect.any(Number) })
  })

  it('removes suspended, disabled, deleted, and missing users from refreshed sessions', async () => {
    await fixture.db.insert(user).values({
      id: 'status-user',
      email: 'status@example.com',
      accountType: 'member',
      roleKey: 'user',
      status: 'active',
      createdAt: new Date()
    })
    await expect(getActiveAuthUser(fixture.db, 'status-user')).resolves.toMatchObject({
      id: 'status-user', accountType: 'member'
    })
    for (const status of ['suspended', 'disabled', 'deleted']) {
      await fixture.db.update(user).set({ status }).where(eq(user.id, 'status-user'))
      await expect(getActiveAuthUser(fixture.db, 'status-user')).resolves.toBeNull()
    }
    await fixture.db.delete(user).where(eq(user.id, 'status-user'))
    await expect(getActiveAuthUser(fixture.db, 'status-user')).resolves.toBeNull()
  })
})

describe('0006 canonical email migration', () => {
  it('normalizes legacy email and enforces unique canonical values', async () => {
    const row = await fixture.db.select().from(user).limit(1)
    expect(row).toEqual([])
    await fixture.db.insert(user).values({
      id: 'canonical', email: 'canonical@example.com', accountType: 'member', roleKey: 'user', status: 'active', createdAt: new Date()
    })
    await expect(fixture.db.insert(user).values({
      id: 'duplicate', email: 'canonical@example.com', accountType: 'member', roleKey: 'user', status: 'active', createdAt: new Date()
    })).rejects.toThrow()
  })

  it('contains an explicit pre-index collision guard without modifying generated metadata by hand', async () => {
    const root = resolve(import.meta.dirname, '..')
    const sql = await readFile(resolve(root, 'server/db/migrations/0006_add_public_member_identities.sql'), 'utf8')
    expect(sql).toContain('_halopress_email_normalization_guard')
    expect(sql.indexOf('SELECT lower(trim(`email`))')).toBeLessThan(sql.indexOf('UPDATE `user` SET `email` = lower(trim(`email`))'))
    expect(sql.indexOf('UPDATE `user` SET `email` = lower(trim(`email`))')).toBeLessThan(sql.indexOf('idx_user_email_unique'))
  })

  it('upgrades a real 0005 database, normalizes email, and leaves foreign keys clean', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON')
    try {
      await applyRawMigrations(sqlite, 5)
      sqlite.exec('INSERT INTO user_role (role_key, title, level) VALUES (\'admin\', \'Admin\', 100)')
      sqlite.exec('INSERT INTO user (id, email, role_key, status, created_at) VALUES (\'legacy\', \' Legacy@Example.COM \', \'admin\', \'active\', 1)')
      sqlite.exec('BEGIN')
      try {
        await applyRawMigrations(sqlite, 6, 6)
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
      expect(sqlite.prepare('SELECT email, account_type FROM user WHERE id = \'legacy\'').get()).toEqual({
        email: 'legacy@example.com',
        account_type: 'staff'
      })
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('aborts a real 0005 upgrade when legacy emails collide after normalization', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      await applyRawMigrations(sqlite, 5)
      sqlite.exec('INSERT INTO user_role (role_key, title, level) VALUES (\'admin\', \'Admin\', 100)')
      sqlite.exec('INSERT INTO user (id, email, role_key, status, created_at) VALUES (\'one\', \'Case@Example.com\', \'admin\', \'active\', 1)')
      sqlite.exec('INSERT INTO user (id, email, role_key, status, created_at) VALUES (\'two\', \'case@example.com\', \'admin\', \'active\', 2)')
      sqlite.exec('BEGIN')
      await expect(applyRawMigrations(sqlite, 6, 6)).rejects.toThrow('_halopress_email_normalization_guard.email')
      sqlite.exec('ROLLBACK')
      expect(sqlite.prepare('SELECT email FROM user ORDER BY id').all()).toEqual([
        { email: 'Case@Example.com' },
        { email: 'case@example.com' }
      ])
    } finally {
      sqlite.close()
    }
  })
})
