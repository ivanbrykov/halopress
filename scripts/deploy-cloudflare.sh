#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

AUTH_SECRET_NAME="NUXT_AUTH_SECRET"
D1_DATABASE="${HALOPRESS_D1_DATABASE:-DB}"
PREPARE_ARGS=()
SECRET_SCOPE_ARGS=()
DEPLOY_ARGS=()
DRY_RUN=0
MAIN_CONFIG_PATH=""
MAIN_WORKER_NAME_OVERRIDE=""
WRANGLER_ENV=""
USER_SECRETS_FILE=""
GENERATED_SECRETS_DIR=""
GENERATED_SECRETS_FILE=""
SECRET_LIST_STDERR_FILE=""
TOPOLOGY_BACKUP_DIR=""
TOPOLOGY_MAIN_CONFIG_PATH=""
ACTIVATION_RESPONSE_FILE=""
LEGACY_CONSUMER_DETACHED=0
QUEUE_SCOPE_ARGS=()

cleanup_generated_secrets() {
  local exit_status=$?
  if [ "$LEGACY_CONSUMER_DETACHED" -eq 1 ]; then
    if ! restore_legacy_consumer; then
      echo "WARNING: failed to restore legacy Queue consumer ${LEGACY_SEARCH_WORKER_NAME}; manual recovery is required." >&2
    fi
  fi
  if [ -n "$TOPOLOGY_BACKUP_DIR" ]; then
    cp "$TOPOLOGY_BACKUP_DIR/main.jsonc" "$TOPOLOGY_MAIN_CONFIG_PATH"
    rm -rf -- "$TOPOLOGY_BACKUP_DIR"
  fi
  if [ -n "$GENERATED_SECRETS_DIR" ]; then
    rm -rf -- "$GENERATED_SECRETS_DIR"
  fi
  if [ -n "$SECRET_LIST_STDERR_FILE" ]; then
    rm -f -- "$SECRET_LIST_STDERR_FILE"
  fi
  if [ -n "$ACTIVATION_RESPONSE_FILE" ]; then
    rm -f -- "$ACTIVATION_RESPONSE_FILE"
  fi
  return "$exit_status"
}

run_wrangler() {
  if [ -n "${HALOPRESS_WRANGLER_BIN:-}" ]; then
    "${HALOPRESS_WRANGLER_BIN}" "$@"
  else
    pnpm --silent wrangler "$@"
  fi
}

is_missing_consumer_error() {
  local output="$1"
  [[ "$output" == *'not found'* \
    || "$output" == *'does not exist'* \
    || "$output" == *'not a consumer'* \
    || "$output" == *'No consumer'* \
    || "$output" == *'No worker consumer'* ]]
}

restore_legacy_consumer() {
  local main_remove_output
  local main_remove_exit
  local legacy_add_output
  local legacy_add_exit

  set +e
  main_remove_output="$(run_wrangler queues consumer remove \
    "$SEARCH_QUEUE_NAME" \
    "$MAIN_WORKER_NAME" \
    "${QUEUE_SCOPE_ARGS[@]}" 2>&1)"
  main_remove_exit=$?
  set -e
  if [ "$main_remove_exit" -ne 0 ] && ! is_missing_consumer_error "$main_remove_output"; then
    printf '%s\n' "$main_remove_output" >&2
  fi

  set +e
  legacy_add_output="$(run_wrangler queues consumer add \
    "$SEARCH_QUEUE_NAME" \
    "$LEGACY_SEARCH_WORKER_NAME" \
    --batch-size 1 \
    --batch-timeout 5 \
    --message-retries 5 \
    --max-concurrency 2 \
    "${QUEUE_SCOPE_ARGS[@]}" 2>&1)"
  legacy_add_exit=$?
  set -e
  if [ "$legacy_add_exit" -ne 0 ]; then
    printf '%s\n' "$legacy_add_output" >&2
    return "$legacy_add_exit"
  fi
  LEGACY_CONSUMER_DETACHED=0
  echo "Restored legacy search Worker ${LEGACY_SEARCH_WORKER_NAME} as Queue consumer after an incomplete main deployment." >&2
}

