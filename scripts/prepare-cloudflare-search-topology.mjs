#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { applyEdits, modify, parse } from 'jsonc-parser'

const MAX_RESOURCE_NAME_LENGTH = 63
const SEARCH_QUEUE_BINDING = 'SEARCH_INDEX_QUEUE'
const LEGACY_SEARCH_SERVICE_BINDING = 'SEARCH_WORKER'
const SEARCH_DO_BINDING = 'SEARCH_ANALYZER_DO'
const SEARCH_DO_CLASS = 'AnalyzerDurableObject'
const SEARCH_DO_MIGRATION_TAG = 'search-analyzer-v1'
const SEARCH_CRON = '*/5 * * * *'
const MAIN_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../workers/search/src/main-entry.ts'
)
const ANALYZER_RULES = [
  {
    type: 'CompiledWasm',
    globs: ['**/*.wasm'],
    fallthrough: true
  },
  {
    type: 'Data',
    globs: ['**/*.gmdl'],
    fallthrough: true
  }
]

function parseArgs(argv) {
  const options = {
    config: undefined,
    env: undefined,
    legacySearchWorkerName: undefined,
    mainName: undefined,
    plan: false,
    searchQueueName: undefined
  }
  const args = [...argv]
  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--plan') {
      options.plan = true
      continue
    }
    const key = {
      '--config': 'config',
      '--env': 'env',
      '--legacy-search-worker-name': 'legacySearchWorkerName',
      '--main-name': 'mainName',
      '--search-queue-name': 'searchQueueName'
    }[argument]
    if (!key) throw new Error(`Unsupported search topology argument: ${argument}`)
    const value = args.shift()
    if (!value) throw new Error(`Missing value for ${argument}`)
    options[key] = value
  }
  if (!options.config) throw new Error('Missing value for --config')
  return options
}

function parseConfig(text, configPath) {
  const errors = []
  const config = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || !config || typeof config !== 'object') {
    throw new Error(`Could not parse JSONC config: ${configPath}`)
  }
  return config
}

function scopedResourceName(mainName, suffix) {
  const candidate = `${mainName}${suffix}`
  if (candidate.length <= MAX_RESOURCE_NAME_LENGTH) return candidate
  const digest = createHash('sha256').update(mainName).digest('hex').slice(0, 8)
  const prefixLength = MAX_RESOURCE_NAME_LENGTH - suffix.length - digest.length - 1
  if (prefixLength < 1) throw new Error(`Cannot derive a scoped resource name from "${mainName}"`)
  return `${mainName.slice(0, prefixLength)}-${digest}${suffix}`
}

function updateJsonc(text, path, value) {
  return applyEdits(text, modify(text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' }
  }))
}

function updateBinding(entries, binding, property, value) {
  const next = Array.isArray(entries) ? entries.map(entry => ({ ...entry })) : []
  const matches = next
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.binding === binding)
  if (matches.length > 1) throw new Error(`Binding "${binding}" is declared more than once`)
  if (matches.length === 1) {
    next[matches[0].index][property] = value
  } else {
    next.push({ binding, [property]: value })
  }
  return next
}

function updateNamedBinding(entries, name, values) {
  const next = Array.isArray(entries) ? entries.map(entry => ({ ...entry })) : []
  const matches = next
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.name === name)
  if (matches.length > 1) throw new Error(`Binding "${name}" is declared more than once`)
  if (matches.length === 1) {
    next[matches[0].index] = { ...next[matches[0].index], ...values, name }
  } else {
    next.push({ name, ...values })
  }
  return next
}

function sameRule(left, right) {
  return left?.type === right.type
    && JSON.stringify(left?.globs) === JSON.stringify(right.globs)
}

