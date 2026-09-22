import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputEntry = resolve(root, '.output/server/index.mjs')
const temporary = await mkdtemp(join(tmpdir(), 'halopress-node-search-built-'))
const databaseDirectory = join(temporary, '.data')
const databasePath = join(databaseDirectory, 'halopress.sqlite')

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const port = address.port
  await new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

async function applyMigrations(sqlite) {
  const directory = resolve(root, 'server/db/migrations')
  const files = (await readdir(directory))
    .filter(filename => /^\d{4}_.+\.sql$/.test(filename))
    .sort()
  for (const filename of files) {
    const sql = await readFile(resolve(directory, filename), 'utf8')
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map(value => value.trim())
      .filter(Boolean)) {
      sqlite.exec(statement)
    }
  }
}

let child
try {
  await import('node:fs/promises').then(fs => fs.mkdir(databaseDirectory, {
    recursive: true
  }))
  const sqlite = new DatabaseSync(databasePath)
  await applyMigrations(sqlite)
  sqlite.close()

  const port = await availablePort()
  let stdout = ''
  let stderr = ''
  child = spawn(process.execPath, [outputEntry], {
    cwd: temporary,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      NUXT_PUBLIC_KEYWORD_SEARCH_MODE: 'server',
      NUXT_PUBLIC_KEYWORD_SEARCH_BROWSER_FALLBACK: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const origin = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  let capabilities
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/keyword-search/capabilities`)
      if (response.ok) {
        capabilities = await response.json()
        if (capabilities?.analyzer?.status === 'available') break
      }
    } catch {
      capabilities = null
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  assert.equal(capabilities?.mode, 'server')
  assert.deepEqual(capabilities?.analyzer, {
    status: 'available',
    retryable: true
  }, `${stdout}\n${stderr}`)
  const healthResponse = await fetch(
    `${origin}/__halopress/search/analyzer-health`
  )
  const healthText = await healthResponse.text()
  assert.equal(healthResponse.status, 200, healthText)
  const health = JSON.parse(healthText)
  assert.equal(health.topology, 'node-worker-thread-sqlite')
  assert.equal(health.health?.analyzer?.status, 'available')
  assert.equal(health.health?.runner?.pollIntervalMs, 1000)
  assert.equal(health.compatibility?.artifactVersionId?.startsWith(
    'halopress-garu-'
  ), true)

  const raw = await fetch(`${origin}/api/keyword-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractVersion: 1,
      mode: 'raw',
      query: '방에 들어가',
      operator: 'all',
      schemaKeys: [],
      fieldIds: [],
      filters: [],
      cursor: null,
      limit: 10
    })
  })
  const rawText = await raw.text()
  assert.equal(raw.status, 200, rawText)
  const result = JSON.parse(rawText)
  assert.equal(result.tokenizerGeneration, capabilities.tokenizerGeneration)
  assert.deepEqual(result.items, [])

  child.kill('SIGTERM')
  const code = await new Promise((resolveClose) => {
    child.once('close', resolveClose)
  })
  assert.equal(code, 0, stderr)
  assert.match(stdout, /"topology":"node-worker-thread-sqlite"/)
  process.stdout.write(JSON.stringify({
    ok: true,
    topology: 'node-worker-thread-sqlite',
    analyzer: capabilities.analyzer,
    tokenizerGeneration: result.tokenizerGeneration
  }) + '\n')
} finally {
  if (child && child.exitCode == null) child.kill('SIGKILL')
  await rm(temporary, { recursive: true, force: true })
}
