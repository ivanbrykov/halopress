#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { experimental_readRawConfig } from 'wrangler'

const DATABASE_BINDING = 'DB'
const APPLY_COMMAND = 'pnpm db:d1:apply:local'

function escapeIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function escapeSqlString(value) {
  return value.replaceAll('\'', '\'\'')
}

export function parseWranglerJson(output) {
  const candidates = []
  for (let start = output.indexOf('['); start >= 0; start = output.indexOf('[', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < output.length; index += 1) {
      const character = output[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === '[') depth += 1
      else if (character === ']') {
        depth -= 1
        if (depth !== 0) continue
        try {
          const parsed = JSON.parse(output.slice(start, index + 1))
          if (Array.isArray(parsed)) candidates.push(parsed)
        } catch {
          // A log prefix used brackets; continue with the next candidate.
        }
        break
      }
    }
  }
  const queryResult = candidates.find(candidate => candidate.some(item => Array.isArray(item?.results)))
  if (queryResult) return queryResult
  throw new Error('Wrangler did not return a JSON query result')
}

export function findPendingMigrations(migrationFiles, appliedNames) {
  const applied = new Set(appliedNames)
  return migrationFiles.filter(name => !applied.has(name))
}

async function runWranglerQuery(command, args, options) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', code => resolveResult({ code: code ?? 1, stdout, stderr }))
  })

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(detail || `Wrangler exited with code ${result.code}`)
  }
  const payload = parseWranglerJson(`${result.stdout}\n${result.stderr}`)
  const queryResult = payload.find(item => Array.isArray(item?.results))
  if (!queryResult) throw new Error('Wrangler JSON did not include query results')
  return queryResult.results
}

export async function checkLocalD1Migrations(options = {}) {
  const cwd = options.cwd || process.cwd()
  const env = options.env || process.env
  const command = options.command
    || env.HALOPRESS_WRANGLER_BIN
    || (process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler')
  const configResult = experimental_readRawConfig({ config: options.config })
  if (!configResult.configPath) throw new Error('No Wrangler configuration file was found')

  const database = configResult.rawConfig.d1_databases?.find(item => item.binding === DATABASE_BINDING)
  if (!database) throw new Error(`No D1 database binding named ${DATABASE_BINDING} was found`)
  const migrationsTable = database.migrations_table || 'd1_migrations'
  const migrationsDir = resolve(dirname(configResult.configPath), database.migrations_dir || 'migrations')
  const migrationFiles = (await readdir(migrationsDir))
    .filter(name => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
  const commonArgs = ['--local', '--json', '--config', configResult.configPath]

  const tableRows = await runWranglerQuery(command, [
    'd1', 'execute', DATABASE_BINDING,
    '--command', `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${escapeSqlString(migrationsTable)}'`,
    ...commonArgs
  ], { cwd, env })

  let appliedNames = []
  if (tableRows.some(row => row.name === migrationsTable)) {
    const ledgerRows = await runWranglerQuery(command, [
      'd1', 'execute', DATABASE_BINDING,
      '--command', `SELECT name FROM ${escapeIdentifier(migrationsTable)} ORDER BY id`,
      ...commonArgs
    ], { cwd, env })
    appliedNames = ledgerRows.map(row => row.name).filter(name => typeof name === 'string')
  }

  const pending = findPendingMigrations(migrationFiles, appliedNames)
  return { appliedNames, migrationFiles, pending }
}

export function migrationRequiredMessage(pending) {
  return [
    'Local D1 migrations are required:',
    ...pending.map(name => `  - ${name}`),
    '',
    'Run:',
    `  ${APPLY_COMMAND}`,
    '',
    'The development server was not started.'
  ].join('\n')
}

async function main() {
  const result = await checkLocalD1Migrations()
  if (result.pending.length === 0) {
    console.log('Local D1 migrations are up to date.')
    return
  }
  console.error(migrationRequiredMessage(result.pending))
  process.exitCode = 1
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error('Could not verify local D1 migrations. The development server was not started.')
    process.exitCode = 1
  }
}