export async function prepareSearchTopology(options) {
  const configPath = resolve(options.config)
  let mainText = await readFile(configPath, 'utf8')
  let mainConfig = parseConfig(mainText, configPath)
  const mainScope = options.env ? mainConfig.env?.[options.env] : mainConfig
  if (options.env && (!mainScope || typeof mainScope !== 'object')) {
    throw new Error(`Wrangler environment not found: ${options.env}`)
  }

  const configuredMainName = options.env
    ? mainScope.name || (mainConfig.name ? `${mainConfig.name}-${options.env}` : undefined)
    : mainConfig.name
  const mainName = options.mainName?.trim() || configuredMainName?.trim()
  if (!mainName) throw new Error(`Main Worker name is missing in ${configPath}`)
  const searchQueueName = options.searchQueueName?.trim()
    || scopedResourceName(mainName, '-search-index')
  const legacySearchWorkerName = options.legacySearchWorkerName?.trim()
    || scopedResourceName(mainName, '-search')
  const mainEntryPath = relative(dirname(configPath), MAIN_ENTRY).split(sep).join('/')
  const mainEntry = mainEntryPath.startsWith('.') ? mainEntryPath : `./${mainEntryPath}`
  const scopePath = options.env ? ['env', options.env] : []

  mainText = updateJsonc(mainText, [...scopePath, 'name'], mainName)
  mainText = updateJsonc(mainText, [...scopePath, 'main'], mainEntry)
  mainText = updateJsonc(mainText, [...scopePath, 'minify'], true)
  mainConfig = parseConfig(mainText, configPath)
  const scope = options.env ? mainConfig.env[options.env] : mainConfig

  const producers = updateBinding(
    scope.queues?.producers,
    SEARCH_QUEUE_BINDING,
    'queue',
    searchQueueName
  )
  const existingConsumers = Array.isArray(scope.queues?.consumers)
    ? scope.queues.consumers.filter(consumer => consumer?.queue !== searchQueueName)
    : []
  const consumers = [
    ...existingConsumers,
    {
      queue: searchQueueName,
      max_batch_size: 1,
      max_batch_timeout: 5,
      max_retries: 5,
      max_concurrency: 2
    }
  ]
  const services = Array.isArray(scope.services)
    ? scope.services.filter(service => service?.binding !== LEGACY_SEARCH_SERVICE_BINDING)
    : []
  const workerLoaders = Array.isArray(scope.worker_loaders)
    ? scope.worker_loaders.filter(loader => loader?.binding !== 'LOADER')
    : []
  const durableBindings = updateNamedBinding(
    scope.durable_objects?.bindings,
    SEARCH_DO_BINDING,
    { class_name: SEARCH_DO_CLASS }
  )
  const existingMigrations = Array.isArray(scope.migrations)
    ? scope.migrations
    : []
  const hasMigration = existingMigrations.some(migration =>
    Array.isArray(migration?.new_sqlite_classes)
    && migration.new_sqlite_classes.includes(SEARCH_DO_CLASS)
  )
  const migrations = hasMigration
    ? existingMigrations
    : [
        ...existingMigrations,
        {
          tag: SEARCH_DO_MIGRATION_TAG,
          new_sqlite_classes: [SEARCH_DO_CLASS]
        }
      ]
  const existingCrons = Array.isArray(scope.triggers?.crons)
    ? scope.triggers.crons.filter(cron => cron !== SEARCH_CRON)
    : []
  const rules = [
    ...(Array.isArray(scope.rules)
      ? scope.rules.filter(rule => !ANALYZER_RULES.some(required => sameRule(rule, required)))
      : []),
    ...ANALYZER_RULES
  ]
  const vars = {
    ...(scope.vars ?? {}),
    NUXT_PUBLIC_KEYWORD_SEARCH_MODE: 'server',
    NUXT_PUBLIC_KEYWORD_SEARCH_BROWSER_FALLBACK: 'true'
  }
  delete vars.HALOPRESS_SEARCH_TOPOLOGY

  mainText = updateJsonc(mainText, [...scopePath, 'queues', 'producers'], producers)
  mainText = updateJsonc(mainText, [...scopePath, 'queues', 'consumers'], consumers)
  mainText = updateJsonc(
    mainText,
    [...scopePath, 'services'],
    services.length ? services : undefined
  )
  mainText = updateJsonc(
    mainText,
    [...scopePath, 'worker_loaders'],
    workerLoaders.length ? workerLoaders : undefined
  )
  mainText = updateJsonc(mainText, [...scopePath, 'durable_objects', 'bindings'], durableBindings)
  mainText = updateJsonc(mainText, [...scopePath, 'migrations'], migrations)
  mainText = updateJsonc(mainText, [...scopePath, 'triggers', 'crons'], [...existingCrons, SEARCH_CRON])
  mainText = updateJsonc(mainText, [...scopePath, 'rules'], rules)
  mainText = updateJsonc(mainText, [...scopePath, 'vars'], vars)

  const finalMain = parseConfig(mainText, configPath)
  const finalScope = options.env ? finalMain.env?.[options.env] : finalMain
  const d1 = (finalScope.d1_databases ?? [])
    .filter(entry => entry?.binding === 'DB')
    .map(entry => ({
      binding: entry.binding,
      databaseName: entry.database_name,
      databaseId: entry.database_id ?? null
    }))
  const r2 = (finalScope.r2_buckets ?? [])
    .filter(entry => entry?.binding === 'CONTENT_ASSETS')
    .map(entry => ({
      binding: entry.binding,
      bucketName: entry.bucket_name
    }))
  const plan = {
    topology: 'durable-object',
    workersPlan: 'Uses Free-available SQLite Durable Objects; target-account Worker size and CPU gates still apply',
    namedWorkers: [mainName],
    mainWorker: {
      name: mainName,
      entry: mainEntry,
      minify: true,
      bindings: [
        'DB (D1)',
        'CONTENT_ASSETS (R2)',
        `${SEARCH_QUEUE_BINDING} (Queue producer)`,
        `${SEARCH_DO_BINDING} (SQLite Durable Object)`
      ],
      queueConsumer: searchQueueName,
      cron: SEARCH_CRON,
      durableObject: {
        binding: SEARCH_DO_BINDING,
        className: SEARCH_DO_CLASS,
        migrationTag: SEARCH_DO_MIGRATION_TAG,
        storageBackend: 'SQLite',
        objectIdentity: 'garu:<sha256(complete generated analyzer descriptor)>',
        storageWrites: false
      }
    },
    durableResources: {
      d1,
      r2,
      queue: searchQueueName,
      preservedDuringLegacyCleanup: true
    },
    legacyCleanup: {
      worker: legacySearchWorkerName,
      timing: 'after the main Worker is successfully deployed with the Queue consumer active'
    },
    analyzerModules: {
      wasm: {
        path: 'workers/search/src/generated-assets/garu_wasm_bg.wasm',
        wranglerRule: 'CompiledWasm'
      },
      model: {
        path: 'workers/search/src/generated-assets/base.gmdl',
        wranglerRule: 'Data'
      },
      descriptor: 'workers/search/src/generated-analyzer/descriptor.json'
    },
    routes: finalScope.routes ?? [],
    vars,
    secrets: ['NUXT_AUTH_SECRET (existing or generated during deployment)'],
    estimatedBillableDimensions: [
      'one main Worker invocation for each HTTP, Queue, or scheduled event',
      'one Durable Object request for each raw query or bounded four-chunk analyzer batch',
      'Durable Object request duration while Garu initializes or analyzes',
      'existing Queue messages and D1 operations; no additional Pipeline events'
    ],
    deploymentOrder: [
      'prepare and migrate the existing D1 database',
      'create or reuse the existing Queue',
      'deploy and invoke an isolated real-Garu Durable Object compatibility probe',
      'delete the isolated compatibility probe',
      `detach the legacy ${legacySearchWorkerName} Queue consumer immediately before deployment and restore it if deployment or activation fails`,
      'deploy the main Worker with fetch, Queue, cron, and the Analyzer Durable Object',
      `delete the legacy ${legacySearchWorkerName} Worker`
    ],
    continuity: 'D1 outbox leases and generation activation tolerate the bounded legacy/main Queue-consumer handoff.',
    pipelines: 'Not provisioned: Pipelines fan-out targets analytical stream-to-R2 sinks and would duplicate the D1 outbox plus Queue delivery boundary.'
  }

  if (!options.plan) await writeFile(configPath, mainText)

  const producer = finalScope.queues?.producers
    ?.find(entry => entry?.binding === SEARCH_QUEUE_BINDING)
  const consumer = finalScope.queues?.consumers
    ?.find(entry => entry?.queue === searchQueueName)
  const durable = finalScope.durable_objects?.bindings
    ?.find(entry => entry?.name === SEARCH_DO_BINDING)
  if (finalScope.name !== mainName
    || finalScope.main !== mainEntry
    || finalScope.minify !== true
    || producer?.queue !== searchQueueName
    || !consumer
    || durable?.class_name !== SEARCH_DO_CLASS
    || finalScope.services?.some(entry => entry?.binding === LEGACY_SEARCH_SERVICE_BINDING)
    || finalScope.worker_loaders?.some(entry => entry?.binding === 'LOADER')) {
    throw new Error('Failed to prepare the Durable Object search topology')
  }

  return {
    configPath,
    mainName,
    mainEntry,
    searchQueueName,
    legacySearchWorkerName,
    planOnly: Boolean(options.plan),
    plan
  }
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  try {
    const result = await prepareSearchTopology(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
