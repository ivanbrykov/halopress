#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
PREFIX="hp105-${RUN_ID}"
WORKER_NAME="${PREFIX}-main"
D1_NAME="${PREFIX}-d1"
R2_NAME="${PREFIX}-r2"
QUEUE_NAME="${PREFIX}-queue"
EXECUTE=0

if [ "${1:-}" = "--execute" ]; then
  EXECUTE=1
elif [ "$#" -ne 0 ]; then
  echo 'Usage: validate-cloudflare-durable-search.sh [--execute]' >&2
  exit 1
fi

node -e '
console.log(JSON.stringify({
  validation: "isolated-durable-search",
  mutatesProduction: false,
  execute: process.argv[1] === "1",
  resources: {
    worker: process.argv[2],
    d1: process.argv[3],
    r2: process.argv[4],
    queue: process.argv[5],
    durableObject: "AnalyzerDurableObject (namespace owned by the isolated Worker)"
  },
  checks: [
    "all D1 migrations and FTS5 table",
    "main Worker upload and startup",
    "same-script Durable Object health and Korean query",
    "Nitro fetch and D1-bound install-status responses",
    "Queue producer/consumer and scheduled trigger bindings",
    "reverse-order deletion and post-delete absence"
  ]
}, null, 2))
' "$EXECUTE" "$WORKER_NAME" "$D1_NAME" "$R2_NAME" "$QUEUE_NAME"

if [ "$EXECUTE" -ne 1 ]; then
  echo 'Plan only. Re-run with --execute to create these isolated resources.'
  exit 0
fi

run_wrangler() {
  pnpm wrangler "$@"
}

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/halopress-do-validation.XXXXXX")"
CONFIG_PATH="$TEMP_DIR/wrangler.validation.json"
HEALTH_PATH="$TEMP_DIR/health.json"
SSR_PATH="$TEMP_DIR/ssr.html"
INSTALL_STATUS_PATH="$TEMP_DIR/install-status.json"
D1_CREATED=0
R2_CREATED=0
QUEUE_CREATED=0
WORKER_CREATED=0

cleanup_local() {
  find "$TEMP_DIR" -type f -delete 2>/dev/null || true
  rmdir "$TEMP_DIR" 2>/dev/null || true
}

cleanup_remote() {
  local cleanup_failed=0
  if [ "$WORKER_CREATED" -eq 1 ] && [ "$QUEUE_CREATED" -eq 1 ]; then
    if ! run_wrangler queues consumer remove "$QUEUE_NAME" "$WORKER_NAME" \
      --config "$CONFIG_PATH"; then
      cleanup_failed=1
    fi
  fi
  if [ "$WORKER_CREATED" -eq 1 ]; then
    if run_wrangler delete "$WORKER_NAME" --config "$CONFIG_PATH" --force; then
      WORKER_CREATED=0
    else
      cleanup_failed=1
    fi
  fi
  if [ "$QUEUE_CREATED" -eq 1 ]; then
    if run_wrangler queues delete "$QUEUE_NAME" --config "$CONFIG_PATH"; then
      QUEUE_CREATED=0
    else
      cleanup_failed=1
    fi
  fi
  if [ "$R2_CREATED" -eq 1 ]; then
    if run_wrangler r2 bucket delete "$R2_NAME" --config "$CONFIG_PATH"; then
      R2_CREATED=0
    else
      cleanup_failed=1
    fi
  fi
  if [ "$D1_CREATED" -eq 1 ]; then
    if run_wrangler d1 delete "$D1_NAME" --config "$CONFIG_PATH" --skip-confirmation; then
      D1_CREATED=0
    else
      cleanup_failed=1
    fi
  fi
  return "$cleanup_failed"
}

cleanup_all() {
  local original_status=$?
  set +e
  cleanup_remote
  local remote_status=$?
  cleanup_local
  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$remote_status"
}

trap cleanup_all EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

echo "Creating isolated D1 database ${D1_NAME}..."
D1_CREATE_OUTPUT="$(run_wrangler d1 create "$D1_NAME" --location apac 2>&1)"
printf '%s\n' "$D1_CREATE_OUTPUT"
D1_CREATED=1
D1_ID="$(printf '%s' "$D1_CREATE_OUTPUT" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const match = input.match(/database_id\s*[=:]\s*["\x27]?([0-9a-f-]{36})/iu)
    || input.match(/\b([0-9a-f]{8}-[0-9a-f-]{27})\b/iu)
  if (!match) process.exit(1)
  process.stdout.write(match[1])
})
')"

