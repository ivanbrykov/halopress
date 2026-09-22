#!/usr/bin/env bash
set -euo pipefail

if [ "${HALOPRESS_SKIP_WRANGLER_BUILD:-}" = "1" ]; then
  echo "Skipping Wrangler build hook because HALOPRESS_SKIP_WRANGLER_BUILD=1."
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "${WORKERS_CI:-}" = "1" ] \
  && [ -f ".output/server/index.mjs" ] \
  && [ -d ".output/public" ]; then
  echo "Reusing Nuxt output produced by the Workers Builds build command."
  exit 0
fi

echo "Building Nuxt output for Cloudflare Workers..."
NUXT_IMAGE_PROVIDER="${NUXT_IMAGE_PROVIDER:-cloudflare}" pnpm build
