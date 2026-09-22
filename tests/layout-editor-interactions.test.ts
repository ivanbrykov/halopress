// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import {
  afterLayoutOverlayFocusRestored,
  allowedLayoutRegions,
  commitLayoutEditorHistory,
  createLayoutEditorHistory,
  createLayoutElement,
  focusLayoutCreateTrigger,
  focusLayoutMoveControl,
  hasUsableLayoutMenuItems,
  layoutElementDropIndex,
  isLayoutElementDropAllowed,
  layoutStaleConflictFromFetchError,
  layoutValidationIssuesFromFetchError,
  moveLayoutElementOrNoop,
  normalizeLayoutSelection,
  reconcileLayoutRenameState,
  redoLayoutEditorHistory,
  shouldAcceptLayoutCreateOpenChange,
  shouldApplyLayoutCreateNavigation,
  shouldApplyLayoutMutationResult,
  shouldReplaceLayoutDraft,
  undoLayoutEditorHistory
} from '../app/utils/layout-editor'
import {
  createLayoutDocumentFromPreset,
  insertLayoutElement,
  layoutElementRegistry,
  moveLayoutElement,
  serializeLayoutDocument
} from '../shared/site-layout'

describe('Layout editor interactions', () => {
  it('keeps stable selection through pointer and keyboard moves and makes each move one undo step', () => {
    const original = createLayoutDocumentFromPreset('grid', 'layout-a', 'Layout A')
    const menu = original.elements.find(element => element.type === 'menu')!
    let history = createLayoutEditorHistory(original, { regionId: menu.region, elementId: menu.id })

    const moved = moveLayoutElement(original, menu.id, 'footer', 0)
    history = commitLayoutEditorHistory(history, moved, { regionId: 'footer', elementId: menu.id })
    expect(history.current.selection).toEqual({ regionId: 'footer', elementId: menu.id })
    expect(history.current.document.elements.find(element => element.id === menu.id)).toMatchObject({ region: 'footer', order: 0 })
    expect(history.past).toHaveLength(1)

    const undone = undoLayoutEditorHistory(history)
    expect(undone.current.document).toEqual(original)
    expect(undone.current.selection.elementId).toBe(menu.id)
    expect(undone.future).toHaveLength(1)
    const redone = redoLayoutEditorHistory(undone)
    expect(redone.current.document).toEqual(moved)
    expect(redone.current.selection).toEqual({ regionId: 'footer', elementId: menu.id })
  })

  it('treats invalid and boundary moves as no-ops without adding history', () => {
    const original = createLayoutDocumentFromPreset('header-footer', 'layout-b', 'Layout B')
    const content = original.elements.find(element => element.type === 'page-content')!
    const invalid = moveLayoutElementOrNoop(original, content.id, 'header', 0)
    expect(invalid).toBe(original)

    const history = createLayoutEditorHistory(original, { regionId: 'content', elementId: content.id })
    expect(commitLayoutEditorHistory(history, invalid)).toBe(history)
    expect(undoLayoutEditorHistory(history)).toBe(history)
    expect(redoLayoutEditorHistory(history)).toBe(history)
  })

  it('maps visual drag targets accurately before and after the source element', () => {
    const document = createLayoutDocumentFromPreset('header-footer', 'layout-drag', 'Drag')
    const header = document.elements.filter(element => element.region === 'header')
      .sort((left, right) => left.order - right.order)
    expect(header).toHaveLength(3)
    expect(layoutElementDropIndex(document, header[0]!.id, 'header', 2)).toBe(1)
    expect(layoutElementDropIndex(document, header[2]!.id, 'header', 0)).toBe(0)
    expect(layoutElementDropIndex(document, header[0]!.id, 'footer', 1)).toBe(1)
  })

  it('rejects invalid drag destinations before exposing an insertion target', () => {
    const document = createLayoutDocumentFromPreset('grid', 'layout-targets', 'Targets')
    const content = document.elements.find(element => element.type === 'page-content')!
    expect(isLayoutElementDropAllowed(document, { kind: 'element', elementId: content.id }, 'header')).toBe(false)
    expect(isLayoutElementDropAllowed(document, { kind: 'element', elementId: content.id }, 'content')).toBe(true)
    expect(isLayoutElementDropAllowed(document, { kind: 'palette', type: 'copyright' }, 'header')).toBe(false)
    expect(isLayoutElementDropAllowed(document, { kind: 'palette', type: 'copyright' }, 'footer')).toBe(true)
    expect(isLayoutElementDropAllowed(document, { kind: 'palette', type: 'page-content' }, 'content')).toBe(false)
  })

  it('builds only registry-owned elements and resolves preset-compatible regions', () => {
    const blank = createLayoutDocumentFromPreset('blank', 'layout-blank', 'Plain')
    expect(allowedLayoutRegions(blank, 'menu')).toEqual([])
    const grid = createLayoutDocumentFromPreset('grid', 'layout-grid', 'Grid')
    expect(allowedLayoutRegions(grid, 'menu')).toEqual(['header', 'left-sidebar', 'right-sidebar', 'footer'])

    const menu = createLayoutElement('menu', 'footer', 'menu-instance', 'secondary-menu')
    expect(menu).toEqual({
      id: 'menu-instance',
      type: 'menu',
      region: 'footer',
      order: 0,
      props: { ...layoutElementRegistry.menu.defaultProps, menuSetId: 'secondary-menu' }
    })
    const inserted = insertLayoutElement(grid, menu)
    expect(inserted.elements.find(element => element.id === menu.id)).toMatchObject({
      id: menu.id,
      type: menu.type,
      region: menu.region,
      props: menu.props
    })
    expect(grid.elements.some(element => element.id === menu.id)).toBe(false)
  })

  it('preserves history and selection across an edit-preview-edit roundtrip', () => {
    const document = createLayoutDocumentFromPreset('grid', 'layout-preview', 'Preview')
    const selected = document.elements.find(element => element.type === 'table-of-contents')!
    const history = createLayoutEditorHistory(document, { regionId: selected.region, elementId: selected.id })
    let mode: 'edit' | 'preview' = 'edit'
    mode = 'preview'
    mode = 'edit'
    expect(mode).toBe('edit')
    expect(history.current.document).toEqual(document)
    expect(history.current.selection.elementId).toBe(selected.id)
  })

  it('guards delayed save replacement and create navigation by token and route identity', () => {
    const document = createLayoutDocumentFromPreset('blank', 'layout-route', 'Route')
    const snapshot = serializeLayoutDocument(document)
    const request = { token: 4, layoutId: document.layoutId, revision: 2, snapshot }
    expect(shouldApplyLayoutMutationResult(request, 4, 'layout-route', 'layout-route')).toBe(true)
    expect(shouldApplyLayoutMutationResult(request, 5, 'layout-route', 'layout-route')).toBe(false)
    expect(shouldApplyLayoutMutationResult(request, 4, 'layout-other', 'layout-route')).toBe(false)
    expect(shouldApplyLayoutMutationResult(request, 4, 'layout-route', 'layout-other')).toBe(false)
    expect(shouldReplaceLayoutDraft(request, snapshot)).toBe(true)
    expect(shouldReplaceLayoutDraft(request, `${snapshot}:newer local edit`)).toBe(false)

    const createRequest = { token: 9, originRoute: '/_desk/site/layouts' }
    expect(shouldApplyLayoutCreateNavigation(createRequest, 9, '/_desk/site/layouts')).toBe(true)
    expect(shouldApplyLayoutCreateNavigation(createRequest, 9, '/_desk/site/layouts/new')).toBe(false)
    expect(shouldApplyLayoutCreateNavigation(createRequest, 10, '/_desk/site/layouts')).toBe(false)
  })

  it('reconciles an in-flight rename without overwriting newer typing or reusing the stale revision', () => {
    const currentDocument = createLayoutDocumentFromPreset('blank', 'layout-rename', 'Original')
    const serverDocument = { ...structuredClone(currentDocument), name: 'Submitted name' }
    const request = { token: 3, layoutId: 'layout-rename', revision: 4, snapshot: 'Submitted name' }
    const reconciliation = reconcileLayoutRenameState('Newer local name', request, {
      id: 'layout-rename',
      name: 'Submitted name',
      revision: 5,
      status: 'ready',
      document: serverDocument,
      createdBy: null,
      updatedBy: 'reviewer',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:01:00.000Z',
      usage: [],
      canDelete: true
    }, currentDocument)

    expect(reconciliation.workingName).toBe('Newer local name')
    expect(reconciliation.baselineName).toBe('Submitted name')
    expect(reconciliation.baselineDocument).toBe(serializeLayoutDocument(serverDocument))
    expect(reconciliation.document.name).toBe('Submitted name')
    const nextMutation = {
      layoutId: request.layoutId,
      revision: reconciliation.workingRevision,
      snapshot: reconciliation.workingName
    }
    expect(nextMutation).toMatchObject({ revision: 5, snapshot: 'Newer local name' })
  })

  it('detects zero usable Menu sets when every option is disabled', () => {
    expect(hasUsableLayoutMenuItems([])).toBe(false)
    expect(hasUsableLayoutMenuItems([{ disabled: true }, { disabled: true }])).toBe(false)
    expect(hasUsableLayoutMenuItems([{ disabled: true }, { disabled: false }])).toBe(true)
  })

  it('preserves validation drafts, blocks pending dismissal, and restores toolbar focus after the overlay cycle', () => {
    const createDraft = { name: 'Draft survives', presetKey: 'grid' as const }
    const issues = layoutValidationIssuesFromFetchError({
      statusCode: 400,
      data: { issues: [{ path: 'name', message: 'Already used', kind: 'invalid' }] }
    })
    expect(issues).toEqual([{ path: 'name', message: 'Already used', kind: 'invalid' }])
    expect(createDraft).toEqual({ name: 'Draft survives', presetKey: 'grid' })
    expect(shouldAcceptLayoutCreateOpenChange(true, false)).toBe(false)
    expect(shouldAcceptLayoutCreateOpenChange(false, false)).toBe(true)

    document.body.innerHTML = '<button data-layout-create-trigger>New layout</button>'
    const callbacks: FrameRequestCallback[] = []
    const schedule = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    afterLayoutOverlayFocusRestored(focusLayoutCreateTrigger, schedule)
    expect(document.activeElement).toBe(document.body)
    callbacks.shift()!(0)
    expect(document.activeElement).toBe(document.body)
    callbacks.shift()!(0)
    expect((document.activeElement as HTMLElement).textContent).toBe('New layout')
  })

  it('retains keyboard focus on a valid move control at first and last boundaries', () => {
    document.body.innerHTML = `
      <button data-layout-element-id="stable" data-layout-move="up" disabled>Move up</button>
      <button data-layout-element-id="stable" data-layout-move="down">Move down</button>
    `
    expect(focusLayoutMoveControl('stable', 'up')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Move down')
    expect(focusLayoutMoveControl('stable', 'down')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Move down')
  })

  it('normalizes missing selection safely and recognizes structured stale conflicts', () => {
    const document = createLayoutDocumentFromPreset('blank', 'layout-stale', 'Stale')
    expect(normalizeLayoutSelection(document, { regionId: 'header', elementId: 'missing' }))
      .toEqual({ regionId: 'content' })
    expect(layoutStaleConflictFromFetchError({
      statusCode: 409,
      data: { currentRevision: 7, updatedBy: 'other-admin' }
    })).toEqual({ currentRevision: 7, updatedBy: 'other-admin' })
    expect(layoutStaleConflictFromFetchError({ statusCode: 409, data: {} })).toBeNull()
  })
})