trap cleanup_generated_secrets EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

parse_secret_list_status() {
  node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  try {
    const normalized = input.replace(
      /^(?:[^\S\r\n]*WARN[^\S\r\n]+Unsupported engine:[^\r\n]*(?:\r?\n|$))+/,
      ""
    )
    const secrets = JSON.parse(normalized)
    if (!Array.isArray(secrets)) throw new Error("expected an array")
    const present = secrets.some(secret => secret && secret.name === process.argv[1])
    process.stdout.write(present ? "present" : "missing")
  } catch {
    process.exitCode = 1
  }
})
' "$AUTH_SECRET_NAME"
}

activation_response_satisfies_contract() {
  local response_file="$1"

  node - "$response_file" \
    "$ROOT_DIR/workers/search/src/generated-analyzer/descriptor.json" <<'NODE'
const { readFileSync } = require('node:fs')

try {
  const response = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const descriptor = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  if (!response.ok
    || response.topology !== 'durable-object'
    || response.compatibility?.artifactVersionId !== descriptor.artifactVersionId
    || response.compatibility?.objectName !== descriptor.objectName
    || response.compatibility?.wasmModuleTag !== '[object WebAssembly.Module]'
    || response.query?.tokenizerGeneration !== descriptor.tokenizerGeneration
    || !Array.isArray(response.query?.morphTerms)) {
    process.exitCode = 1
  }
} catch {
  process.exitCode = 1
}
NODE
}

inspect_user_secrets_file() {
  node -e '
const { readFileSync } = require("node:fs")
const { extname } = require("node:path")

try {
  const file = process.argv[1]
  const secretName = process.argv[2]
  const contents = readFileSync(file, "utf8")
  let value

  if (extname(file).toLowerCase() === ".json" || contents.trimStart().startsWith("{")) {
    const secrets = JSON.parse(contents)
    value = secrets && typeof secrets === "object" ? secrets[secretName] : undefined
  } else {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match || match[1] !== secretName) continue
      let candidate = match[2].trim()
      if ((candidate.startsWith("\"") && candidate.endsWith("\""))
        || (candidate.startsWith("\x27") && candidate.endsWith("\x27"))) {
        candidate = candidate.slice(1, -1)
      } else {
        candidate = candidate.replace(/\s+#.*$/, "").trim()
      }
      value = candidate
    }
  }

  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) {
    process.stdout.write("missing")
  } else {
    process.stdout.write(Buffer.byteLength(normalized, "utf8") >= 24 ? "valid" : "weak")
  }
} catch {
  process.exitCode = 1
}
' "$USER_SECRETS_FILE" "$AUTH_SECRET_NAME"
}

create_generated_secrets_file() {
  local temp_root="${TMPDIR:-/tmp}"
  local secret_value

  GENERATED_SECRETS_DIR="$(mktemp -d "${temp_root%/}/halopress-secrets.XXXXXX")"
  chmod 700 "$GENERATED_SECRETS_DIR"
  GENERATED_SECRETS_FILE="$GENERATED_SECRETS_DIR/.env"
  secret_value="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  (umask 077 && printf '%s=%s\n' "$AUTH_SECRET_NAME" "$secret_value" > "$GENERATED_SECRETS_FILE")
  unset secret_value
}

