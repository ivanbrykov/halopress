import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

async function source(path: string) {
  return await readFile(resolve(projectRoot, path), 'utf8')
}

function expectOrdered(value: string, ...tokens: string[]) {
  let previous = -1
  for (const token of tokens) {
    const index = value.indexOf(token)
    expect(index, `Expected ${token} after offset ${previous}`).toBeGreaterThan(previous)
    previous = index
  }
}

describe('Layout assignment API security ordering', () => {
  it('authenticates assignment option and Site-setting reads before database helpers', async () => {
    const [options, siteSetting] = await Promise.all([
      source('server/api/site/layout-assignments/options.get.ts'),
      source('server/api/settings/site-layout.get.ts')
    ])

    expectOrdered(options, 'requireAdmin(event)', 'return await getLayoutAssignmentOptions(event)')
    expectOrdered(siteSetting, 'requireAdmin(event)', 'return await getSiteLayoutAssignmentAdmin(event)')
  })

  it('authenticates every assignment mutation before body and database access', async () => {
    const cases = [
      ['server/api/settings/site-layout.put.ts', 'await readBody', 'updateSiteLayoutAssignment(event'],
      ['server/api/page/index.post.ts', 'await readBody', 'getDb(event)'],
      ['server/api/page/[id].put.ts', 'await readBody', 'getDb(event)'],
      ['server/api/page/[id]/publish.post.ts', 'await readBody', 'getDb(event)'],
      ['server/api/schema/[schemaKey]/draft.post.ts', 'await readBody', 'getDb(event)'],
      ['server/api/schema/[schemaKey]/draft/history/[revision]/restore.post.ts', 'await readBody', 'getDb(event)'],
      ['server/api/schema/[schemaKey]/publish.post.ts', 'await readBody', 'getDb(event)']
    ] as const

    for (const [path, bodyToken, databaseToken] of cases) {
      const value = await source(path)
      expectOrdered(value, 'requireAdmin(event)', bodyToken, databaseToken)
    }
  })

  it('revalidates an unchanged Page Layout before publishing its snapshot', async () => {
    const value = await source('server/api/page/[id]/publish.post.ts')

    expectOrdered(
      value,
      'const layoutId = await prepareLayoutAssignmentChange',
      'await assertReadyLayoutAssignment(db, layoutId)',
      'await publishPageWorking'
    )
  })
})