echo "Creating isolated R2 bucket ${R2_NAME}..."
run_wrangler r2 bucket create "$R2_NAME" --location apac
R2_CREATED=1

echo "Creating isolated Queue ${QUEUE_NAME}..."
run_wrangler queues create "$QUEUE_NAME"
QUEUE_CREATED=1

node - "$CONFIG_PATH" "$ROOT_DIR" "$WORKER_NAME" "$D1_NAME" "$D1_ID" "$R2_NAME" "$QUEUE_NAME" <<'NODE'
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const [configPath, root, worker, database, databaseId, bucket, queue] = process.argv.slice(2)
writeFileSync(configPath, `${JSON.stringify({
  name: worker,
  main: resolve(root, 'workers/search/src/main-entry.ts'),
  minify: true,
  compatibility_date: '2026-05-18',
  compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  workers_dev: true,
  assets: { directory: resolve(root, '.output/public') },
  observability: { enabled: true },
  d1_databases: [{
    binding: 'DB',
    database_name: database,
    database_id: databaseId,
    migrations_dir: resolve(root, 'server/db/migrations')
  }],
  r2_buckets: [{ binding: 'CONTENT_ASSETS', bucket_name: bucket }],
  queues: {
    producers: [{ binding: 'SEARCH_INDEX_QUEUE', queue }],
    consumers: [{
      queue,
      max_batch_size: 1,
      max_batch_timeout: 5,
      max_retries: 5,
      max_concurrency: 2
    }]
  },
  durable_objects: {
    bindings: [{
      name: 'SEARCH_ANALYZER_DO',
      class_name: 'AnalyzerDurableObject'
    }]
  },
  migrations: [{
    tag: 'search-analyzer-v1',
    new_sqlite_classes: ['AnalyzerDurableObject']
  }],
  triggers: { crons: ['*/5 * * * *'] },
  rules: [
    { type: 'CompiledWasm', globs: ['**/*.wasm'], fallthrough: true },
    { type: 'Data', globs: ['**/*.gmdl'], fallthrough: true }
  ],
  vars: {
    NUXT_PUBLIC_KEYWORD_SEARCH_MODE: 'server',
    NUXT_PUBLIC_KEYWORD_SEARCH_BROWSER_FALLBACK: 'true'
  }
}, null, 2)}\n`)
NODE

echo 'Applying all migrations to the isolated D1 database...'
run_wrangler d1 migrations apply DB --remote --config "$CONFIG_PATH"

pnpm --filter @halopress/search-worker exec tsx scripts/prepare-assets.mjs >/dev/null
echo "Deploying isolated main Worker ${WORKER_NAME}..."
set +e
DEPLOY_OUTPUT="$(HALOPRESS_SKIP_WRANGLER_BUILD=1 run_wrangler deploy --config "$CONFIG_PATH" 2>&1)"
DEPLOY_EXIT=$?
set -e
printf '%s\n' "$DEPLOY_OUTPUT"
if [ "$DEPLOY_EXIT" -ne 0 ]; then
  exit "$DEPLOY_EXIT"
fi
WORKER_CREATED=1
WORKER_URL="$(printf '%s' "$DEPLOY_OUTPUT" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const urls = input.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/giu) || []
  if (!urls.length) process.exit(1)
  process.stdout.write(urls.at(-1))
})
')"

HEALTH_STATUS=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  HEALTH_STATUS="$(curl --silent --show-error \
    --output "$HEALTH_PATH" \
    --write-out '%{http_code}' \
    "${WORKER_URL}/__halopress/search/analyzer-health" || true)"
  if [ "$HEALTH_STATUS" = "200" ]; then
    break
  fi
  if [ "$attempt" -lt 10 ]; then
    sleep 3
  fi
done
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "Isolated main analyzer health returned HTTP ${HEALTH_STATUS}" >&2
  sed -n '1,120p' "$HEALTH_PATH" >&2
  exit 1