if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
  D1_DATABASE="$1"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --dry-run|--dry-run=true)
      DRY_RUN=1
      PREPARE_ARGS+=("$1")
      DEPLOY_ARGS+=("$1")
      shift
      ;;
    --topology|--topology=*)
      echo 'Search topology selection was removed; HaloPress now deploys the Durable Object topology only.' >&2
      exit 1
      ;;
    --env|-e|--config|-c)
      flag="$1"
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for ${flag}" >&2
        exit 1
      fi
      PREPARE_ARGS+=("$flag" "$1")
      SECRET_SCOPE_ARGS+=("$flag" "$1")
      DEPLOY_ARGS+=("$flag" "$1")
      if [ "$flag" = "--config" ] || [ "$flag" = "-c" ]; then
        MAIN_CONFIG_PATH="$1"
      else
        WRANGLER_ENV="$1"
      fi
      shift
      ;;
    --env-file)
      flag="$1"
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for ${flag}" >&2
        exit 1
      fi
      PREPARE_ARGS+=("$flag" "$1")
      DEPLOY_ARGS+=("$flag" "$1")
      shift
      ;;
    --name)
      flag="$1"
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for ${flag}" >&2
        exit 1
      fi
      SECRET_SCOPE_ARGS+=("$flag" "$1")
      DEPLOY_ARGS+=("$flag" "$1")
      MAIN_WORKER_NAME_OVERRIDE="$1"
      shift
      ;;
    --secrets-file)
      flag="$1"
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for ${flag}" >&2
        exit 1
      fi
      if [ -n "$USER_SECRETS_FILE" ]; then
        echo 'Only one --secrets-file can be supplied.' >&2
        exit 1
      fi
      USER_SECRETS_FILE="$1"
      DEPLOY_ARGS+=("$flag" "$1")
      shift
      ;;
    --env=*|-e=*|--config=*|-c=*)
      PREPARE_ARGS+=("$1")
      SECRET_SCOPE_ARGS+=("$1")
      DEPLOY_ARGS+=("$1")
      if [[ "$1" == --config=* ]] || [[ "$1" == -c=* ]]; then
        MAIN_CONFIG_PATH="${1#*=}"
      else
        WRANGLER_ENV="${1#*=}"
      fi
      shift
      ;;
    --env-file=*)
      PREPARE_ARGS+=("$1")
      DEPLOY_ARGS+=("$1")
      shift
      ;;
    --name=*)
      SECRET_SCOPE_ARGS+=("$1")
      DEPLOY_ARGS+=("$1")
      MAIN_WORKER_NAME_OVERRIDE="${1#*=}"
      shift
      ;;
    --secrets-file=*)
      if [ -n "$USER_SECRETS_FILE" ]; then
        echo 'Only one --secrets-file can be supplied.' >&2
        exit 1
      fi
      USER_SECRETS_FILE="${1#*=}"
      if [ -z "$USER_SECRETS_FILE" ]; then
        echo 'Missing value for --secrets-file' >&2
        exit 1
      fi
      DEPLOY_ARGS+=("$1")
      shift
      ;;
    *)
      DEPLOY_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ -z "$MAIN_CONFIG_PATH" ]; then
  MAIN_CONFIG_PATH="$ROOT_DIR/wrangler.jsonc"
fi

DEPLOY_HAS_CONFIG=0
for argument in "${DEPLOY_ARGS[@]}"; do
  case "$argument" in
    --config|-c|--config=*|-c=*)
      DEPLOY_HAS_CONFIG=1
      break
      ;;
  esac
done
if [ "$DEPLOY_HAS_CONFIG" -eq 0 ]; then
  DEPLOY_ARGS=(--config "$MAIN_CONFIG_PATH" "${DEPLOY_ARGS[@]}")
fi

if [ "$DRY_RUN" -eq 1 ]; then
  topology_backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/halopress-topology.XXXXXX")"
  cp "$MAIN_CONFIG_PATH" "$topology_backup_dir/main.jsonc"
  TOPOLOGY_MAIN_CONFIG_PATH="$MAIN_CONFIG_PATH"
  TOPOLOGY_BACKUP_DIR="$topology_backup_dir"
fi

TOPOLOGY_ARGS=(--config "$MAIN_CONFIG_PATH")
if [ -n "$WRANGLER_ENV" ]; then
  TOPOLOGY_ARGS+=(--env "$WRANGLER_ENV")
fi
if [ -n "$MAIN_WORKER_NAME_OVERRIDE" ]; then
  TOPOLOGY_ARGS+=(--main-name "$MAIN_WORKER_NAME_OVERRIDE")
