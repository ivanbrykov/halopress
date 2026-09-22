import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const prepareScript = join(projectRoot, 'scripts/prepare-cloudflare-d1.mjs')
const deployScript = join(projectRoot, 'scripts/deploy-cloudflare.sh')
const topologyScript = join(projectRoot, 'scripts/prepare-cloudflare-search-topology.mjs')

type RunResult = { code: number, stdout: string, stderr: string }

async function run(command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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
    child.once('close', code => resolveRun({ code: code ?? 1, stdout, stderr }))
  })
}

async function createFixture(config: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'halopress-cloudflare-deploy-'))
  const configPath = join(directory, 'wrangler.jsonc')
  const binDirectory = join(directory, 'bin')
  const logPath = join(directory, 'wrangler-calls.jsonl')
  const listCountPath = join(directory, 'list-count')
  const activationCountPath = join(directory, 'activation-count')
  const secretMetaPath = join(directory, 'secret-meta.json')
  const mockPath = join(directory, 'wrangler-mock.mjs')
  const curlPath = join(binDirectory, 'curl')
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  await mkdir(binDirectory, { recursive: true })
  await writeFile(mockPath, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n')

if (args[0] === 'secret' && args[1] === 'list') {
  if (process.env.MOCK_SECRET_LIST_ERROR === 'new-worker') {
    const tick = String.fromCharCode(96)
    console.error('Worker "halopress-test" not found.\\nIf this is a new Worker, run ' + tick + 'wrangler deploy' + tick + ' first to create it.')
    process.exit(1)
  }
  if (process.env.MOCK_SECRET_LIST_ERROR) {
    console.error(process.env.MOCK_SECRET_LIST_ERROR)
    process.exit(1)
  }
  console.log(process.env.MOCK_SECRET_LIST_JSON || JSON.stringify([
    { name: 'NUXT_AUTH_SECRET', type: 'secret_text' }
  ]))
  process.exit(0)
}

if (args[0] === 'd1' && args[1] === 'list') {
  const countPath = process.env.MOCK_LIST_COUNT
  const count = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8')) : 0
  writeFileSync(countPath, String(count + 1))
  const sequence = JSON.parse(process.env.MOCK_D1_LIST_SEQUENCE || '[[]]')
  const result = JSON.stringify(sequence[Math.min(count, sequence.length - 1)])
  process.stdout.write((process.env.MOCK_D1_LIST_PREFIX || '') + result + (process.env.MOCK_D1_LIST_SUFFIX || ''))
  process.exit(0)
}

if (args[0] === 'd1' && args[1] === 'create') {
  if (process.env.MOCK_CREATE_FAIL === '1') {
    console.error('A database with that name already exists')
    process.exit(1)
  }
  if (process.env.MOCK_CREATE_PATCH_ID) {
    const configIndex = args.indexOf('--config')
    const envIndex = args.indexOf('--env')
    const bindingIndex = args.indexOf('--binding')
    const configPath = args[configIndex + 1]
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const scope = envIndex >= 0 ? config.env[args[envIndex + 1]] : config
    scope.d1_databases.push({
      binding: args[bindingIndex + 1],
      database_name: args[2],
      database_id: process.env.MOCK_CREATE_PATCH_ID
    })
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\\n')
  }
  console.log('Successfully created D1 database')
  process.exit(0)
}

if (args[0] === 'd1' && args[1] === 'migrations' && args[2] === 'apply') {
  if (process.env.MOCK_MIGRATION_FAIL === '1') {
    console.error('mock migration failure')
    process.exit(1)
  }
  console.log('Migrations applied')
  process.exit(0)
}

if (args[0] === 'queues' && args[1] === 'info') {
  if (process.env.MOCK_QUEUE_MISSING === '1') {
    console.error('Queue not found')
    process.exit(1)
  }
  console.log('Queue exists')
  process.exit(0)
}

if (args[0] === 'queues' && args[1] === 'create') {
  console.log('Queue created')
  process.exit(0)
}

if (args[0] === 'queues' && args[1] === 'consumer' && args[2] === 'remove') {
  if (process.env.MOCK_CONSUMER_REMOVE_MISSING === args[4]) {
    console.error("No worker consumer '" + args[4] + "' exists for queue " + args[3])
    process.exit(1)
  }
  if (process.env.MOCK_CONSUMER_REMOVE_FAIL === args[4]) {
    console.error('mock consumer removal failure')
    process.exit(1)
  }
  console.log('Queue consumer removed')
  process.exit(0)
}

if (args[0] === 'queues' && args[1] === 'consumer' && args[2] === 'add') {
  if (process.env.MOCK_CONSUMER_ADD_FAIL === args[4]) {
    console.error('mock consumer restore failure')
    process.exit(1)
  }
  console.log('Queue consumer added')
  process.exit(0)
}

if (args[0] === 'deploy') {
  const configIndex = args.indexOf('--config')
  const isProbeDeploy = configIndex >= 0
    && args[configIndex + 1].endsWith('wrangler.durable-probe.jsonc')
  const nameIndex = args.indexOf('--name')
  if (isProbeDeploy && !args[nameIndex + 1]) {
    console.error('Durable Object probe name was not pinned')
    process.exit(1)
  }
  if (isProbeDeploy && process.env.MOCK_DURABLE_DEPLOY_FAIL === '1') {
    console.error('mock Durable Object probe deploy failure')
    process.exit(1)
  }
  const separatedIndex = args.indexOf('--secrets-file')
  const equalsArgument = args.find(argument => argument.startsWith('--secrets-file='))
  const secretsFile = separatedIndex >= 0 ? args[separatedIndex + 1] : equalsArgument?.slice('--secrets-file='.length)
  if (secretsFile && process.env.MOCK_SECRET_META) {
    const contents = readFileSync(secretsFile, 'utf8')
    let authSecret
    if (contents.trimStart().startsWith('{')) {
      authSecret = JSON.parse(contents).NUXT_AUTH_SECRET
    } else {
      const matches = [...contents.matchAll(/^NUXT_AUTH_SECRET=(.*)$/gm)]
      authSecret = matches.at(-1)?.[1]
    }
    writeFileSync(process.env.MOCK_SECRET_META, JSON.stringify({
      path: secretsFile,
      mode: statSync(secretsFile).mode & 0o777,
      authSecretCount: (contents.match(/^NUXT_AUTH_SECRET=/gm) || []).length,
      authSecretLength: typeof authSecret === 'string' ? authSecret.length : 0
    }))
  }
  if (!isProbeDeploy && process.env.MOCK_DEPLOY_FAIL === '1') {
    console.error('mock deploy failure')
    process.exit(1)
  }
  console.log(isProbeDeploy
    ? 'https://' + args[nameIndex + 1] + '.example.workers.dev'
    : (process.env.MOCK_MAIN_URL || 'https://halopress-test.example.workers.dev'))
  process.exit(0)
}

if (args[0] === 'delete') {
  if (process.env.MOCK_DELETE_FAIL === args[1]) {
    console.error('mock delete failure')
    process.exit(1)
  }
  console.log('Worker deleted')
  process.exit(0)
}

console.error('Unexpected Wrangler arguments: ' + args.join(' '))
process.exit(2)
`)
  await writeFile(curlPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const descriptor = JSON.parse(readFileSync(process.env.MOCK_DESCRIPTOR_PATH, 'utf8'))
const url = args.at(-1)
if (url.includes('/__halopress/search/analyzer-health')) {
  const countPath = process.env.MOCK_ACTIVATION_COUNT
  const attempt = countPath && existsSync(countPath)
    ? Number(readFileSync(countPath, 'utf8'))
    : 0
  if (countPath) writeFileSync(countPath, String(attempt + 1))
  const invalidAttempts = Number(process.env.MOCK_ACTIVATION_INVALID_ATTEMPTS || 0)
  writeFileSync(args[outputIndex + 1], JSON.stringify({
    ok: process.env.MOCK_ACTIVATION_INVALID !== '1' && attempt >= invalidAttempts,
    topology: 'durable-object',
    compatibility: {
      analyzerContractVersion: 1,
      artifactVersionId: descriptor.artifactVersionId,
      objectName: descriptor.objectName,
      tokenizer: { tokenizerGeneration: descriptor.tokenizerGeneration },
      wasmModuleTag: '[object WebAssembly.Module]',
      modelByteLength: descriptor.modelBytes
    },
    query: {
      tokenizerGeneration: descriptor.tokenizerGeneration,
      rawTerms: ['방에', '들어가'],
      morphTerms: ['방', '들어가']
    }
  }))
  process.stdout.write(process.env.MOCK_ACTIVATION_HTTP_STATUS || '200')
  process.exit(0)
}
const fixtures = [
  '아버지가 방에 들어가신다.',
  '어머니가 방에 들어가신다.',
  '방에 들어가'
].map((input, index) => ({
  input,
  id: 'fixture-' + index,
  ok: true,
  rawTerms: [input],
  morphTerms: [input]
}))
writeFileSync(args[outputIndex + 1], JSON.stringify({
  ok: true,
  topology: 'durable-object',
  descriptor,
  fixtures,
  compatibility: {
    analyzerContractVersion: 1,
    artifactVersionId: descriptor.artifactVersionId,
    objectName: descriptor.objectName,
    tokenizer: { tokenizerGeneration: descriptor.tokenizerGeneration },
    wasmModuleTag: '[object WebAssembly.Module]',
    modelByteLength: descriptor.modelBytes
  },
  repeatedParity: true,
  timings: { coldAndFixturesMs: 12, warmFixturesMs: 3 }
}))
process.stdout.write(process.env.MOCK_PROBE_HTTP_STATUS || '200')
`)
  await Promise.all([chmod(mockPath, 0o755), chmod(curlPath, 0o755)])

  return {
    directory,
    configPath,
    logPath,
    activationCountPath,
    secretMetaPath,
    env: {
      HALOPRESS_WRANGLER_BIN: mockPath,
      MOCK_LOG: logPath,
      MOCK_LIST_COUNT: listCountPath,
      MOCK_ACTIVATION_COUNT: activationCountPath,
      MOCK_SECRET_META: secretMetaPath,
      MOCK_DESCRIPTOR_PATH: join(
        projectRoot,
        'workers/search/src/generated-analyzer/descriptor.json'
      ),
      HALOPRESS_ACTIVATION_RETRY_SECONDS: '0',
      PATH: `${binDirectory}:${process.env.PATH}`
    }
  }
}

