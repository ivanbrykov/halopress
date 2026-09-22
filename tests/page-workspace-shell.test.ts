import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUnsavedRouteLeaveDecision } from '../app/composables/useUnsavedNavigationGuard'

const projectRoot = resolve(import.meta.dirname, '..')

async function source(path: string) {
  return await readFile(resolve(projectRoot, path), 'utf8')
}

describe('page workspace shell', () => {
  it('guards route changes and browser unloads while edits are unsaved', async () => {
    const guard = await source('app/composables/useUnsavedNavigationGuard.ts')

    expect(guard).toContain('onBeforeRouteLeave')
    expect(guard).toContain('window.addEventListener(\'beforeunload\'')
    expect(guard).toContain('window.removeEventListener(\'beforeunload\'')
    expect(guard).toContain('const { confirm } = useConfirmDialog()')
    expect(guard).toContain('title: \'Discard unsaved changes?\'')
    expect(guard).toContain('body: message')
    expect(guard).toContain('return await pendingConfirmation')
    expect(guard.match(/confirm\(\{/g)).toHaveLength(1)
    expect(guard).not.toContain('window.confirm')
    expect(guard).toContain('allowNextNavigation')
  })

  it('waits for one custom confirmation and preserves every route-leave outcome', async () => {
    let dirty = false
    let allowNext = false
    let confirmationCalls = 0
    let resolveConfirmation: ((accepted: boolean) => void) | undefined
    const confirmDiscard = () => {
      confirmationCalls += 1
      return new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve
      })
    }
    const decideRouteLeave = createUnsavedRouteLeaveDecision({
      isDirty: () => dirty,
      consumeAllowedNavigation: () => {
        if (!allowNext) return false
        allowNext = false
        return true
      },
      confirmDiscard
    })

    expect(await decideRouteLeave()).toBe(true)
    expect(confirmationCalls).toBe(0)

    dirty = true
    allowNext = true
    expect(await decideRouteLeave()).toBe(true)
    expect(confirmationCalls).toBe(0)

    const firstDecision = decideRouteLeave()
    const repeatedDecision = decideRouteLeave()
    expect(confirmationCalls).toBe(1)
    resolveConfirmation?.(false)
    expect(await firstDecision).toBe(false)
    expect(await repeatedDecision).toBe(false)

    const confirmedDecision = decideRouteLeave()
    expect(confirmationCalls).toBe(2)
    resolveConfirmation?.(true)
    expect(await confirmedDecision).toBe(true)
  })

  it('uses the shared guard without blocking intentional post-mutation navigation', async () => {
    const [createPage, editPage] = await Promise.all([
      source('app/pages/_desk/pages/new.vue'),
      source('app/pages/_desk/pages/[id].vue')
    ])

    for (const page of [createPage, editPage]) {
      expect(page).toContain('useUnsavedNavigationGuard(isDirty)')
      expect(page).toContain('root: \'min-h-0 overflow-hidden\'')
      expect(page).toContain('body: \'min-h-0 overflow-hidden p-0 sm:p-0\'')
    }
    expect(createPage.match(/allowNextNavigation\(\)/g)).toHaveLength(3)
    expect(editPage).toContain('allowNextNavigation()\n    await navigateTo(\'/_desk/pages\')')
  })
})
