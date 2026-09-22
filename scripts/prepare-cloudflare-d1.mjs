#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { experimental_readRawConfig } from 'wrangler'

const DEFAULT_DATABASE = 'DB'

export function parsePrepareArgs(argv) {
  const options = {
    database: process.env.HALOPRESS_D1_DATABASE || DEFAULT_DATABASE,
    config: undefined,
    env: undefined,
    envFiles: [],
    dryRun: false
  }
  const args = [...argv]

  if (args[0] && !args[0].startsWith('-')) {
    options.database = args.shift()
  }

  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--') continue

    if (argument === '--dry-run' || argument === '--dry-run=true') {
      options.dryRun = true
      continue
    }

    const flagWithValue = {
      '--config': 'config',
      '-c': 'config',
      '--env': 'env',
      '-e': 'env',
      '--env-file': 'envFile'
    }[argument]

    if (flagWithValue) {
      const value = args.shift()
      if (!value) throw new Error(`Missing value for ${argument}`)
      if (flagWithValue === 'envFile') options.envFiles.push(value)
      else options[flagWithValue] = value
      continue
    }

    const equalsMatch = argument?.match(/^(--config|-c|--env|-e|--env-file)=(.+)$/)
    if (equalsMatch) {
      const [, flag, value] = equalsMatch
      if (flag === '--env-file') options.envFiles.push(value)
      else if (flag === '--config' || flag === '-c') options.config = value
      else options.env = value
      continue
    }

    throw new Error(`Unsupported D1 preparation argument: ${argument}`)
  }

  return options
}

export function resolveDatabaseConfig(rawConfig, databaseTarget, environment) {
  const scope = environment ? rawConfig.env?.[environment] : rawConfig
  if (!scope) throw new Error(`Wrangler environment not found: ${environment}`)

  const databases = scope.d1_databases
  if (!Array.isArray(databases) || databases.length === 0) {
    const where = environment ? `environment "${environment}"` : 'top-level configuration'
    throw new Error(`No D1 databases are configured in the ${where}`)
  }

  const matches = databases
    .map((database, index) => ({ database, index }))
    .filter(({ database }) => database.binding === databaseTarget || database.database_name === databaseTarget)

  if (matches.length === 0) throw new Error(`No D1 database matches "${databaseTarget}"`)

  const databaseNames = new Set(matches.map(({ database }) => database.database_name).filter(Boolean))
  const bindings = new Set(matches.map(({ database }) => database.binding).filter(Boolean))
  const databaseIds = [...new Set(matches.map(({ database }) => database.database_id).filter(Boolean))]
  if (databaseNames.size > 1 || bindings.size > 1 || databaseIds.length > 1) {
    throw new Error(`D1 database target "${databaseTarget}" is assigned to conflicting bindings`)
  }

  const canonical = matches.find(({ database }) => database.migrations_dir) || matches[0]
  const { database, index } = canonical
  if (!database.binding) throw new Error(`D1 database "${databaseTarget}" is missing its binding`)
  if (!database.database_name) throw new Error(`D1 binding "${database.binding}" is missing database_name`)

  return {
    database,
    databaseId: database.database_id || databaseIds[0],
    databases,
    duplicateCount: matches.length - 1,
    index
  }
}

function wranglerConfigArgs(options) {
  const args = []
  if (options.configPath) args.push('--config', options.configPath)
  if (options.env) args.push('--env', options.env)
  for (const envFile of options.envFiles) args.push('--env-file', envFile)
  return args
}

export function parseDatabaseList(output) {
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

      if (character === '"') {
        inString = true
      } else if (character === '[') {
        depth += 1
      } else if (character === ']') {
        depth -= 1
        if (depth !== 0) continue

        try {
          const parsed = JSON.parse(output.slice(start, index + 1))
          if (Array.isArray(parsed)) return parsed
        } catch {
          // This bracket pair belongs to a log prefix; continue at the next candidate.
        }
        break
      }
    }
  }

  throw new Error('Wrangler did not return a JSON D1 database list')
}

function commandError(args, result) {
  const error = new Error(`wrangler ${args.join(' ')} failed with exit code ${result.code}`)
  error.result = result
  return error
}