fi
if [ -n "${HALOPRESS_LEGACY_SEARCH_WORKER_NAME:-}" ]; then
  TOPOLOGY_ARGS+=(--legacy-search-worker-name "$HALOPRESS_LEGACY_SEARCH_WORKER_NAME")
fi
if [ -n "${HALOPRESS_SEARCH_QUEUE_NAME:-}" ]; then
  TOPOLOGY_ARGS+=(--search-queue-name "$HALOPRESS_SEARCH_QUEUE_NAME")
fi
TOPOLOGY_PLAN_JSON="$(node scripts/prepare-cloudflare-search-topology.mjs "${TOPOLOGY_ARGS[@]}" --plan)"
node -e '
const result = JSON.parse(process.argv[1])
console.log("Cloudflare search resource plan:")
console.log(JSON.stringify(result.plan, null, 2))
' "$TOPOLOGY_PLAN_JSON"
TOPOLOGY_JSON="$(node scripts/prepare-cloudflare-search-topology.mjs "${TOPOLOGY_ARGS[@]}")"
MAIN_WORKER_NAME="$(node -e '
const topology = JSON.parse(process.argv[1])
if (!topology.mainName) process.exit(1)
process.stdout.write(topology.mainName)
' "$TOPOLOGY_JSON")"
LEGACY_SEARCH_WORKER_NAME="$(node -e '
const topology = JSON.parse(process.argv[1])
if (!topology.legacySearchWorkerName) process.exit(1)
process.stdout.write(topology.legacySearchWorkerName)
' "$TOPOLOGY_JSON")"
SEARCH_QUEUE_NAME="$(node -e '
const topology = JSON.parse(process.argv[1])
if (!topology.searchQueueName) process.exit(1)
process.stdout.write(topology.searchQueueName)
' "$TOPOLOGY_JSON")"

USER_SECRET_STATUS="missing"
if [ -n "$USER_SECRETS_FILE" ]; then
  if ! USER_SECRET_STATUS="$(inspect_user_secrets_file)"; then
    echo 'Could not read the supplied --secrets-file; refusing to deploy.' >&2
    exit 1
  fi
  if [ "$USER_SECRET_STATUS" = "weak" ]; then
    echo "${AUTH_SECRET_NAME} in --secrets-file must be at least 24 UTF-8 bytes." >&2
    echo 'Use 32 random bytes; for example, generate a value with `openssl rand -hex 32`.' >&2
    exit 1
  fi
fi

SECRET_STATUS="missing"
if [ "$DRY_RUN" -eq 0 ]; then
  SECRET_LIST_STDERR_FILE="$(mktemp "${TMPDIR:-/tmp}/halopress-secret-list.XXXXXX")"
  chmod 600 "$SECRET_LIST_STDERR_FILE"
  set +e
  SECRET_LIST_OUTPUT="$(run_wrangler secret list --format json "${SECRET_SCOPE_ARGS[@]}" 2> "$SECRET_LIST_STDERR_FILE")"
  SECRET_LIST_EXIT=$?
  set -e
  SECRET_LIST_ERROR="$(< "$SECRET_LIST_STDERR_FILE")"
  rm -f -- "$SECRET_LIST_STDERR_FILE"
  SECRET_LIST_STDERR_FILE=""

  if [ "$SECRET_LIST_EXIT" -eq 0 ]; then
    if ! SECRET_STATUS="$(printf '%s' "$SECRET_LIST_OUTPUT" | parse_secret_list_status)"; then
      echo 'Could not parse the Wrangler secret list response; refusing to deploy.' >&2
      exit 1
    fi
  elif [[ "$SECRET_LIST_ERROR" == *' not found.'* \
    && "$SECRET_LIST_ERROR" == *'If this is a new Worker, run `wrangler deploy` first'* ]]; then
    SECRET_STATUS="missing"
  else
    if [ -n "$SECRET_LIST_OUTPUT" ]; then
      printf '%s\n' "$SECRET_LIST_OUTPUT" >&2
    fi
    if [ -n "$SECRET_LIST_ERROR" ]; then
      printf '%s\n' "$SECRET_LIST_ERROR" >&2
    fi
    exit "$SECRET_LIST_EXIT"
  fi

  if [ "$SECRET_STATUS" = "missing" ] && [ -n "$USER_SECRETS_FILE" ]; then
    if [ "$USER_SECRET_STATUS" != "valid" ]; then
      echo "The supplied --secrets-file must contain ${AUTH_SECRET_NAME} with at least 24 UTF-8 bytes for a new Worker or a Worker that does not have it yet." >&2
      echo 'Remove --secrets-file to let Halopress generate 32 random bytes, or add a strong secret to that file.' >&2
      exit 1
    fi
  fi
