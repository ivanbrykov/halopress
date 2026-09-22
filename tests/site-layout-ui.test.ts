import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('Layout resource authoring UI', () => {
  it('keeps list creation in a dashboard toolbar with one responsive shared form state', async () => {
    const [list, form] = await Promise.all([
      readFile(resolve(root, 'app/pages/_desk/site/layouts/index.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutCreateForm.vue'), 'utf8')
    ])
    expect(list).toContain('<UDashboardToolbar')
    expect(list).toContain('data-layout-create-trigger')
    expect(list).toContain('New layout')
    expect(list).toContain('window.matchMedia(\'(min-width: 640px)\')')
    expect(list).toContain('<UModal')
    expect(list).toContain('data-layout-create-modal')
    expect(list).toContain('<USlideover')
    expect(list).toContain('data-layout-create-slideover')
    expect(list.match(/<LayoutCreateForm/g)).toHaveLength(2)
    expect(list.match(/:state="createState"/g)).toHaveLength(2)
    expect(list).toContain('@after:leave="handleCreateAfterLeave"')
    expect(list).toContain('focusLayoutCreateTrigger()')
    expect(list).toContain('shouldApplyLayoutCreateNavigation')
    expect(list).toContain('import LayoutCreateForm from \'~/components/layout-editor/LayoutCreateForm.vue\'')
    expect(list).not.toContain('<UForm')
    expect(form).toContain('<UForm')
    expect(form).toContain('layoutCreateSchema')
    expect(form).toContain('data-layout-create-name')
    expect(form).toContain('data-layout-create-presets')
  })

  it('provides a stable-ID workspace with responsive viewport, ordered panel, and narrow inspector', async () => {
    const [editor, panel, canvas] = await Promise.all([
      readFile(resolve(root, 'app/pages/_desk/site/layouts/[layoutId].vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutEditorPanel.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutCanvas.vue'), 'utf8')
    ])
    expect(editor).toContain('route.params.layoutId')
    expect(editor).toContain(':data-layout-editor-id="workingId"')
    expect(editor).toContain('data-layout-command-bar')
    expect(editor).toContain('<UDashboardToolbar')
    expect(editor).toContain('min-width: 1024px')
    expect(editor).toContain('\'lg:grid-cols-[minmax(0,1fr)_22rem]\'')
    expect(editor).toContain('data-layout-mobile-inspector')
    expect(editor).toContain('import LayoutCanvas from \'~/components/layout-editor/LayoutCanvas.vue\'')
    expect(editor).toContain('import LayoutEditorPanel from \'~/components/layout-editor/LayoutEditorPanel.vue\'')
    expect(editor).toContain('import LayoutElementCreateForm from \'~/components/layout-editor/LayoutElementCreateForm.vue\'')
    expect(panel).toContain('import LayoutInspector from \'~/components/layout-editor/LayoutInspector.vue\'')
    expect(editor).toContain('<USlideover')
    expect(editor).toContain('viewport = ref<LayoutViewport>(\'desktop\')')
    expect(canvas).toContain('\'48rem\'')
    expect(canvas).toContain('\'24rem\'')
    expect(canvas).toContain('data-layout-viewport')
    expect(panel.indexOf('label: \'Elements\'')).toBeLessThan(panel.indexOf('label: \'Inspector\''))
    expect(panel).toContain('<UTabs')
  })

  it('supports focused element picking, drag placement, keyboard moves, history, preview, and typed Menu references', async () => {
    const [editor, panel, canvas, inspector, picker] = await Promise.all([
      readFile(resolve(root, 'app/pages/_desk/site/layouts/[layoutId].vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutEditorPanel.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutCanvas.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutInspector.vue'), 'utf8'),
      readFile(resolve(root, 'app/components/layout-editor/LayoutElementCreateForm.vue'), 'utf8')
    ])
    expect(editor).toContain('data-layout-element-modal')
    expect(editor).toContain('data-layout-element-slideover')
    expect(editor).toContain('pendingElementCreation')
    expect(editor).toContain('pendingCreation.layoutId !== layoutId.value')
    expect(panel).toContain('@dragstart')
    expect(canvas).toContain('application/x-halopress-layout-element')
    expect(canvas).toContain('data-layout-drop-indicator')
    expect(canvas).toContain(':data-layout-element-select="element.id"')
    expect(canvas).toContain('isLayoutElementTypeDropAllowed')
    expect(canvas).toContain('document.grid.maxWidth')
    expect(canvas).toContain('document.grid.gap')
    expect(canvas).toContain('region.flow')
    expect(inspector).toContain('data-layout-move="up"')
    expect(inspector).toContain('data-layout-move="down"')
    expect(editor).toContain('undoLayoutEditorHistory')
    expect(editor).toContain('redoLayoutEditorHistory')
    expect(editor).toContain('data-layout-preview-toggle')
    expect(editor).toContain('mode === \'preview\'')
    expect(inspector).toContain('data-layout-menu-picker')
    expect(inspector).toContain('data-layout-menu-missing')
    expect(picker).toContain('descriptor.type === \'menu\'')
    expect(picker).toContain('data-layout-element-menu-set')
    expect(picker).toContain('hasUsableLayoutMenuItems(menuItems.value)')
    expect(picker).toContain('!hasUsableMenuItems')
    for (const source of [editor, panel, canvas, inspector, picker]) {
      expect(source).not.toContain('Theme')
      expect(source).not.toContain('assetId')
      expect(source).not.toContain('<component')
    }
  })

  it('uses the existing API contracts, immutable synchronous cache updates, and guarded late responses', async () => {
    const [composable, editor] = await Promise.all([
      readFile(resolve(root, 'app/composables/useLayoutResources.ts'), 'utf8'),
      readFile(resolve(root, 'app/pages/_desk/site/layouts/[layoutId].vue'), 'utf8')
    ])
    expect(composable).toContain('method: \'POST\'')
    expect(composable).toContain('method: \'PATCH\'')
    expect(composable).toContain('method: \'PUT\'')
    expect(composable).toContain('method: \'DELETE\'')
    expect(composable).toContain('query: { revision }')
    expect(composable).not.toContain('method: \'DELETE\',\n        body')
    expect(composable).toContain('result.data.value = {')
    expect(composable).toContain('items.map(')
    expect(composable).toContain('items.filter(')
    expect(composable).not.toContain('await useFetch')
    expect(composable).not.toContain('return { ...result')
    expect(editor).toContain('shouldApplyLayoutMutationResult')
    expect(editor).toContain('shouldReplaceLayoutDraft')
    expect(editor).toContain('layoutStaleConflictFromFetchError')
    expect(editor).toContain('data-layout-stale-conflict')
    expect(editor).toContain('Your local draft is preserved')
    expect(editor).toContain('reloadLatest')
    expect(editor).toContain('reconcileLayoutRenameState(workingName.value, request, resource, document.value)')
    expect(editor).toContain(':disabled="busy || isDirty"')
  })

  it('blocks repair-required documents and never creates a Nuxt Layout or dynamic renderer surface', async () => {
    const editor = await readFile(resolve(root, 'app/pages/_desk/site/layouts/[layoutId].vue'), 'utf8')
    expect(editor).toContain('data-layout-repair-required')
    expect(editor).toContain('No raw or unknown elements are exposed')
    expect(editor).toContain('resource.status === \'repair-required\'')
    expect(editor).toContain('history.value = null')

    await expect(access(resolve(root, 'app/pages/_desk/site/layouts.vue'))).rejects.toThrow()
    const nuxtLayouts = await readdir(resolve(root, 'app/layouts'))
    expect(nuxtLayouts.sort()).toEqual(['blank.vue', 'default.vue', 'desk.vue'])
    const authoredFiles = [
      'app/pages/_desk/site/layouts/index.vue',
      'app/pages/_desk/site/layouts/[layoutId].vue',
      'app/composables/useLayoutResources.ts',
      'app/utils/layout-editor.ts',
      'app/components/layout-editor/LayoutCanvas.vue',
      'app/components/layout-editor/LayoutInspector.vue'
    ]
    for (const path of authoredFiles) {
      const source = await readFile(resolve(root, path), 'utf8')
      expect(source).not.toContain('SiteWorkspaceShell')
      expect(source).not.toContain('export type SiteLayout')
      expect(source).not.toContain('export interface SiteLayout')
      expect(source).not.toContain('<component')
      expect(source).not.toContain('import(')
    }
  })
})
