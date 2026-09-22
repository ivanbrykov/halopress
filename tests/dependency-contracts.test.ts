import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { AuthHandler } from 'next-auth/core'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

async function readProjectFiles() {
  const [
    packageText,
    searchPackageText,
    lockfile,
    authPatch,
    nuxtConfig,
    deployScript,
    durablePreflightScript,
    durableValidationScript
  ] = await Promise.all([
    readFile(resolve(projectRoot, 'package.json'), 'utf8'),
    readFile(resolve(projectRoot, 'workers/search/package.json'), 'utf8'),
    readFile(resolve(projectRoot, 'pnpm-lock.yaml'), 'utf8'),
    readFile(resolve(projectRoot, 'patches/next-auth@4.24.14.patch'), 'utf8'),
    readFile(resolve(projectRoot, 'nuxt.config.ts'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts/deploy-cloudflare.sh'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts/preflight-cloudflare-durable-search.sh'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts/validate-cloudflare-durable-search.sh'), 'utf8')
  ])

  return {
    packageJson: JSON.parse(packageText),
    searchPackageJson: JSON.parse(searchPackageText),
    lockfile,
    authPatch,
    nuxtConfig,
    deployScript,
    durablePreflightScript,
    durableValidationScript
  }
}

describe('dependency security contracts', () => {
  it('runs analyzer asset preparation through a Node 22-compatible TypeScript loader', async () => {
    const {
      searchPackageJson,
      lockfile,
      deployScript,
      durablePreflightScript,
      durableValidationScript
    } = await readProjectFiles()
    const deploymentScripts = [
      deployScript,
      durablePreflightScript,
      durableValidationScript
    ]

    expect(searchPackageJson.scripts).toMatchObject({
      build: 'tsx scripts/prepare-assets.mjs',
      test: 'tsx scripts/prepare-assets.mjs && vitest run',
      typecheck: 'tsx scripts/prepare-assets.mjs && tsc --noEmit -p tsconfig.json'
    })
    expect(searchPackageJson.devDependencies.tsx).toBe('^4.23.1')
    expect(lockfile).toContain('workers/search:\n')
    expect(lockfile).toContain('      tsx:\n        specifier: ^4.23.1\n        version: 4.23.1')
    for (const script of deploymentScripts) {
      expect(script).toContain('pnpm --filter @halopress/search-worker exec tsx scripts/prepare-assets.mjs')
      expect(script).not.toContain('node workers/search/scripts/prepare-assets.mjs')
    }
  })

  it('keeps the patched Sidebase Auth.js bridge exact and removes the Next.js peer tree', async () => {
    const { packageJson, lockfile, authPatch } = await readProjectFiles()

    expect(packageJson.dependencies['@sidebase/nuxt-auth']).toBe('1.3.1')
    expect(packageJson.dependencies['next-auth']).toBe('4.24.14')
    expect(packageJson.pnpm.patchedDependencies['next-auth@4.24.14']).toBe('patches/next-auth@4.24.14.patch')
    expect(packageJson.pnpm.peerDependencyRules.allowedVersions).toEqual({
      '@sidebase/nuxt-auth@1.3.1>next-auth': '4.24.14'
    })
    expect(packageJson.pnpm.overrides).toMatchObject({
      '@esbuild-kit/core-utils>esbuild': '0.25.12',
      '@eslint/config-inspector>esbuild': '0.28.1',
      '@mapbox/node-pre-gyp>tar': '7.5.16',
      'anymatch>picomatch': '2.3.2',
      'archiver-utils>lodash': '4.18.0',
      'fontless>esbuild': '0.28.1',
      'glob@10>minimatch': '9.0.7',
      'micromatch>picomatch': '2.3.2',
      'minimatch@5>brace-expansion': '2.0.3',
      'minimatch@9>brace-expansion': '2.0.3',
      'next-auth@4.24.14>next': '-',
      'next-auth@4.24.14>react': '-',
      'next-auth@4.24.14>react-dom': '-',
      'next-auth@4.24.14>uuid': '11.1.1',
      'readdir-glob>minimatch': '5.1.8'
    })
    expect(authPatch).toContain('"./core"')
    expect(AuthHandler).toBeTypeOf('function')
    expect(lockfile).not.toMatch(/^ {2}next@/m)
    expect(lockfile).not.toMatch(/next-auth@4\.24\.14[^\n]*\(next@/)
  })

  it('keeps every Tiptap package on its aligned release line', async () => {
    const { packageJson, lockfile } = await readProjectFiles()
    const directEntries = Object.entries(packageJson.dependencies as Record<string, string>)
      .filter(([name]) => name.startsWith('@tiptap/'))
    const ordinaryDirectVersions = new Set(
      directEntries.filter(([name]) => name !== '@tiptap/y-tiptap').map(([, version]) => version)
    )

    expect([...ordinaryDirectVersions]).toEqual(['3.27.3'])
    expect(packageJson.dependencies['@tiptap/y-tiptap']).toBe('3.0.6')

    const overrideEntries = Object.entries(packageJson.pnpm.overrides as Record<string, string>)
      .filter(([name]) => name.startsWith('@tiptap/'))
    expect(overrideEntries.filter(([name]) => name !== '@tiptap/y-tiptap').every(([, version]) => version === '3.27.3')).toBe(true)
    expect(packageJson.pnpm.overrides['@tiptap/y-tiptap']).toBe('3.0.6')
    expect(lockfile).not.toMatch(/^ {2}'@tiptap\/[^']+@3\.18\.0/m)
    expect(lockfile).not.toMatch(/^ {2}(markdown-it|linkify-it)@/m)
  })

  it('keeps the validated Nuxt UI and Nuxt release contracts', async () => {
    const { packageJson, lockfile } = await readProjectFiles()

    expect(packageJson.engines.node).toBe('^22.19.0 || >=24.11.0 <25')
    expect(packageJson.dependencies['@nuxt/ui']).toBe('^4.10.0')
    expect(packageJson.dependencies.nuxt).toBe('^4.5.1')
    expect(lockfile).toContain('\'@nuxt/ui\':\n        specifier: ^4.10.0\n        version: 4.10.0')
    expect(lockfile).toContain('nuxt:\n        specifier: ^4.5.1\n        version: 4.5.1')
  })

  it('pre-bundles the Nuxt UI ProseMirror graph as a single instance', async () => {
    const { nuxtConfig } = await readProjectFiles()
    const optimizedDependencies = [
      'prosemirror-state',
      'prosemirror-transform',
      'prosemirror-model',
      'prosemirror-view',
      'prosemirror-gapcursor'
    ]

    for (const dependency of optimizedDependencies) {
      expect(nuxtConfig).toContain(`'@nuxt/ui > ${dependency}'`)
    }
    expect(nuxtConfig).not.toMatch(/^\s*'prosemirror-(?:state|transform|model|view|gapcursor)'/m)
  })

  it('preserves Nuxt runtimeConfig environment handling', async () => {
    const { nuxtConfig } = await readProjectFiles()

    expect(nuxtConfig).toContain('originEnvKey: \'NUXT_AUTH_ORIGIN\'')
    expect(nuxtConfig).toContain('canonicalOrigin: \'\'')
    expect(nuxtConfig).not.toContain('process.env.AUTH_ORIGIN')
    expect(nuxtConfig).not.toContain('process.env.NUXT_AUTH_ORIGIN')
    expect(nuxtConfig).not.toContain('process.env.NUXT_AUTH_SECRET')
    expect(nuxtConfig).not.toContain('process.env.NUXT_CANONICAL_ORIGIN')
  })
})