fi

node scripts/prepare-cloudflare-d1.mjs \
  "$D1_DATABASE" \
  "${PREPARE_ARGS[@]}"

if [ "$DRY_RUN" -eq 0 ] && [ "$SECRET_STATUS" = "missing" ] && [ -z "$USER_SECRETS_FILE" ]; then
  create_generated_secrets_file
  DEPLOY_ARGS+=(--secrets-file "$GENERATED_SECRETS_FILE")
  echo "Generated ${AUTH_SECRET_NAME} for this Worker; the value was not printed and will be preserved on later deploys."
fi

if [ "$DRY_RUN" -eq 0 ]; then
  QUEUE_SCOPE_ARGS=(--config "$MAIN_CONFIG_PATH")
  if [ -n "$WRANGLER_ENV" ]; then
    QUEUE_SCOPE_ARGS+=(--env "$WRANGLER_ENV")
  fi
  if ! run_wrangler queues info "$SEARCH_QUEUE_NAME" "${QUEUE_SCOPE_ARGS[@]}"; then
    echo "Creating Cloudflare Queue ${SEARCH_QUEUE_NAME}..."
    run_wrangler queues create "$SEARCH_QUEUE_NAME" "${QUEUE_SCOPE_ARGS[@]}"
  fi
fi

pnpm --filter @halopress/search-worker exec tsx scripts/prepare-assets.mjs
if [ "$DRY_RUN" -eq 0 ] && [ -z "${WORKERS_CI:-}" ]; then
  echo 'Running deployed real-Garu Durable Object compatibility gate...'
  DURABLE_COMPATIBILITY_JSON="$(bash scripts/preflight-cloudflare-durable-search.sh "$MAIN_WORKER_NAME")"
  node -e '
const result = JSON.parse(process.argv[1])
console.log(JSON.stringify({
  event: "halopress.search.durable_compatibility",
  artifactVersionId: result.descriptor?.artifactVersionId,
  wasmModuleTag: result.compatibility?.wasmModuleTag,
  coldAndFixturesMs: result.timings?.coldAndFixturesMs,
  warmFixturesMs: result.timings?.warmFixturesMs,
  cleanupVerified: result.cleanupVerified
}))
' "$DURABLE_COMPATIBILITY_JSON"
elif [ "$DRY_RUN" -eq 0 ]; then
  echo 'Workers Builds pins deploys to the connected main Worker; the post-deploy main activation gate will validate real Garu and WebAssembly compatibility.'
else
  echo '[dry-run] Skipping the remote Durable Object compatibility deployment.'
fi

if [ "$DRY_RUN" -eq 0 ]; then
  set +e
  CONSUMER_REMOVE_OUTPUT="$(run_wrangler queues consumer remove \
    "$SEARCH_QUEUE_NAME" \
    "$LEGACY_SEARCH_WORKER_NAME" \
    "${QUEUE_SCOPE_ARGS[@]}" 2>&1)"
  CONSUMER_REMOVE_EXIT=$?
  set -e
  if [ "$CONSUMER_REMOVE_EXIT" -ne 0 ] \
    && ! is_missing_consumer_error "$CONSUMER_REMOVE_OUTPUT"; then
    printf '%s\n' "$CONSUMER_REMOVE_OUTPUT" >&2
    exit "$CONSUMER_REMOVE_EXIT"
  fi
  if [ "$CONSUMER_REMOVE_EXIT" -eq 0 ]; then
    LEGACY_CONSUMER_DETACHED=1
    echo "Detached legacy search Worker ${LEGACY_SEARCH_WORKER_NAME} immediately before the Queue consumer handoff."
  else
    echo "Legacy search Worker ${LEGACY_SEARCH_WORKER_NAME} was not a consumer of Queue ${SEARCH_QUEUE_NAME}."
  fi
