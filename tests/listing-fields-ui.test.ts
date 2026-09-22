import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = join(import.meta.dirname, '..')

async function readProjectFile(path: string) {
  return await readFile(join(projectRoot, path), 'utf8')
}

describe('listing fields UI', () => {
  it('places user-facing listing fields after schema fields with a row preview', async () => {
    const source = await readProjectFile('app/pages/_desk/schemas/[schemaKey]/index.vue')

    expect(source).toContain('Listing Fields')
    expect(source).not.toContain('Listing Cache')
    expect(source.indexOf('Listing Fields')).toBeGreaterThan(source.indexOf('schema-fields-heading'))
    expect(source).toContain('aria-label="Listing row preview"')
    expect(source).toContain('Created is always shown')
    expect(source).toContain('Local date and time')
    expect(source).toContain('v-if="listingPreviewFields.image"')
    expect(source).toContain('<div class="size-10 shrink-0" aria-hidden="true">')
    expect(source).not.toContain('Image: {{')
  })

  it('keeps created time fixed at the trailing edge of content rows', async () => {
    const source = await readProjectFile('app/pages/_desk/content/[schemaKey]/index.vue')

    expect(source).toContain('createdAt: string')
    expect(source).toContain('field.key === \'created_at\'')
    expect(source).toContain('accessorKey: \'createdAt\'')
    expect(source).toContain('formatDateTime(row.getValue(\'createdAt\') as string, locale.value)')
    expect(source.indexOf('accessorKey: \'createdAt\'')).toBeGreaterThan(source.indexOf('accessorKey: \'updatedAt\''))
    expect(source).toContain('src: row.original.image || undefined')
    expect(source).toContain('line-clamp-2 whitespace-normal')
  })
})
