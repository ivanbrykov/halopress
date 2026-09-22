import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = join(import.meta.dirname, '..')

async function readProjectFile(path: string) {
  return await readFile(join(projectRoot, path), 'utf8')
}

describe('Desk product copy', () => {
  it.each([
    ['app/pages/_desk/index.vue', 'Track setup progress and jump back into your work.'],
    ['app/pages/_desk/users/index.vue', 'Control who can access your site and what they can do.'],
    ['app/pages/_desk/schemas/index.vue', 'Define the content types and fields your team can publish.'],
    ['app/pages/_desk/schemas/[schemaKey]/index.vue', 'Set up the fields editors will use, then publish your changes.'],
    ['app/pages/_desk/schemas/[schemaKey]/settings.vue', 'Configure public presentation, search behavior, and role access for this content type.'],
    ['app/pages/_desk/content/[schemaKey]/index.vue', 'Create, review, and publish entries.'],
    ['app/pages/_desk/content/[schemaKey]/new.vue', 'Add the details, then save a draft or publish.'],
    ['app/pages/_desk/assets/index.vue', 'Upload and manage files you can reuse across your site.'],
    ['app/pages/_desk/assets/[assetId].vue', 'Preview and manage this file.'],
    ['app/pages/_desk/pages/index.vue', 'Build and publish standalone pages for your site.'],
    ['app/components/settings/AuthenticationPanel.vue', 'Configure Google sign-in while keeping password access and explicit account linking.']
  ])('uses helpful guidance in %s', async (path, expected) => {
    expect(await readProjectFile(path)).toContain(expected)
  })

  it('keeps implementation terms out of top-level navigation copy', async () => {
    const sources = await Promise.all([
      readProjectFile('app/pages/_desk/schemas/index.vue'),
      readProjectFile('app/pages/_desk/assets/index.vue'),
      readProjectFile('app/pages/_desk/pages/index.vue')
    ])
    const copy = sources.join('\n')

    expect(copy).not.toContain('immutable versions')
    expect(copy).not.toContain('R2 when configured')
    expect(copy).not.toContain('built with PageEditor')
  })
})
