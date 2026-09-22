import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

async function collectVueFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectVueFiles(path) : entry.name.endsWith('.vue') ? [path] : []
  }))

  return files.flat()
}

function projectPath(path: string) {
  return relative(projectRoot, path).split(sep).join('/')
}

async function readProjectFile(path: string) {
  return await readFile(join(projectRoot, path), 'utf8')
}

describe('Desk card usage', () => {
  it('reserves cards for standalone widgets and collection items', async () => {
    const files = await Promise.all([
      collectVueFiles(join(projectRoot, 'app/pages/_desk')),
      collectVueFiles(join(projectRoot, 'app/components'))
    ])
    const cards: Record<string, number> = {}

    for (const file of files.flat()) {
      const source = await readFile(file, 'utf8')
      const count = source.match(/<UCard(?:\s|>)/g)?.length ?? 0
      if (count) cards[projectPath(file)] = count
    }

    expect(cards).toEqual({
      'app/components/OnboardingWidget.vue': 1,
      'app/pages/_desk/assets/index.vue': 1,
      'app/pages/_desk/index.vue': 2,
      'app/pages/_desk/pages/index.vue': 1,
      'app/components/settings/MembershipPanel.vue': 1
    })
  })

  it('uses semantic groups for related Desk controls', async () => {
    const groupedFormFiles = [
      'app/components/page-editor/PageBlockInspector.vue',
      'app/components/cms/AssetPicker.vue',
      'app/components/cms/ContentForm.vue',
      'app/components/cms/ReferencePicker.vue',
      'app/pages/_desk/schemas/[schemaKey]/index.vue',
      'app/pages/_desk/schemas/[schemaKey]/settings.vue',
      'app/components/settings/AuthenticationPanel.vue'
    ]

    for (const file of groupedFormFiles) {
      const source = await readProjectFile(file)
      expect(source, file).toContain('<fieldset')
      expect(source, file).toContain('<legend')
    }
  })

  it('uses the Nuxt UI modal body and footer instead of a nested card', async () => {
    const source = await readProjectFile('app/components/cms/ReferencePicker.vue')

    expect(source).toContain('<UModal')
    expect(source).toContain('<template #body>')
    expect(source).toContain('<template #footer>')
    expect(source).not.toContain('<UCard')
  })
})
