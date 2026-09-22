#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -ne 1 ]; then
  echo 'Usage: preflight-cloudflare-durable-search.sh <main-worker-name>' >&2
  exit 1
fi

run_wrangler() {
  if [ -n "${HALOPRESS_WRANGLER_BIN:-}" ]; then
    "${HALOPRESS_WRANGLER_BIN}" "$@"
  else
    pnpm wrangler "$@"
  fi
}

MAIN_WORKER_NAME="$1"
CONFIG_PATH="$ROOT_DIR/workers/search/wrangler.durable-probe.jsonc"
DESCRIPTOR_PATH="$ROOT_DIR/workers/search/src/generated-analyzer/descriptor.json"
PROBE_NAME="$(node -e '
const { createHash } = require("node:crypto")
const main = process.argv[1]
const suffix = `-do-compat-${Date.now().toString(36)}-${process.pid.toString(36)}`
const candidate = `${main}${suffix}`
if (candidate.length <= 63) {
  process.stdout.write(candidate)
} else {
  const digest = createHash("sha256").update(candidate).digest("hex").slice(0, 8)
  process.stdout.write(`${main.slice(0, 63 - suffix.length - 9)}-${digest}${suffix}`)
}
' "$MAIN_WORKER_NAME")"
PROBE_CREATED=0
RESPONSE_FILE=""

cleanup_probe() {
  local cleanup_status=0
  if [ -n "$RESPONSE_FILE" ]; then
    rm -f -- "$RESPONSE_FILE"
  fi
  if [ "$PROBE_CREATED" -eq 1 ]; then
    if ! run_wrangler delete "$PROBE_NAME" --config "$CONFIG_PATH" --force >/dev/null 2>&1; then
      echo "WARNING: failed to delete isolated Durable Object compatibility Worker ${PROBE_NAME}." >&2
      cleanup_status=1
    else
      echo "Deleted isolated Durable Object compatibility Worker ${PROBE_NAME} and its isolated namespace." >&2
      PROBE_CREATED=0
    fi
  fi
  return "$cleanup_status"
}

trap cleanup_probe EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

pnpm --filter @halopress/search-worker exec tsx scripts/prepare-assets.mjs >/dev/null
echo "Deploying isolated Durable Object compatibility Worker ${PROBE_NAME}..." >&2
set +e
DEPLOY_OUTPUT="$(run_wrangler deploy --config "$CONFIG_PATH" --name "$PROBE_NAME" 2>&1)"
DEPLOY_EXIT=$?
set -e
printf '%s\n' "$DEPLOY_OUTPUT" >&2
if [ "$DEPLOY_EXIT" -ne 0 ]; then
  exit "$DEPLOY_EXIT"
fi
PROBE_CREATED=1
PROBE_URL="$(printf '%s' "$DEPLOY_OUTPUT" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const matches = input.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/giu) || []
  const url = matches.at(-1)
  if (!url) process.exit(1)
  process.stdout.write(url)
})
')"

RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/halopress-do-compat.XXXXXX")"
HTTP_STATUS=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  HTTP_STATUS="$(curl --silent --show-error \
    --output "$RESPONSE_FILE" \
    --write-out '%{http_code}' \
    "${PROBE_URL}/compatibility" || true)"
  if [ "$HTTP_STATUS" = "200" ]; then
    break
  fi
  if [ "$attempt" -lt 10 ]; then
    sleep 3
  fi
done
if [ "$HTTP_STATUS" != "200" ]; then
  echo "Durable Object compatibility probe returned HTTP ${HTTP_STATUS}:" >&2
  sed -n '1,120p' "$RESPONSE_FILE" >&2
  exit 1
fi

VALIDATED_JSON="$(node - "$RESPONSE_FILE" "$DESCRIPTOR_PATH" "$PROBE_NAME" "$PROBE_URL" <<'NODE'
const { readFileSync } = require('node:fs')
const response = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const descriptor = JSON.parse(readFileSync(process.argv[3], 'utf8'))
if (!response.ok
  || response.compatibility?.wasmModuleTag !== '[object WebAssembly.Module]'
  || response.compatibility?.modelByteLength !== descriptor.modelBytes
  || response.compatibility?.artifactVersionId !== descriptor.artifactVersionId
  || response.compatibility?.objectName !== descriptor.objectName
  || response.compatibility?.tokenizer?.tokenizerGeneration !== descriptor.tokenizerGeneration
  || response.repeatedParity !== true
  || response.fixtures?.length !== 3
  || response.fixtures.some(fixture => !fixture.ok)) {
  throw new Error('Deployed Durable Object compatibility result did not satisfy the analyzer contract')
}
process.stdout.write(`${JSON.stringify({
  checkedAt: new Date().toISOString(),
  probeWorker: process.argv[4],
  probeUrl: process.argv[5],
  ...response
})}\n`)
NODE
)"
cleanup_probe
node -e '
const result = JSON.parse(process.argv[1])
process.stdout.write(`${JSON.stringify({ ...result, cleanupVerified: true })}\n`)
' "$VALIDATED_JSON"
