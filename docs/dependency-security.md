# Dependency security maintenance

## 2026-07-13 baseline

Before this refresh, GitHub reported 120 open Dependabot alerts: 2 critical, 50 high, 51 medium, and 17 low. Fourteen alerts were direct and 106 were transitive. `pnpm audit` reported 123 vulnerable paths (2 critical, 52 high, 51 moderate, and 18 low), while `pnpm audit --prod` reported 113 paths (2 critical, 48 high, 47 moderate, and 16 low).

The coordinated upgrade keeps Nuxt, database, Cloudflare, and editor owners on their patched compatible releases. Two narrowly scoped compatibility rules remain necessary.

## 2026-07-13 local result

After the owner upgrades, lockfile regeneration, deduplication, and scoped compatibility rules, both `pnpm audit` and `pnpm audit --prod` report no known vulnerabilities. The lockfile no longer contains Next.js, vulnerable NextAuth, mixed Tiptap 3.18 packages, `markdown-it`, or `linkify-it`. GitHub's Dependabot after-count is rechecked after the branch is pushed and GitHub processes the new dependency graph.

## Auth.js v4 compatibility bridge

- **Owners:** Sidebase and Auth.js.
- **Pinned graph:** `@sidebase/nuxt-auth@1.3.1` and `next-auth@4.24.14`.
- **Upstream status:** Sidebase still imports the framework-neutral `AuthHandler` from the private `next-auth/core` path and declares `next-auth ~4.21.1`. The compatibility break is tracked in [sidebase/nuxt-auth#514](https://github.com/sidebase/nuxt-auth/issues/514), and the supported migration away from this private v4 API remains open in [sidebase/nuxt-auth#673](https://github.com/sidebase/nuxt-auth/issues/673). The current implementation is visible in [Sidebase's v1.3.1 handler](https://github.com/sidebase/nuxt-auth/blob/v1.3.1/src/runtime/server/services/authjs/nuxtAuthHandler.ts).
- **Patch:** `patches/next-auth@4.24.14.patch` restores only the `./core` export that `next-auth@4.24.14` still ships as `core/index.js` and `core/index.d.ts`. No Auth.js runtime code is changed.
- **Peer rules:** The package-scoped pnpm overrides remove only `next-auth@4.24.14`'s unused `next`, `react`, and `react-dom` peers. HaloPress is a Nuxt application and reaches NextAuth through Sidebase's core handler, provider factories, and JWT helpers; it does not use the Next.js adapter or React client. pnpm documents both [package-scoped overrides and peer removal](https://pnpm.io/settings#overrides). The Sidebase-only `allowedVersions` entry records the tested patched v4 exception without weakening other peer checks.
- **Removal condition:** Remove the export patch and peer rules when Sidebase publishes a stable release that supports a patched NextAuth v4 export contract or completes its stable `@auth/core` migration. Re-run the auth, Nitro, and Cloudflare smoke tests before removing the exact version pins.

The private `next-auth/core` API is the residual compatibility risk. Exact versions, a patch checksum in the lockfile, dependency-contract tests, and build/runtime smoke tests prevent it from drifting silently.

## Residual transitive overrides

Direct-owner upgrades and `pnpm dedupe` remove most stale vulnerable packages. The remaining overrides are package-scoped so unrelated consumers keep their declared graphs:

| Owner path | Pinned dependency | Reason and upstream condition |
| --- | --- | --- |
| `@mapbox/node-pre-gyp` | `tar@7.5.16` | Its declared `tar ^7.4.0` range permits the patched release, but pnpm retained a vulnerable lock entry covered by [GHSA-vmf3-w455-68vh](https://github.com/advisories/GHSA-vmf3-w455-68vh). Remove after the owner lock path naturally resolves `>=7.5.16`. |
| `archiver-utils` | `lodash@4.18.0` | Its lodash range permits the patched release for [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc). Remove after Archiver's graph selects `>=4.18.0` without help. |
| `glob@10`, `readdir-glob`, `minimatch@5`, and `minimatch@9` | `minimatch@9.0.7`, `minimatch@5.1.8`, and `brace-expansion@2.0.3` | These versions stay within the owners' declared major lines and close the related minimatch and [brace-expansion advisory](https://github.com/advisories/GHSA-f886-m6hf-6m8v). Remove when Archiver/Nitro naturally resolves the same or newer patched lines. |
| `anymatch` and `micromatch` | `picomatch@2.3.2` | The owners' Picomatch 2 ranges include the fix for [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj). Remove when Unstorage/IPX and Nitro resolve `>=2.3.2` without the overrides. |
| `@eslint/config-inspector` and `fontless` | `esbuild@0.28.1` | Both owners still declare esbuild 0.27 ranges, which are entirely affected by [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). Remove when they support `>=0.28.1`; lint, Nuxt inspector setup, font loading, typecheck, and build cover the compatibility boundary. |
| `@esbuild-kit/core-utils` | `esbuild@0.25.12` | Drizzle Kit 0.31.10 still uses the deprecated loader with `esbuild ~0.18.20`, affected by [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). The override reuses Drizzle Kit's own patched esbuild line. Remove when Drizzle Kit drops `@esbuild-kit` or updates its range; validate with Drizzle config loading plus SQLite/D1 tests. |
| `next-auth@4.24.14` | `uuid@11.1.1` | NextAuth v4's `uuid ^8.3.2` range cannot reach the fix for [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Remove when Sidebase leaves NextAuth v4 or NextAuth publishes a patched dependency range; auth callback, JWT, session, and Worker smoke tests cover this boundary. |

Each override has a focused runtime or tooling check in addition to the final clean `pnpm audit` result. No override changes application feature or schema behavior.

## Tiptap alignment

- **Owners:** Tiptap and Nuxt UI.
- **Rule:** All ordinary Tiptap packages are exact-aligned at `3.27.3`; `@tiptap/y-tiptap` follows its separate release line at `3.0.6`. Direct Nuxt UI editor peers are explicit so pnpm cannot auto-install an older peer cohort.
- **Reason:** Tiptap extensions share core and ProseMirror types at runtime. HaloPress previously documented a mixed-version editor failure in [PR #6](https://github.com/comfuture/halopress/pull/6), while Nuxt UI 4.10 declares Tiptap 3 peers in its [package manifest](https://github.com/nuxt/ui/blob/v4.10.0/package.json). Shared editor profiles are also tracked by [issue #25](https://github.com/comfuture/halopress/issues/25).
- **Removal condition:** Remove explicit peer packages or overrides only after Nuxt UI and every direct editor consumer resolve one cohort without them, then pass the dependency-contract test, server-side rich-text rendering test, typecheck, and production build.
