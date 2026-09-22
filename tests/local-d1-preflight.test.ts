import { appendFile, chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  checkLocalD1Migrations,
  findPendingMigrations,
  migrationRequiredMessage,
  parseWranglerJson
} from '../scripts/check-local-d1-migrations.mjs'

const projectRoot = resolve(import.meta.dirname, '..')

async function createWranglerMock(options: { applied?: string[], ledgerExists?: boolean, exitCode?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'halopress-local-d1-check-'))
  const mockPath = join(directory, 'wrangler-mock.mjs')
  const logPath = join(directory, 'calls.jsonl')
  await writeFile(mockPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n')
if (process.env.MOCK_EXIT_CODE !== '0') {
  console.error('mock failure')
  process.exit(Number(process.env.MOCK_EXIT_CODE))
}
const command = args[args.indexOf('--command') + 1]
const results = command.includes('sqlite_master')
  ? (process.env.MOCK_LEDGER_EXISTS === '1' ? [{ name: 'd1_migrations' }] : [])
  : JSON.parse(process.env.MOCK_APPLIED)
console.log('[wrangler:inf] local query')
console.log(JSON.stringify([{ results, success: true }]))
`)
  await chmod(mockPath, 0o755)
  await appendFile(logPath, '')
  return {
    command: mockPath,
    cwd: projectRoot,
    env: {
      ...process.env,
      MOCK_APPLIED: JSON.stringify((options.applied || []).map(name => ({ name }))),
      MOCK_EXIT_CODE: String(options.exitCode ?? 0),
      MOCK_LEDGER_EXISTS: options.ledgerExists === false ? '0' : '1',
      MOCK_LOG: logPath
    },
    logPath
  }
}

describe('local D1 migration preflight', () => {
  it('parses Wrangler JSON despite bracketed log prefixes', () => {
    expect(parseWranglerJson('[wrangler:inf] ["log", "metadata"]\n[{"results":[],"success":true}]')).toEqual([
      { results: [], success: true }
    ])
  })

  it('finds pending migration filenames deterministically', () => {
    expect(findPendingMigrations(['0000_first.sql', '0001_second.sql'], ['0000_first.sql']))
      .toEqual(['0001_second.sql'])
  })

  it('reads only the local ledger and reports pending migrations', async () => {
    const mock = await createWranglerMock({
      applied: [
        '0000_restore_materialized_search_index.sql',
        '0001_add_installation_state.sql',
        '0002_add_browser_setup_session.sql',
        '0003_preserve_published_revisions.sql'
      ]
    })
    const result = await checkLocalD1Migrations(mock)

    expect(result.pending).toEqual([
      '0004_add_editorial_safety_revisions.sql',
      '0005_add_schema_lifecycle_status.sql',
      '0006_add_public_member_identities.sql',
      '0007_add_public_routes_and_aliases.sql',
      '0008_add_site_menu_sets.sql',
      '0009_add_site_layout_documents.sql',
      '0010_add_site_layout_assignments.sql',
      '0011_add_korean_full_text_search.sql'
    ])
    expect(migrationRequiredMessage(result.pending)).toContain('pnpm db:d1:apply:local')

    const calls = (await readFile(mock.logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(calls).toHaveLength(2)
    expect(calls.every(args => args.slice(0, 3).join(' ') === 'd1 execute DB')).toBe(true)
    expect(calls.every(args => args.includes('--local') && args.includes('--json'))).toBe(true)
    expect(calls.every(args => args[args.indexOf('--command') + 1].startsWith('SELECT '))).toBe(true)
  })

  it('treats a new database without a ledger as entirely pending', async () => {
    const mock = await createWranglerMock({ ledgerExists: false })
    const result = await checkLocalD1Migrations(mock)

    expect(result.pending).toEqual(result.migrationFiles)
    const calls = (await readFile(mock.logPath, 'utf8')).trim().split('\n')
    expect(calls).toHaveLength(1)
  })

  it('fails closed when Wrangler cannot query the local database', async () => {
    const mock = await createWranglerMock({ exitCode: 1 })
    await expect(checkLocalD1Migrations(mock)).rejects.toThrow('mock failure')
  })

  it('registers the check as the pnpm dev lifecycle preflight', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    expect(packageJson.scripts.predev).toBe('node scripts/check-local-d1-migrations.mjs')
    expect(packageJson.scripts.dev).toBe('nuxt dev')
  })
})