async function readCalls(logPath: string) {
  const contents = await readFile(logPath, 'utf8').catch(() => '')
  return contents.trim() ? contents.trim().split('\n').map(line => JSON.parse(line) as string[]) : []
}

function baseConfig(database: Record<string, unknown>) {
  return {
    name: 'halopress-test',
    main: 'worker.mjs',
    compatibility_date: '2026-05-18',
    d1_databases: [{ binding: 'DB', database_name: 'halopress-test', migrations_dir: 'migrations', ...database }]
  }
}

describe('Cloudflare deployment preparation', () => {
  it('prints the complete DO resource plan without mutating config', async () => {
    const fixture = await createFixture({
      ...baseConfig({ database_id: 'existing-id' }),
      services: [{ binding: 'SEARCH_WORKER', service: 'legacy-search' }],
      worker_loaders: [{ binding: 'LOADER' }]
    })
    const before = await readFile(fixture.configPath, 'utf8')
    const result = await run(process.execPath, [
      topologyScript,
      '--config', fixture.configPath,
      '--plan'
    ], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result).toMatchObject({ code: 0 })
    const output = JSON.parse(result.stdout)
    expect(output.plan).toMatchObject({
      topology: 'durable-object',
      namedWorkers: ['halopress-test'],
      legacyCleanup: { worker: 'halopress-test-search' },
      pipelines: expect.stringContaining('Not provisioned')
    })
    expect(output.plan.analyzerModules.wasm.wranglerRule).toBe('CompiledWasm')
    expect(output.plan.estimatedBillableDimensions).toHaveLength(4)
    expect(output.plan.deploymentOrder).toEqual(expect.arrayContaining([
      expect.stringContaining('detach the legacy halopress-test-search Queue consumer'),
      expect.stringContaining('delete the legacy halopress-test-search Worker')
    ]))
    expect(await readFile(fixture.configPath, 'utf8')).toBe(before)
    expect(await readCalls(fixture.logPath)).toEqual([])
  })

  it('rejects TOML configuration before making remote changes', async () => {
    const fixture = await createFixture(baseConfig({}))
    const tomlPath = join(fixture.directory, 'wrangler.toml')
    await writeFile(tomlPath, `name = "halopress-test"
main = "worker.mjs"
compatibility_date = "2026-05-18"

[[d1_databases]]
binding = "DB"
database_name = "halopress-test"
migrations_dir = "migrations"
`)

    const result = await run(process.execPath, [prepareScript, '--config', tomlPath], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('supports JSON or JSONC only')
    expect(result.stderr).toContain('convert this file to wrangler.jsonc')
    expect(await readCalls(fixture.logPath)).toEqual([])
  })

  it('applies migrations directly when database_id is already configured', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toEqual([
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath]
    ])
    const mainConfig = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(mainConfig.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'halopress-test',
      database_id: 'existing-id'
    })
  })

  it('adopts an existing same-name D1 database before applying migrations', async () => {
    const fixture = await createFixture(baseConfig({}))
    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_D1_LIST_SEQUENCE: JSON.stringify([[{ name: 'halopress-test', uuid: 'adopted-id' }]])
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toEqual([
      ['d1', 'list', '--json', '--config', fixture.configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath]
    ])
    expect(JSON.parse(await readFile(fixture.configPath, 'utf8')).d1_databases[0].database_id).toBe('adopted-id')
  })

  it('ignores bracketed log lines around the JSON D1 database list', async () => {
    const fixture = await createFixture(baseConfig({}))
    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_D1_LIST_SEQUENCE: JSON.stringify([[{ name: 'halopress-test', uuid: 'adopted-id' }]]),
        MOCK_D1_LIST_PREFIX: '[wrangler:inf] preparing D1 list\n',
        MOCK_D1_LIST_SUFFIX: '\n[wrangler:inf] request complete\n'
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toEqual([
      ['d1', 'list', '--json', '--config', fixture.configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath]
    ])
    expect(JSON.parse(await readFile(fixture.configPath, 'utf8')).d1_databases[0].database_id).toBe('adopted-id')
  })

  it('creates a missing D1 database, records its ID, and then migrates it', async () => {
    const fixture = await createFixture(baseConfig({}))
    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_CREATE_PATCH_ID: 'created-id',
        MOCK_D1_LIST_SEQUENCE: JSON.stringify([[]])
      }
    })

    expect(result).toMatchObject({ code: 0 })
    const calls = await readCalls(fixture.logPath)
    expect(calls).toHaveLength(3)
    expect(calls[1]).toEqual([
      'd1', 'create', 'halopress-test', '--binding', 'DB', '--update-config', '--config', fixture.configPath
    ])
    expect(calls[2]).toEqual([
      'd1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath
    ])
    const patched = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(patched.d1_databases).toHaveLength(1)
    expect(patched.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'halopress-test',
      database_id: 'created-id',
      migrations_dir: 'migrations'
    })
  })

  it('normalizes duplicate D1 bindings without discarding JSONC comments', async () => {
    const fixture = await createFixture(baseConfig({}))
    await writeFile(fixture.configPath, `{
  // Keep the deployment metadata readable for operators.
  "name": "halopress-test",
  "main": "worker.mjs",
  "compatibility_date": "2026-05-18",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "halopress-test",
      "migrations_dir": "migrations",
    },
    {
      "binding": "DB",
      "database_name": "halopress-test",
      "database_id": "created-id",
    },
  ],
}\n`)

    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toEqual([
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath]
    ])

    const configText = await readFile(fixture.configPath, 'utf8')
    expect(configText).toContain('// Keep the deployment metadata readable for operators.')
    const config = JSON.parse(configText.replace(/\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'))
    expect(config.d1_databases).toEqual([{
      binding: 'DB',
      database_name: 'halopress-test',
      migrations_dir: 'migrations',
      database_id: 'created-id'
    }])
  })

  it('falls back to D1 list when create does not patch the config', async () => {
    const fixture = await createFixture(baseConfig({}))
    const result = await run(process.execPath, [prepareScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_D1_LIST_SEQUENCE: JSON.stringify([
          [],
          [{ name: 'halopress-test', uuid: 'listed-created-id' }]
        ])
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toHaveLength(4)
    expect(JSON.parse(await readFile(fixture.configPath, 'utf8')).d1_databases[0].database_id).toBe('listed-created-id')
  })

  it('does not deploy when migrations fail', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_MIGRATION_FAIL: '1' }
    })

    expect(result.code).not.toBe(0)
    expect(await readCalls(fixture.logPath)).toEqual([
      ['secret', 'list', '--format', 'json', '--config', fixture.configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath]
    ])
  })

  it('creates a missing Queue, validates an isolated DO, hands off the consumer, then deletes the legacy Worker', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_QUEUE_MISSING: '1' }
    })

    expect(result).toMatchObject({ code: 0 })
    const calls = await readCalls(fixture.logPath)
    expect(calls.slice(2, 4)).toEqual([
      ['queues', 'info', 'halopress-test-search-index', '--config', fixture.configPath],
      ['queues', 'create', 'halopress-test-search-index', '--config', fixture.configPath]
    ])
    const probeDeploy = calls.findIndex(call =>
      call[0] === 'deploy' && call.some(value => value.endsWith('wrangler.durable-probe.jsonc')))
    const probeDelete = calls.findIndex(call =>
      call[0] === 'delete' && call.some(value => value.endsWith('wrangler.durable-probe.jsonc')))
    const mainDeploy = calls.findIndex(call =>
      call[0] === 'deploy' && call.includes(fixture.configPath))
    const legacyConsumerRemove = calls.findIndex(call =>
      call[0] === 'queues'
      && call[1] === 'consumer'
      && call[2] === 'remove'
      && call[4] === 'halopress-test-search')
    const legacyDelete = calls.findIndex(call =>
      call[0] === 'delete' && call[1] === 'halopress-test-search')
    expect(probeDeploy).toBeGreaterThan(3)
    expect(probeDelete).toBeGreaterThan(probeDeploy)
    expect(legacyConsumerRemove).toBeGreaterThan(probeDelete)
    expect(mainDeploy).toBeGreaterThan(legacyConsumerRemove)
    expect(legacyDelete).toBeGreaterThan(legacyConsumerRemove)
    expect(result.stdout).toContain('"topology": "durable-object"')
    expect(result.stdout).toContain('"cleanupVerified":true')
  })

  it('uses the deployed main activation gate when Workers Builds pins the Worker name', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, WORKERS_CI: '1' }
    })

    expect(result).toMatchObject({ code: 0 })
    const calls = await readCalls(fixture.logPath)
    expect(calls).not.toContainEqual(expect.arrayContaining([
      'deploy',
      expect.stringContaining('wrangler.durable-probe.jsonc')
    ]))
    expect(calls).not.toContainEqual(expect.arrayContaining([
      'delete',
      expect.stringContaining('wrangler.durable-probe.jsonc')
    ]))
    expect(calls).toContainEqual(['deploy', '--config', fixture.configPath])
    expect(result.stdout).toContain('Workers Builds pins deploys to the connected main Worker')
    expect(result.stdout).toContain('Main Worker Durable Object activation gate passed')
  })

  it('converges the config on one same-script Durable Object topology', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        CLOUDFLARE_WORKER_NAME: 'untrusted-build-override'
      }
    })

    expect(result).toMatchObject({ code: 0 })
    const mainConfig = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(mainConfig.name).toBe('halopress-test')
    expect(mainConfig.main).toMatch(/workers\/search\/src\/main-entry\.ts$/)
    expect(mainConfig.minify).toBe(true)
    expect(mainConfig.queues.producers).toContainEqual({
      binding: 'SEARCH_INDEX_QUEUE',
      queue: 'halopress-test-search-index'
    })
    expect(mainConfig.queues.consumers).toContainEqual(expect.objectContaining({
      queue: 'halopress-test-search-index'
    }))
    expect(mainConfig.durable_objects.bindings).toContainEqual({
      name: 'SEARCH_ANALYZER_DO',
      class_name: 'AnalyzerDurableObject'
    })
    expect(mainConfig.migrations).toContainEqual({
      tag: 'search-analyzer-v1',
      new_sqlite_classes: ['AnalyzerDurableObject']
    })
    expect(mainConfig.services).toBeUndefined()
    expect(mainConfig.worker_loaders).toBeUndefined()
    expect(mainConfig.vars.HALOPRESS_SEARCH_TOPOLOGY).toBeUndefined()
  })

  it('respects explicit Queue and legacy-cleanup names independently', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--name', 'newsroom-main'
    ], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        HALOPRESS_LEGACY_SEARCH_WORKER_NAME: 'shared-search-service',
        HALOPRESS_SEARCH_QUEUE_NAME: 'newsroom-index-jobs'
      }
    })

    expect(result).toMatchObject({ code: 0 })
    const calls = await readCalls(fixture.logPath)
    const mainConfig = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(mainConfig.name).toBe('newsroom-main')
    expect(mainConfig.queues.producers[0].queue).toBe('newsroom-index-jobs')
    expect(calls).toContainEqual([
      'queues', 'info', 'newsroom-index-jobs', '--config', fixture.configPath
    ])
    expect(calls).toContainEqual([
      'queues',
      'consumer',
      'remove',
      'newsroom-index-jobs',
      'shared-search-service',
      '--config',
      fixture.configPath
    ])
    expect(calls).toContainEqual([
      'delete', 'shared-search-service', '--config', fixture.configPath, '--force'
    ])
  })

  it('keeps derived search resource names within Cloudflare limits', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const mainName = 'publisher'.repeat(7)
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--name', mainName
    ], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result).toMatchObject({ code: 0 })
    const mainConfig = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    const queueName = mainConfig.queues.producers[0].queue as string
    const legacyDelete = (await readCalls(fixture.logPath))
      .find(call => call[0] === 'delete' && call[2] === '--config'
        && call[3] === fixture.configPath)
    expect(legacyDelete?.[1]).toHaveLength(63)
    expect(legacyDelete?.[1]).toMatch(/-[a-f0-9]{8}-search$/)
    expect(queueName).toHaveLength(63)
    expect(queueName).toMatch(/-[a-f0-9]{8}-search-index$/)
  })

  it('does not deploy main when the isolated Durable Object gate fails', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_DURABLE_DEPLOY_FAIL: '1' }
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('mock Durable Object probe deploy failure')
    const calls = await readCalls(fixture.logPath)
    expect(calls.at(-1)?.[0]).toBe('deploy')
    expect(calls.at(-1)?.some(value =>
      /wrangler\.durable-probe\.jsonc$/.test(value))).toBe(true)
    expect(calls).not.toContainEqual(['deploy', '--config', fixture.configPath])
  })

  it('reports a legacy deletion failure only after main is active', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_DELETE_FAIL: 'halopress-test-search' }
    })

    expect(result.code).not.toBe(0)
    const calls = await readCalls(fixture.logPath)
    const mainDeploy = calls.findIndex(call =>
      call[0] === 'deploy' && call.includes(fixture.configPath))
    const legacyDelete = calls.findIndex(call =>
      call[0] === 'delete' && call[1] === 'halopress-test-search')
    expect(mainDeploy).toBeGreaterThan(-1)
    expect(legacyDelete).toBeGreaterThan(mainDeploy)
    expect(result.stderr).toContain('mock delete failure')
  })

  it('does not deploy main or delete the legacy Worker when its Queue consumer cannot be detached', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_CONSUMER_REMOVE_FAIL: 'halopress-test-search'
      }
    })

    expect(result.code).not.toBe(0)
    const calls = await readCalls(fixture.logPath)
    const mainDeploy = calls.findIndex(call =>
      call[0] === 'deploy' && call.includes(fixture.configPath))
    const consumerRemove = calls.findIndex(call =>
      call[0] === 'queues'
      && call[1] === 'consumer'
      && call[2] === 'remove'
      && call[4] === 'halopress-test-search')
    expect(consumerRemove).toBeGreaterThan(-1)
    expect(mainDeploy).toBe(-1)
    expect(calls).not.toContainEqual([
      'delete', 'halopress-test-search', '--config', fixture.configPath, '--force'
    ])
    expect(result.stderr).toContain('mock consumer removal failure')
  })

  it('continues idempotent cleanup when the legacy Queue consumer is absent', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_CONSUMER_REMOVE_MISSING: 'halopress-test-search'
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(await readCalls(fixture.logPath)).toContainEqual([
      'delete', 'halopress-test-search', '--config', fixture.configPath, '--force'
    ])
    expect(result.stdout).toContain(
      'Legacy search Worker halopress-test-search was not a consumer'
    )
  })

  it('keeps the legacy Worker when the deployed main activation response is invalid', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_ACTIVATION_INVALID: '1' }
    })

    expect(result.code).not.toBe(0)
    const calls = await readCalls(fixture.logPath)
    expect(calls).toContainEqual(['deploy', '--config', fixture.configPath])
    expect(calls).toContainEqual([
      'queues',
      'consumer',
      'add',
      'halopress-test-search-index',
      'halopress-test-search',
      '--batch-size',
      '1',
      '--batch-timeout',
      '5',
      '--message-retries',
      '5',
      '--max-concurrency',
      '2',
      '--config',
      fixture.configPath
    ])
    expect(calls).not.toContainEqual([
      'delete', 'halopress-test-search', '--config', fixture.configPath, '--force'
    ])
  })

  it('retries a transient HTTP-200 activation response until the analyzer contract is ready', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_ACTIVATION_INVALID_ATTEMPTS: '1' }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain('Main Worker Durable Object activation gate passed')
    expect(await readFile(fixture.activationCountPath, 'utf8')).toBe('2')
    expect(await readCalls(fixture.logPath)).toContainEqual([
      'delete', 'halopress-test-search', '--config', fixture.configPath, '--force'
    ])
  })

  it('preserves an existing auth secret without passing a secrets file', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: fixture.env
    })
    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).not.toContain('Generated NUXT_AUTH_SECRET')
    const calls = await readCalls(fixture.logPath)
    expect(calls.slice(0, 3)).toEqual([
      ['secret', 'list', '--format', 'json', '--config', fixture.configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath],
      ['queues', 'info', 'halopress-test-search-index', '--config', fixture.configPath]
    ])
    expect(calls).toContainEqual(['deploy', '--config', fixture.configPath])
    await expect(readFile(fixture.secretMetaPath)).rejects.toThrow()
  })

  it('ignores a leading pnpm engine warning when parsing the Wrangler secret list', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_SECRET_LIST_JSON: '\u2009WARN\u2009 Unsupported engine: wanted Node >=22.17.0\n'
          + JSON.stringify([{ name: 'NUXT_AUTH_SECRET', type: 'secret_text' }])
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(result.stderr).not.toContain('Could not parse the Wrangler secret list response')
    expect(await readCalls(fixture.logPath)).toContainEqual([
      'deploy', '--config', fixture.configPath
    ])
  })

  it('generates one mode-0600 auth secret for a new Worker without logging its value', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_SECRET_LIST_ERROR: 'new-worker' }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain('Generated NUXT_AUTH_SECRET')
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/NUXT_AUTH_SECRET=[0-9a-f]{64}/)

    const calls = await readCalls(fixture.logPath)
    expect(calls.slice(0, 3)).toEqual([
      ['secret', 'list', '--format', 'json', '--config', fixture.configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', fixture.configPath],
      ['queues', 'info', 'halopress-test-search-index', '--config', fixture.configPath]
    ])
    const deployCall = calls.find(call =>
      call[0] === 'deploy' && call.includes(fixture.configPath))
    expect(deployCall?.filter(argument => argument === '--secrets-file')).toHaveLength(1)

    const secretMeta = JSON.parse(await readFile(fixture.secretMetaPath, 'utf8'))
    expect(secretMeta).toMatchObject({ mode: 0o600, authSecretCount: 1, authSecretLength: 64 })
    await expect(readFile(secretMeta.path)).rejects.toThrow()
  })

  it('fails closed on unknown secret-list errors before migrations', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_SECRET_LIST_ERROR: 'Authentication failed: invalid API token' }
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Authentication failed')
    expect(await readCalls(fixture.logPath)).toEqual([
      ['secret', 'list', '--format', 'json', '--config', fixture.configPath]
    ])
  })

  it('cleans generated secret files when deployment fails', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const result = await run('bash', [deployScript, '--config', fixture.configPath], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_SECRET_LIST_JSON: '[]',
        MOCK_DEPLOY_FAIL: '1'
      }
    })

    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('mock deploy failure')
    const secretMeta = JSON.parse(await readFile(fixture.secretMetaPath, 'utf8'))
    expect(secretMeta).toMatchObject({ mode: 0o600, authSecretCount: 1, authSecretLength: 64 })
    await expect(readFile(secretMeta.path)).rejects.toThrow()
  })

  it('accepts a 24-byte UTF-8 auth secret without adding a conflicting secrets file', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const userSecretsPath = join(fixture.directory, 'user-secrets.env')
    const providedSecret = '가나다라마바사아'
    await writeFile(userSecretsPath, `OPTIONAL_VALUE=test\nNUXT_AUTH_SECRET=${providedSecret}\n`)
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--secrets-file', userSecretsPath
    ], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_SECRET_LIST_ERROR: 'new-worker' }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(providedSecret)
    const deployCall = (await readCalls(fixture.logPath)).find(call =>
      call[0] === 'deploy' && call.includes(fixture.configPath))
    expect(deployCall?.filter(argument => argument === '--secrets-file')).toHaveLength(1)
    expect(deployCall).toContain(userSecretsPath)
    const secretMeta = JSON.parse(await readFile(fixture.secretMetaPath, 'utf8'))
    expect(secretMeta.path).toBe(userSecretsPath)
    expect(await readFile(userSecretsPath, 'utf8')).toContain('NUXT_AUTH_SECRET=')
  })

  it('rejects a supplied 20-byte auth secret before remote access or migrations', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const userSecretsPath = join(fixture.directory, 'weak-secrets.env')
    await writeFile(userSecretsPath, 'NUXT_AUTH_SECRET=user-selected-secret\n')
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--secrets-file', userSecretsPath
    ], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('must be at least 24 UTF-8 bytes')
    expect(result.stderr).toContain('openssl rand -hex 32')
    expect(await readCalls(fixture.logPath)).toEqual([])
  })

  it('rejects a caller secrets file without the required first-deploy auth secret', async () => {
    const fixture = await createFixture(baseConfig({ database_id: 'existing-id' }))
    const userSecretsPath = join(fixture.directory, 'user-secrets.json')
    await writeFile(userSecretsPath, JSON.stringify({ OPTIONAL_VALUE: 'test' }))
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--secrets-file', userSecretsPath
    ], {
      cwd: projectRoot,
      env: { ...fixture.env, MOCK_SECRET_LIST_JSON: '[]' }
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('must contain NUXT_AUTH_SECRET with at least 24 UTF-8 bytes')
    expect(await readCalls(fixture.logPath)).toEqual([
      ['secret', 'list', '--format', 'json', '--config', fixture.configPath]
    ])
  })

  it('keeps dry-run free of remote provisioning and migration changes', async () => {
    const fixture = await createFixture(baseConfig({}))
    const originalMainConfig = await readFile(fixture.configPath, 'utf8')
    const result = await run('bash', [deployScript, '--config', fixture.configPath, '--dry-run'], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        HALOPRESS_LEGACY_SEARCH_WORKER_NAME: 'temporary-dry-run-search',
        HALOPRESS_SEARCH_QUEUE_NAME: 'temporary-dry-run-queue'
      }
    })

    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain('[dry-run]')
    expect(await readCalls(fixture.logPath)).toEqual([
      ['deploy', '--config', fixture.configPath, '--dry-run']
    ])
    expect(await readFile(fixture.configPath, 'utf8')).toBe(originalMainConfig)
  })

  it('restores the Wrangler file when a dry-run deployment fails', async () => {
    const fixture = await createFixture(baseConfig({}))
    const originalMainConfig = await readFile(fixture.configPath, 'utf8')
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--name', 'temporary-preview',
      '--dry-run'
    ], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_DEPLOY_FAIL: '1'
      }
    })

    expect(result.code).not.toBe(0)
    expect(await readFile(fixture.configPath, 'utf8')).toBe(originalMainConfig)
  })

  it('derives an environment-scoped topology without a name override', async () => {
    const fixture = await createFixture({
      name: 'halopress-test',
      main: 'worker.mjs',
      compatibility_date: '2026-05-18',
      env: {
        staging: {
          d1_databases: [{
            binding: 'DB',
            database_name: 'halopress-staging',
            migrations_dir: 'migrations',
            database_id: 'staging-id'
          }]
        }
      }
    })
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--env', 'staging'
    ], {
      cwd: projectRoot,
      env: fixture.env
    })

    expect(result).toMatchObject({ code: 0 })
    const common = ['--config', fixture.configPath, '--env', 'staging']
    const calls = await readCalls(fixture.logPath)
    expect(calls.slice(0, 3)).toEqual([
      ['secret', 'list', '--format', 'json', ...common],
      ['d1', 'migrations', 'apply', 'DB', '--remote', ...common],
      [
        'queues',
        'info',
        'halopress-test-staging-search-index',
        '--config',
        fixture.configPath,
        '--env',
        'staging'
      ]
    ])
    expect(calls).toContainEqual(['deploy', ...common])
    expect(calls).toContainEqual([
      'delete',
      'halopress-test-staging-search',
      '--config',
      fixture.configPath,
      '--force'
    ])
    const patched = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(patched.env.staging.name).toBe('halopress-test-staging')
    expect(patched.env.staging.queues.producers[0].queue)
      .toBe('halopress-test-staging-search-index')
    expect(patched.env.staging.services).toBeUndefined()
    expect(patched.env.staging.durable_objects.bindings[0].class_name)
      .toBe('AnalyzerDurableObject')
  })

  it('uses environment bindings and forwards config/env/name to the applicable commands', async () => {
    const fixture = await createFixture({
      name: 'halopress-test',
      main: 'worker.mjs',
      compatibility_date: '2026-05-18',
      env: {
        staging: {
          d1_databases: [{
            binding: 'DB',
            database_name: 'halopress-staging',
            migrations_dir: 'migrations'
          }]
        }
      }
    })
    const result = await run('bash', [
      deployScript,
      '--config', fixture.configPath,
      '--env', 'staging',
      '--name', 'halopress-staging-worker'
    ], {
      cwd: projectRoot,
      env: {
        ...fixture.env,
        MOCK_D1_LIST_SEQUENCE: JSON.stringify([[{ name: 'halopress-staging', uuid: 'staging-id' }]])
      }
    })

    expect(result).toMatchObject({ code: 0 })
    const common = ['--config', fixture.configPath, '--env', 'staging']
    const calls = await readCalls(fixture.logPath)
    expect(calls.slice(0, 4)).toEqual([
      ['secret', 'list', '--format', 'json', ...common, '--name', 'halopress-staging-worker'],
      ['d1', 'list', '--json', ...common],
      ['d1', 'migrations', 'apply', 'DB', '--remote', ...common],
      [
        'queues',
        'info',
        'halopress-staging-worker-search-index',
        '--config',
        fixture.configPath,
        '--env',
        'staging'
      ]
    ])
    expect(calls).toContainEqual([
      'deploy', ...common, '--name', 'halopress-staging-worker'
    ])
    expect(calls).toContainEqual([
      'delete',
      'halopress-staging-worker-search',
      '--config',
      fixture.configPath,
      '--force'
    ])
    const patched = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(patched.env.staging.d1_databases[0].database_id).toBe('staging-id')
    expect(patched.env.staging.queues.producers).toContainEqual({
      binding: 'SEARCH_INDEX_QUEUE',
      queue: 'halopress-staging-worker-search-index'
    })
    expect(patched.env.staging.services).toBeUndefined()
    expect(patched.env.staging.durable_objects.bindings).toContainEqual({
      name: 'SEARCH_ANALYZER_DO',
      class_name: 'AnalyzerDurableObject'
    })
  })

  it('exposes the custom deploy wrapper for Deploy Button detection', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    expect(packageJson.scripts.deploy).toBe('bash scripts/deploy-cloudflare.sh')
    expect(packageJson.scripts['db:d1:list']).toBe('wrangler d1 migrations list DB')
    expect(packageJson.scripts['db:d1:apply']).toBe('wrangler d1 migrations apply DB')
    expect(packageJson.scripts['db:d1:apply:local']).toBe('wrangler d1 migrations apply DB --local')
    expect(packageJson.scripts['db:d1:apply:remote']).toBe('wrangler d1 migrations apply DB --remote')
  })

  it('keeps the automatically managed auth secret out of one-click form metadata', async () => {
    const devVarsExample = await readFile(join(projectRoot, '.dev.vars.example'), 'utf8')
    const secretNames = [...devVarsExample.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map(match => match[1])
    expect(secretNames).toEqual([])

    const wranglerConfig = parseJsonc(await readFile(join(projectRoot, 'wrangler.jsonc'), 'utf8'))
    expect(wranglerConfig.secrets).toBeUndefined()
    expect(wranglerConfig.compatibility_flags).toContain('global_fetch_strictly_public')

    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    expect(Object.keys(packageJson.cloudflare.bindings)).not.toContain('NUXT_AUTH_SECRET')
    expect(Object.keys(packageJson.cloudflare.bindings)).not.toContain('NUXT_OAUTH_GOOGLE_CLIENT_ID')
    expect(Object.keys(packageJson.cloudflare.bindings)).not.toContain('NUXT_OAUTH_GOOGLE_CLIENT_SECRET')
  })

  it('uses Cloudflare image transforms in Workers builds with a raw asset fallback', async () => {
    const imageComponent = await readFile(join(projectRoot, 'app/components/AssetImage.vue'), 'utf8')
    expect(imageComponent).not.toContain('provider="none"')
    expect(imageComponent).toContain('<NuxtImg')
    expect(imageComponent).toContain('optimizedImageFailed')
    expect(imageComponent).toContain('<img')

    const nuxtConfig = await readFile(join(projectRoot, 'nuxt.config.ts'), 'utf8')
    expect(nuxtConfig).toContain('process.env.WORKERS_CI === \'1\'')
    expect(nuxtConfig).toContain('isCloudflareBuild ? \'cloudflare\' : \'ipx\'')
    expect(nuxtConfig).toContain('imageProvider === \'ipx\'')
    expect(nuxtConfig).toContain('? { \'/assets\': ipxAssetsAlias }')
    expect(nuxtConfig).toContain('const cloudflareBaseURL = process.env.NUXT_IMAGE_CLOUDFLARE_BASE_URL')
    expect(nuxtConfig).not.toContain('NUXT_IMAGE_CLOUDFLARE_BASE_URL || process.env.CF_PAGES_URL')
    expect(nuxtConfig).toContain('cloudflare: cloudflareBaseURL ? { baseURL: cloudflareBaseURL } : {}')
    expect(nuxtConfig).not.toContain('providers: {')

    const wranglerBuildScript = await readFile(join(projectRoot, 'scripts/wrangler-build.sh'), 'utf8')
    expect(wranglerBuildScript).toContain('NUXT_IMAGE_PROVIDER="${NUXT_IMAGE_PROVIDER:-cloudflare}" pnpm build')

    const assetImageViews = [
      'app/pages/_desk/assets/index.vue',
      'app/pages/_desk/assets/[assetId].vue',
      'app/components/public/FieldRenderer.vue',
      'app/components/public/AssetGallery.vue',
      'app/components/public/ContentCollectionRenderer.vue',
      'app/components/cms/AssetPicker.vue',
      'app/components/AssetActions.vue'
    ]
    for (const path of assetImageViews) {
      expect(await readFile(join(projectRoot, path), 'utf8')).toContain('<AssetImage')
    }
    expect(await readFile(join(projectRoot, 'app/pages/_desk/assets/index.vue'), 'utf8')).toContain('preset="card"')
  })
})