export async function runWrangler(args, { allowFailure = false, quiet = false } = {}) {
  const command = process.env.HALOPRESS_WRANGLER_BIN || (process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler')

  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
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

  if (!quiet) {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
  }
  if (result.code !== 0 && !allowFailure) throw commandError(args, result)
  return result
}

export async function normalizeDatabaseBinding(configPath, environment, resolved, databaseId) {
  let configText = await readFile(configPath, 'utf8')
  const parseErrors = []
  const config = parse(configText, parseErrors, { allowTrailingComma: true, disallowComments: false })
  if (parseErrors.length > 0) throw new Error(`Could not parse JSONC config: ${configPath}`)

  const databasePath = environment ? ['env', environment, 'd1_databases'] : ['d1_databases']
  const databases = environment ? config.env?.[environment]?.d1_databases : config.d1_databases
  if (!Array.isArray(databases)) throw new Error(`No D1 database array found in ${configPath}`)

  const matchingIndexes = databases
    .map((database, index) => ({ database, index }))
    .filter(({ database }) => database.binding === resolved.database.binding)
    .map(({ index }) => index)
  if (matchingIndexes.length === 0) {
    throw new Error(`D1 binding "${resolved.database.binding}" disappeared from ${configPath}`)
  }

  const canonicalIndex = matchingIndexes.includes(resolved.index) ? resolved.index : matchingIndexes[0]
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' }
  configText = applyEdits(configText, modify(
    configText,
    [...databasePath, canonicalIndex, 'database_id'],
    databaseId,
    { formattingOptions }
  ))

  for (const duplicateIndex of matchingIndexes.filter(index => index !== canonicalIndex).sort((a, b) => b - a)) {
    configText = applyEdits(configText, modify(
      configText,
      [...databasePath, duplicateIndex],
      undefined,
      { formattingOptions }
    ))
  }

  await writeFile(configPath, configText)

  const verificationErrors = []
  const verified = parse(configText, verificationErrors, { allowTrailingComma: true, disallowComments: false })
  const verifiedDatabases = environment ? verified.env?.[environment]?.d1_databases : verified.d1_databases
  const verifiedMatches = (verifiedDatabases || []).filter(database => database.binding === resolved.database.binding)
  if (verificationErrors.length > 0 || verifiedMatches.length !== 1 || verifiedMatches[0].database_id !== databaseId) {
    throw new Error(`Failed to normalize D1 binding "${resolved.database.binding}" in ${configPath}`)
  }
}

async function listRemoteDatabases(options) {
  const result = await runWrangler(
    ['d1', 'list', '--json', ...wranglerConfigArgs(options)],
    { quiet: true }
  )
  return parseDatabaseList(result.stdout)
}

function readPatchedDatabaseId(options, resolved) {
  const configResult = experimental_readRawConfig({ config: options.configPath, env: options.env })
  const scope = options.env ? configResult.rawConfig.env?.[options.env] : configResult.rawConfig
  const matches = (scope?.d1_databases || []).filter((database) => {
    return database.binding === resolved.database.binding
      && database.database_name === resolved.database.database_name
      && database.database_id
  })
  return matches.length === 1 ? matches[0].database_id : undefined
}

async function findRemoteDatabaseByName(options, databaseName, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const databases = await listRemoteDatabases(options)
    const remote = databases.find(database => database.name === databaseName)
    if (remote?.uuid) return remote
    if (attempt + 1 < attempts) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250 * (attempt + 1)))
    }
  }
  return undefined
}

async function resolveOrCreateDatabaseId(options, resolved) {
  let remote = await findRemoteDatabaseByName(options, resolved.database.database_name)
  if (remote?.uuid) return remote.uuid

  console.log(`Creating D1 database "${resolved.database.database_name}" for binding ${resolved.database.binding}...`)
  const createArgs = [
    'd1',
    'create',
    resolved.database.database_name,
    '--binding',
    resolved.database.binding,
    '--update-config',
    ...wranglerConfigArgs(options)
  ]
  const createResult = await runWrangler(createArgs, { allowFailure: true })

  if (createResult.code === 0) {
    const patchedDatabaseId = readPatchedDatabaseId(options, resolved)
    if (patchedDatabaseId) return patchedDatabaseId
  }

  remote = await findRemoteDatabaseByName(options, resolved.database.database_name, 3)
  if (!remote?.uuid) {
    if (createResult.code !== 0) throw commandError(createArgs, createResult)
    throw new Error(`D1 database "${resolved.database.database_name}" was created, but its database_id could not be resolved`)
  }

  if (createResult.code !== 0) {
    console.log(`A concurrent deploy created D1 database "${remote.name}"; adopting it.`)
  }
  return remote.uuid
}

export async function prepareCloudflareD1(options) {
  const configResult = experimental_readRawConfig({ config: options.config, env: options.env })
  if (!configResult.configPath) throw new Error('No Wrangler configuration file was found')

  const configPath = resolve(configResult.configPath)
  if (!/\.jsonc?$/i.test(configPath)) {
    throw new Error(
      `Unsupported Wrangler configuration format: ${configPath}. `
      + 'Halopress deployment preparation supports JSON or JSONC only; convert this file to wrangler.jsonc before deploying.'
    )
  }
  const runtimeOptions = { ...options, configPath }
  const resolved = resolveDatabaseConfig(configResult.rawConfig, options.database, options.env)
  if (options.dryRun) {
    const action = resolved.databaseId
      ? `use configured database_id ${resolved.databaseId}`
      : `resolve or create database "${resolved.database.database_name}"`
    const normalization = resolved.duplicateCount > 0 ? `, normalize ${resolved.duplicateCount} duplicate binding(s)` : ''
    console.log(`[dry-run] Would ${action}${normalization}, then apply remote D1 migrations for ${resolved.database.binding}.`)
    return { ...resolved.database, configPath, dryRun: true }
  }

  let databaseId = resolved.databaseId
  if (!databaseId) {
    databaseId = await resolveOrCreateDatabaseId(runtimeOptions, resolved)
  }
  await normalizeDatabaseBinding(configPath, options.env, resolved, databaseId)
  console.log(`Configured D1 binding ${resolved.database.binding} with database_id ${databaseId}.`)

  console.log(`Applying remote D1 migrations for ${resolved.database.binding}...`)
  await runWrangler([
    'd1',
    'migrations',
    'apply',
    resolved.database.binding,
    '--remote',
    ...wranglerConfigArgs(runtimeOptions)
  ])

  return {
    ...resolved.database,
    database_id: databaseId,
    configPath
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  try {
    await prepareCloudflareD1(parsePrepareArgs(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
