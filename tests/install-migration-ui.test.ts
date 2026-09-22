import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('install migration maintenance UI', () => {
  it('separates database maintenance from the first-run wizard', async () => {
    const source = await readFile(resolve(root, 'app/pages/_install.vue'), 'utf8')

    expect(source).toContain('const isMigrationRequired = computed(() => phase.value === \'migration_required\')')
    expect(source).toContain('Site maintenance')
    expect(source).toContain('This is database maintenance, not first-run setup.')
    expect(source).toContain('It does not reset the site or replace existing content.')
    expect(source).toContain('<UCard v-if="isMigrationRequired"')
    expect(source).toContain('<UCard v-else-if="submitting || showExternalInstalling"')
  })

  it('shows the correct migration command and exposes one-click migration only on Cloudflare', async () => {
    const source = await readFile(resolve(root, 'app/pages/_install.vue'), 'utf8')

    expect(source).toContain('return \'pnpm exec wrangler d1 migrations apply DB --remote\'')
    expect(source).toContain('return \'pnpm db:d1:apply:local\'')
    expect(source).toContain('return \'pnpm db:migrate\'')
    expect(source).toContain('commandCopied ? \'i-lucide-check\' : \'i-lucide-copy\'')
    expect(source).toContain('@click="copyRemediationCommand"')
    expect(source).toContain('typeof navigator.clipboard.writeText !== \'function\'')
    expect(source).toContain('await navigator.clipboard.writeText(remediationCommand.value)')
    expect(source).toContain('<div v-if="isCloudflareRuntime"')
    expect(source).toContain('onMounted(() => {')
    expect(source).toContain('void migrateCloudflareDatabase()')
    expect(source).toContain('if (installStatus.value?.ready) await navigateTo(\'/\')')
    expect(source).toContain('Updating the database automatically')
    expect(source).toContain('v-if="migrationError"')
    expect(source).toContain('@click="migrateCloudflareDatabase"')
    expect(source).toContain('await $fetch(\'/api/system/install/migrate\'')
  })
})