fi

echo 'Deploying main Cloudflare Worker with Durable Object search orchestration...'
set +e
MAIN_DEPLOY_OUTPUT="$(run_wrangler deploy "${DEPLOY_ARGS[@]}" 2>&1)"
MAIN_DEPLOY_EXIT=$?
set -e
printf '%s\n' "$MAIN_DEPLOY_OUTPUT"
if [ "$MAIN_DEPLOY_EXIT" -ne 0 ]; then
  exit "$MAIN_DEPLOY_EXIT"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  MAIN_ACTIVATION_URL="${HALOPRESS_ACTIVATION_URL:-}"
  if [ -z "$MAIN_ACTIVATION_URL" ]; then
    MAIN_ACTIVATION_URL="$(printf '%s' "$MAIN_DEPLOY_OUTPUT" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const matches = input.match(/https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?/giu) || []
  const url = matches.at(-1)
  if (!url) process.exit(1)
  process.stdout.write(url.replace(/\/+$/, ""))
})
')"
  fi
  ACTIVATION_RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/halopress-do-activation.XXXXXX")"
  ACTIVATION_STATUS=""
  ACTIVATION_CONTRACT_VALID=0
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    ACTIVATION_STATUS="$(curl --silent --show-error \
      --output "$ACTIVATION_RESPONSE_FILE" \
      --write-out '%{http_code}' \
      "${MAIN_ACTIVATION_URL}/__halopress/search/analyzer-health" || true)"
    if [ "$ACTIVATION_STATUS" = "200" ] \
      && activation_response_satisfies_contract "$ACTIVATION_RESPONSE_FILE"; then
      ACTIVATION_CONTRACT_VALID=1
      break
    fi
    if [ "$attempt" -lt 10 ]; then
      sleep "${HALOPRESS_ACTIVATION_RETRY_SECONDS:-3}"
    fi
  done
  if [ "$ACTIVATION_CONTRACT_VALID" -ne 1 ]; then
    echo "Main Worker Durable Object activation gate returned HTTP ${ACTIVATION_STATUS} without satisfying the analyzer contract; the legacy Worker was not deleted." >&2
    sed -n '1,120p' "$ACTIVATION_RESPONSE_FILE" >&2
    rm -f -- "$ACTIVATION_RESPONSE_FILE"
    exit 1
  fi
  rm -f -- "$ACTIVATION_RESPONSE_FILE"
  ACTIVATION_RESPONSE_FILE=""
  LEGACY_CONSUMER_DETACHED=0
  echo "Main Worker Durable Object activation gate passed at ${MAIN_ACTIVATION_URL}."

  set +e
  DELETE_OUTPUT="$(run_wrangler delete \
    "$LEGACY_SEARCH_WORKER_NAME" \
    --config "$MAIN_CONFIG_PATH" \
    --force 2>&1)"
  DELETE_EXIT=$?
  set -e
  if [ "$DELETE_EXIT" -ne 0 ] \
    && [[ "$DELETE_OUTPUT" != *'not found'* ]] \
    && [[ "$DELETE_OUTPUT" != *'does not exist'* ]]; then
    printf '%s\n' "$DELETE_OUTPUT" >&2
    exit "$DELETE_EXIT"
  fi
  if [ "$DELETE_EXIT" -eq 0 ]; then
    echo "Deleted legacy search Worker ${LEGACY_SEARCH_WORKER_NAME}; D1 and Queue were preserved."
  else
    echo "Legacy search Worker ${LEGACY_SEARCH_WORKER_NAME} was not present; no deletion was needed."
  fi
fi
