import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = join(import.meta.dirname, '..')

async function source(path: string) {
  return await readFile(join(projectRoot, path), 'utf8')
}

describe('Desk editorial safety UI', () => {
  it('uses a shared Nuxt UI history drawer with immutable restore semantics', async () => {
    const history = await source('app/components/cms/RevisionHistorySlideover.vue')

    expect(history).toContain('<USlideover')
    expect(history).toContain('<UTimeline')
    expect(history).toContain('Restore creates a new immutable revision.')
    expect(history).toContain('body: { revision: props.currentRevision }')
    expect(history).toContain(`emit('conflict', error)`)
  })

  it('preserves local editor state when a stale content, page, or schema mutation conflicts', async () => {
    const editors = await Promise.all([
      source('app/pages/_desk/content/[schemaKey]/[id].vue'),
      source('app/pages/_desk/pages/[id].vue'),
      source('app/pages/_desk/schemas/[schemaKey]/index.vue')
    ])

    for (const editor of editors) {
      expect(editor).toContain('currentRevision')
      expect(editor).toContain('conflictDetails')
      expect(editor).toContain('A newer')
      expect(editor).toContain('Review history')
      expect(editor).toContain('Reload latest')
      expect(editor).toContain('body: { revision')
    }

    const [settings, settingsDraft] = await Promise.all([
      source('app/pages/_desk/schemas/[schemaKey]/settings.vue'),
      source('app/composables/useSchemaSettingsDraft.ts')
    ])
    expect(settings).toContain('A newer Schema draft is available')
    expect(settings).toContain('Your local presentation and search selections are preserved.')
    expect(settings).toContain('Reload latest')
    expect(settingsDraft).toContain('revision: revision.value')
    expect(settingsDraft).toContain('conflict.value')
  })

  it('creates drafts before invoking explicit publish commands', async () => {
    const contentNew = await source('app/pages/_desk/content/[schemaKey]/new.vue')
    const pageNew = await source('app/pages/_desk/pages/new.vue')

    for (const editor of [contentNew, pageNew]) {
      expect(editor).not.toContain(`status: 'published'`)
      expect(editor).toContain(`body: { revision: created.revision`)
      expect(editor).toContain('/publish`')
    }
  })

  it('gates content actions by separate permissions and exposes deleted recovery', async () => {
    const contentEdit = await source('app/pages/_desk/content/[schemaKey]/[id].vue')
    const settings = await source('app/pages/_desk/schemas/[schemaKey]/settings.vue')
    const pageList = await source('app/pages/_desk/pages/index.vue')

    for (const key of ['canWrite', 'canPublish', 'canArchive', 'canDelete']) {
      expect(contentEdit).toContain(key)
      expect(settings).toContain(key)
    }
    expect(contentEdit).toContain('/recover`')
    expect(contentEdit).toContain(':disabled="isDeleted || !canWrite"')
    expect(settings).toContain('overflow-x-auto')
    expect(pageList).toContain(`{ label: 'Deleted', value: 'deleted' }`)
  })

  it('moves guarded Schema lifecycle actions to the inventory and loads impact after action intent', async () => {
    const settings = await source('app/pages/_desk/schemas/[schemaKey]/settings.vue')
    const schemaList = await source('app/pages/_desk/schemas/index.vue')
    const schemaEditor = await source('app/pages/_desk/schemas/[schemaKey]/index.vue')

    expect(schemaList).toContain('/api/schema/list?includeInactive=1')
    expect(schemaList).toContain('session.value?.user?.role === \'admin\'')
    expect(schemaList).toContain(': \'/api/schema/list\'')
    expect(schemaList).toContain('highlight-color="warning"')
    expect(schemaEditor).toContain('/definition`')
    expect(schemaEditor).toContain('This schema is inactive')
    expect(settings).not.toContain('/lifecycle')
    expect(settings).not.toContain('Schema lifecycle')

    for (const contract of [
      '<UDropdownMenu',
      '<UBadge',
      '<UAlert',
      '<UModal',
      '<UForm',
      '<UFormField',
      '<UInput',
      'Delete empty Schema',
      'Purge Schema and content',
      'confirmation: z.string().refine',
      'openLifecycleAction(schema, \'deactivate\')',
      'openLifecycleAction(schema, \'reactivate\')',
      'await $fetch<LifecycleImpact>(`/api/schema/${schema.schemaKey}/lifecycle`)',
      '/purge`'
    ]) {
      expect(schemaList).toContain(contract)
    }
  })
})