fi
node - "$HEALTH_PATH" "$ROOT_DIR/workers/search/src/generated-analyzer/descriptor.json" <<'NODE'
const { readFileSync } = require('node:fs')
const health = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const descriptor = JSON.parse(readFileSync(process.argv[3], 'utf8'))
if (!health.ok
  || health.topology !== 'durable-object'
  || health.compatibility?.artifactVersionId !== descriptor.artifactVersionId
  || health.compatibility?.objectName !== descriptor.objectName
  || health.compatibility?.wasmModuleTag !== '[object WebAssembly.Module]'
  || health.query?.tokenizerGeneration !== descriptor.tokenizerGeneration
  || !health.query?.morphTerms?.includes('들어가')) {
  throw new Error('Isolated main analyzer health did not satisfy the contract')
}
console.log(JSON.stringify({ event: 'isolated-main-health', ...health }))
NODE

SSR_STATUS="$(curl --silent --show-error \
  --output "$SSR_PATH" \
  --write-out '%{http_code}' \
  "${WORKER_URL}/")"
if [ "$SSR_STATUS" -lt 200 ] || [ "$SSR_STATUS" -ge 500 ]; then
  echo "Isolated main Nitro fetch returned HTTP ${SSR_STATUS}" >&2
  exit 1
fi

INSTALL_STATUS_HTTP="$(curl --silent --show-error \
  --output "$INSTALL_STATUS_PATH" \
  --write-out '%{http_code}' \
  "${WORKER_URL}/api/system/install/status")"
if [ "$INSTALL_STATUS_HTTP" != "200" ]; then
  echo "Isolated main D1-bound Nitro status returned HTTP ${INSTALL_STATUS_HTTP}" >&2
  sed -n '1,120p' "$INSTALL_STATUS_PATH" >&2
  exit 1
fi
node - "$INSTALL_STATUS_PATH" <<'NODE'
const { readFileSync } = require('node:fs')
const status = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (status.runtime !== 'cloudflare'
  || !Array.isArray(status.missingBindings)
  || status.missingBindings.length !== 0
  || !Array.isArray(status.missingTables)
  || status.missingTables.length !== 0) {
  throw new Error('D1-bound Nitro install status did not observe the isolated Cloudflare bindings and migrations')
}
NODE

run_wrangler d1 execute DB --remote --config "$CONFIG_PATH" --json \
  --command "SELECT name FROM sqlite_master WHERE name IN ('full_text_fts','full_text_job','full_text_control') ORDER BY name;"
run_wrangler queues info "$QUEUE_NAME" --config "$CONFIG_PATH"

UPLOAD_METRICS="$(printf '%s' "$DEPLOY_OUTPUT" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const upload = input.match(/Total Upload:\s*([\d.]+\s*KiB)\s*\/\s*gzip:\s*([\d.]+\s*KiB)/u)
  const startup = input.match(/Worker Startup Time:\s*(\d+)\s*ms/u)
  process.stdout.write(JSON.stringify({
    rawUpload: upload?.[1] ?? null,
    gzipUpload: upload?.[2] ?? null,
    startupMs: startup ? Number(startup[1]) : null
  }))
})
')"

cleanup_remote

set +e
run_wrangler deployments list --name "$WORKER_NAME" >/dev/null 2>&1
WORKER_VERIFY=$?
run_wrangler d1 info "$D1_NAME" >/dev/null 2>&1
D1_VERIFY=$?
run_wrangler queues info "$QUEUE_NAME" >/dev/null 2>&1
QUEUE_VERIFY=$?
run_wrangler r2 bucket info "$R2_NAME" >/dev/null 2>&1
R2_VERIFY=$?
set -e
if [ "$WORKER_VERIFY" -eq 0 ] \
  || [ "$D1_VERIFY" -eq 0 ] \
  || [ "$QUEUE_VERIFY" -eq 0 ] \
  || [ "$R2_VERIFY" -eq 0 ]; then
  echo 'At least one isolated validation resource still exists after cleanup.' >&2
  exit 1
fi

node -e '
console.log(JSON.stringify({
  ok: true,
  validation: "isolated-durable-search",
  worker: process.argv[1],
  workerUrl: process.argv[2],
  resources: {
    d1: process.argv[3],
    r2: process.argv[4],
    queue: process.argv[5]
  },
  upload: JSON.parse(process.argv[6]),
  http: {
    analyzerHealth: Number(process.argv[7]),
    nitroFetch: Number(process.argv[8]),
    nitroD1Status: Number(process.argv[9])
  },
  cleanupVerified: true
}))
' "$WORKER_NAME" "$WORKER_URL" "$D1_NAME" "$R2_NAME" "$QUEUE_NAME" \
  "$UPLOAD_METRICS" "$HEALTH_STATUS" "$SSR_STATUS" "$INSTALL_STATUS_HTTP"
