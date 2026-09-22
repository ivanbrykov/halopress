// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import {
  SITE_MENU_NO_ICON_VALUE,
  afterSiteMenuOverlayFocusRestored,
  commitSiteMenuItemCreation,
  countSiteMenuDynamicSources,
  createSiteMenuOverlayFinalizationFallback,
  createSiteMenuItemDraft,
  findSiteMenuItemSelection,
  focusAfterSiteMenuRemoval,
  focusFirstSiteMenuValidationIssue,
  focusSiteMenuEditor,
  focusSiteMenuMoveControl,
  focusSiteMenuRow,
  isCurrentSiteMenuResourceReady,
  isSiteMenuCreationTargetCurrent,
  isSiteMenuWorkingCopyDirty,
  moveSiteMenuArrayItem,
  restoreSiteMenuRowFocusAfterOverlay,
  siteMenuRemovalFocusId,
  shouldInitializeSiteMenuSelection,
  shouldApplySiteMenuPreviewResult,
  shouldApplySiteMenuSaveResult,
  shouldAcceptSiteMenuCreateOpenChange,
  shouldAcceptSiteMenuItemCreateOpenChange,
  shouldApplySiteMenuCreateNavigation,
  shouldEmitDeferredSiteMenuCreation,
  siteMenuIconFromEditorValue,
  siteMenuTypedFilterValue,
  siteMenuAuthoredItemLabel,
  siteMenuDestinationSummary,
  siteMenuItemIdForValidationPath,
  siteMenuMoveAnnouncement,
  siteMenuUsageFromFetchError,
  siteMenuValidationIssuesFromFetchError,
  validationMessageForPath
} from '../app/utils/site-menu-editor'
import {
  SITE_MENU_ICONS,
  siteMenuFilterValueSchema,
  type SiteMenuItem,
  type SiteMenuSourceFieldOption
} from '../shared/site-menu'

describe('Site menu rendered editor behavior', () => {
  it('keeps cleared numeric filters blank and coerces valid numeric input', () => {
    const numberField = { kind: 'number' } as SiteMenuSourceFieldOption
    const integerField = { kind: 'integer' } as SiteMenuSourceFieldOption

    const blank = siteMenuTypedFilterValue(numberField, '')
    expect(blank).toBe('')
    expect(siteMenuTypedFilterValue(integerField, '   ')).toBe('')
    expect(siteMenuFilterValueSchema.safeParse(blank).success).toBe(false)
    expect(siteMenuTypedFilterValue(numberField, '0')).toBe(0)
    expect(siteMenuTypedFilterValue(numberField, '12.5')).toBe(12.5)
    expect(siteMenuTypedFilterValue(integerField, '7')).toBe(7)
  })

  it('commits detached parent and child modal drafts once by stable identity', () => {
    const items = [{
      id: 'parent-a',
      label: 'Parent A',
      destination: { type: 'home' as const },
      children: []
    }, {
      id: 'parent-b',
      label: 'Parent B',
      destination: { type: 'home' as const },
      children: []
    }]
    const parentDraft = {
      id: 'new-parent',
      label: 'New parent',
      destination: { type: 'home' as const }
    }
    const beforeCancel = JSON.stringify(items)

    parentDraft.label = 'Cancelled draft'
    expect(JSON.stringify(items)).toBe(beforeCancel)

    parentDraft.label = 'New parent'
    const parentResult = commitSiteMenuItemCreation(items, parentDraft)
    expect(parentResult).toMatchObject({
      item: { id: 'new-parent', label: 'New parent', children: [] },
      position: 3
    })
    parentDraft.label = 'Detached after commit'
    expect(items[2]?.label).toBe('New parent')

    const reordered = moveSiteMenuArrayItem(items, 0, 1)
    const childResult = commitSiteMenuItemCreation(reordered, {
      id: 'new-child',
      label: 'New child',
      destination: { type: 'home' }
    }, 'parent-a')
    expect(childResult).toMatchObject({
      item: { id: 'new-child', label: 'New child' },
      parent: { id: 'parent-a' },
      position: 1
    })
    expect(reordered.find(item => item.id === 'parent-a')?.children.map(item => item.id))
      .toEqual(['new-child'])
    expect(reordered.find(item => item.id === 'parent-b')?.children).toEqual([])
    expect(commitSiteMenuItemCreation(reordered, {
      id: 'orphan',
      label: 'Orphan',
      destination: { type: 'home' }
    }, 'missing-parent')).toBeNull()
  })

  it('creates only typed static, content-query, and Page-list drafts and preserves source placement', () => {
    const options = {
      schemas: [{ schemaKey: 'article', label: 'Articles', fields: [] }],
      pages: []
    }
    const staticDraft = createSiteMenuItemDraft('static', 'static-one', options)
    const queryDraft = createSiteMenuItemDraft('schemaQuery', 'query-one', options)
    const pageDraft = createSiteMenuItemDraft('pagePrefix', 'pages-one', options)

    expect(staticDraft).toEqual({ id: 'static-one', label: '', destination: { type: 'home' } })
    expect(queryDraft).toEqual({
      kind: 'dynamic',
      id: 'query-one',
      source: expect.objectContaining({
        version: 1,
        type: 'schemaQuery',
        schemaKey: 'article',
        filters: [],
        limit: 10
      })
    })
    expect(pageDraft).toEqual({
      kind: 'dynamic',
      id: 'pages-one',
      source: expect.objectContaining({
        version: 1,
        type: 'pagePrefix',
        scope: { type: 'fixed', prefix: '/' },
        limit: 10
      })
    })
    expect(JSON.stringify([queryDraft, pageDraft])).not.toMatch(/queryText|expression|sql|javascript|regex/i)

    const items: SiteMenuItem[] = []
    expect(commitSiteMenuItemCreation(items, queryDraft)).toMatchObject({ position: 1 })
    expect(commitSiteMenuItemCreation(items, {
      id: 'parent',
      label: 'Parent',
      destination: { type: 'home' }
    })).toMatchObject({ position: 2 })
    expect(commitSiteMenuItemCreation(items, pageDraft, 'parent')).toMatchObject({ position: 1 })
    expect(countSiteMenuDynamicSources(items)).toBe(2)
    expect(siteMenuAuthoredItemLabel(queryDraft)).toBe('article query')
    expect(siteMenuDestinationSummary(queryDraft)).toContain('Content query · article')
    expect(siteMenuDestinationSummary(pageDraft)).toContain('Page list · Direct children of /')
  })

  it('keeps malformed fallback documents repairable and initializes a successful retry once', () => {
    expect(isSiteMenuWorkingCopyDirty(true, 'same', 'same')).toBe(true)
    expect(isSiteMenuWorkingCopyDirty(false, 'same', 'same')).toBe(false)
    expect(shouldInitializeSiteMenuSelection(null, 'error', false)).toBe(false)
    expect(shouldInitializeSiteMenuSelection({ items: [] }, 'success', false)).toBe(true)
    expect(shouldInitializeSiteMenuSelection({ items: [] }, 'success', true)).toBe(false)
  })

  it('rejects stale working copies when the editor route is reused', () => {
    expect(isCurrentSiteMenuResourceReady(
      'success', false, false, 'menu-a', 'menu-a', 'menu-a'
    )).toBe(true)
    expect(isCurrentSiteMenuResourceReady(
      'success', false, false, 'missing-menu', undefined, 'menu-a'
    )).toBe(false)
    expect(isCurrentSiteMenuResourceReady(
      'success', false, false, 'menu-b', 'menu-b', 'menu-a'
    )).toBe(false)
    expect(isCurrentSiteMenuResourceReady(
      'pending', true, false, 'menu-a', 'menu-a', 'menu-a'
    )).toBe(false)
    expect(isCurrentSiteMenuResourceReady(
      'error', false, true, 'menu-a', 'menu-a', 'menu-a'
    )).toBe(false)
    // Route B can be active while the reused list still exposes A's source and
    // working copy. Both readiness and submitted route identity must reject it.
    expect(isCurrentSiteMenuResourceReady(
      'pending', true, false, 'menu-b', 'menu-a', 'menu-a'
    )).toBe(false)
    expect(isSiteMenuCreationTargetCurrent('menu-a', 'menu-b', 'menu-a')).toBe(false)
  })

  it('does not let a delayed save overwrite later edits or another selection', async () => {
    let resolveSave!: (resource: { id: string; name: string }) => void
    const delayedSave = new Promise<{ id: string; name: string }>((resolve) => {
      resolveSave = resolve
    })
    const request = { token: 1, menuId: 'menu-a', snapshot: 'Menu A:before' }
    let selectedMenuId = 'menu-a'
    let working = { id: 'menu-a', name: 'Menu A:before' }
    const applyWhenCurrent = delayedSave.then((resource) => {
      if (shouldApplySiteMenuSaveResult(
        request,
        1,
        selectedMenuId,
        working.id,
        working.name
      )) working = resource
    })

    working = { ...working, name: 'Menu A:edited while saving' }
    resolveSave({ id: 'menu-a', name: 'Menu A:server response' })
    await applyWhenCurrent
    expect(working).toEqual({ id: 'menu-a', name: 'Menu A:edited while saving' })

    let resolveSelectionSave!: (resource: { id: string; name: string }) => void
    const delayedSelectionSave = new Promise<{ id: string; name: string }>((resolve) => {
      resolveSelectionSave = resolve
    })
    const selectionRequest = { token: 2, menuId: 'menu-a', snapshot: working.name }
    const applyAfterSelection = delayedSelectionSave.then((resource) => {
      if (shouldApplySiteMenuSaveResult(
        selectionRequest,
        2,
        selectedMenuId,
        working.id,
        working.name
      )) working = resource
    })
    selectedMenuId = 'menu-b'
    working = { id: 'menu-b', name: 'Menu B' }
    resolveSelectionSave({ id: 'menu-a', name: 'Menu A:server response' })
    await applyAfterSelection
    expect(working).toEqual({ id: 'menu-b', name: 'Menu B' })

    expect(shouldApplySiteMenuSaveResult(
      { token: 3, menuId: 'menu-b', snapshot: 'Menu B' },
      3,
      selectedMenuId,
      working.id,
      working.name
    )).toBe(true)
  })

  it('rejects late preview success and error after the editor route changes', async () => {
    let latestToken = 1
    let routeMenuId = 'menu-a'
    let workingMenuId = 'menu-a'
    let snapshot = 'menu-a-document'
    let rendered = 'menu-a-existing-preview'
    let message = ''

    let resolvePreview!: (value: string) => void
    const delayedSuccess = new Promise<string>((resolve) => {
      resolvePreview = resolve
    })
    const successRequest = { token: 1, menuId: 'menu-a', snapshot }
    const applySuccess = delayedSuccess.then((value) => {
      if (shouldApplySiteMenuPreviewResult(
        successRequest,
        latestToken,
        routeMenuId,
        workingMenuId,
        snapshot
      )) rendered = value
    })

    routeMenuId = 'menu-b'
    workingMenuId = 'menu-b'
    snapshot = 'menu-b-document'
    resolvePreview('menu-a-late-success')
    await applySuccess
    expect(rendered).toBe('menu-a-existing-preview')

    latestToken = 2
    const errorRequest = { token: 2, menuId: 'menu-b', snapshot }
    let rejectPreview!: (reason: Error) => void
    const delayedError = new Promise<string>((_resolve, reject) => {
      rejectPreview = reject
    })
    const applyError = delayedError.catch((error: Error) => {
      if (shouldApplySiteMenuPreviewResult(
        errorRequest,
        latestToken,
        routeMenuId,
        workingMenuId,
        snapshot
      )) message = error.message
    })

    routeMenuId = 'menu-c'
    workingMenuId = 'menu-c'
    snapshot = 'menu-c-document'
    rejectPreview(new Error('menu-b-late-error'))
    await applyError
    expect(message).toBe('')

    expect(shouldApplySiteMenuPreviewResult(
      { token: 3, menuId: 'menu-c', snapshot },
      3,
      routeMenuId,
      workingMenuId,
      snapshot
    )).toBe(true)
    expect(shouldApplySiteMenuPreviewResult(
      { token: 2, menuId: 'menu-c', snapshot },
      3,
      routeMenuId,
      workingMenuId,
      snapshot
    )).toBe(false)
  })

  it.each(['pointer', 'touch', 'keyboard'] as const)(
    'preserves stable item identity for a %s reorder and produces a live announcement',
    (inputMethod) => {
      const before = [
        { id: 'first', value: 'stable-first', label: 'First' },
        { id: 'second', value: 'stable-second', label: 'Second' }
      ]
      const after = moveSiteMenuArrayItem(before, 0, 1)

      expect(inputMethod).toMatch(/pointer|touch|keyboard/)
      expect(after.map(item => [item.id, item.value])).toEqual([
        ['second', 'stable-second'],
        ['first', 'stable-first']
      ])
      expect(siteMenuMoveAnnouncement('First', 2, 2, 'parent'))
        .toBe('Moved First to position 2 of 2.')
      expect(siteMenuMoveAnnouncement('Child', 1, 2, 'child'))
        .toBe('Moved Child to child position 1 of 2.')
    }
  )

  it('retains focus on the moved control and focuses the first repeated invalid field', () => {
    document.body.innerHTML = `
      <button data-menu-item-id="second" data-menu-move="up">Move up</button>
      <button data-menu-item-id="second" data-menu-move="down" disabled>Move down</button>
      <input data-validation-path="document.items.0.label">
      <button data-validation-path="document.items.1.destination.type">Destination</button>
    `
    expect(focusSiteMenuMoveControl('second', 'up')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Move up')
    expect(focusSiteMenuMoveControl('second', 'down')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Move up')

    const issues = [
      { path: 'document.items.1.destination', message: 'Choose a valid destination' },
      { path: 'document.items.0.label', message: 'Enter a label' }
    ]
    expect(focusFirstSiteMenuValidationIssue(issues)).toBe(true)
    expect((document.activeElement as HTMLElement).dataset.validationPath)
      .toBe('document.items.1.destination.type')
    expect(validationMessageForPath(issues, 'document.items.0.label')).toBe('Enter a label')
  })

  it('restores focus by stable identity after parent and child removals', () => {
    const rows = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
    expect(siteMenuRemovalFocusId(rows, 1)).toBe('third')
    expect(siteMenuRemovalFocusId(rows, 2)).toBe('second')
    expect(siteMenuRemovalFocusId([{ id: 'only' }], 0)).toBeUndefined()

    document.body.innerHTML = `
      <button data-menu-row-focus="second">Second row control</button>
      <button data-menu-row-focus="third">Third row control</button>
      <button data-menu-add-parent>Add parent link</button>
      <button data-menu-add-child="parent-a">Add child link</button>
    `
    expect(focusAfterSiteMenuRemoval('third')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Third row control')
    expect(focusAfterSiteMenuRemoval(undefined)).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Add parent link')
    expect(focusAfterSiteMenuRemoval(undefined, 'parent-a')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Add child link')
  })

  it('keeps one stable item selection across reorder and responsive detail hosts', () => {
    const items = [{
      id: 'parent-a',
      label: 'Parent A',
      destination: { type: 'home' as const },
      children: [{
        id: 'child-a',
        label: 'Child A',
        destination: { type: 'home' as const }
      }]
    }, {
      id: 'parent-b',
      label: 'Parent B',
      destination: { type: 'home' as const },
      children: []
    }]
    const before = findSiteMenuItemSelection(items, 'child-a')
    expect(before).toMatchObject({
      id: 'child-a',
      parentId: 'parent-a',
      pathPrefix: 'document.items.0.children.0'
    })

    const reordered = moveSiteMenuArrayItem(items, 0, 1)
    const after = findSiteMenuItemSelection(reordered, 'child-a')
    expect(after).toMatchObject({
      id: 'child-a',
      parentId: 'parent-a',
      pathPrefix: 'document.items.1.children.0'
    })
    expect(after?.item).toBe(before?.item)
    expect(siteMenuItemIdForValidationPath(reordered, 'document.items.1.children.0.label')).toBe('child-a')
    expect(siteMenuItemIdForValidationPath(reordered, 'document.items.0.destination')).toBe('parent-b')

    document.body.innerHTML = '<button data-menu-row-select="child-a">Edit Child A</button>'
    expect(focusSiteMenuRow('child-a')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Edit Child A')
  })

  it('restores mobile drawer focus after the overlay focus cycle', () => {
    document.body.innerHTML = `
      <button id="fallback">Fallback trigger</button>
      <button data-menu-row-select="child-a">Edit Child A</button>
    `
    const callbacks: FrameRequestCallback[] = []
    const schedule = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    document.querySelector<HTMLElement>('#fallback')!.focus()

    restoreSiteMenuRowFocusAfterOverlay('child-a', schedule)
    expect((document.activeElement as HTMLElement).textContent).toBe('Fallback trigger')
    callbacks.shift()!(0)
    expect((document.activeElement as HTMLElement).textContent).toBe('Fallback trigger')
    callbacks.shift()!(0)
    expect((document.activeElement as HTMLElement).textContent).toBe('Edit Child A')
  })

  it('waits for modal close autofocus before selecting a created item and blocks close while creating', () => {
    const callbacks: FrameRequestCallback[] = []
    const schedule = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    let createdSelection = ''

    afterSiteMenuOverlayFocusRestored(() => {
      createdSelection = 'new-item'
    }, schedule)
    expect(createdSelection).toBe('')
    callbacks.shift()!(0)
    expect(createdSelection).toBe('')
    callbacks.shift()!(0)
    expect(createdSelection).toBe('new-item')

    expect(shouldAcceptSiteMenuCreateOpenChange(true, false)).toBe(false)
    expect(shouldAcceptSiteMenuCreateOpenChange(true, true)).toBe(true)
    expect(shouldAcceptSiteMenuCreateOpenChange(false, false)).toBe(true)
  })

  it('rejects delayed modal commits and navigation after the route identity changes', () => {
    const callbacks: FrameRequestCallback[] = []
    const schedule = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    const menuA = [{
      id: 'parent-a',
      label: 'Parent A',
      destination: { type: 'home' as const },
      children: []
    }]
    const menuB = [{
      id: 'parent-b',
      label: 'Parent B',
      destination: { type: 'home' as const },
      children: []
    }]
    let routeMenuId = 'menu-a'
    let workingMenuId = 'menu-a'
    let workingItems = menuA
    let navigated = false

    afterSiteMenuOverlayFocusRestored(() => {
      if (!isSiteMenuCreationTargetCurrent('menu-a', routeMenuId, workingMenuId)) return
      commitSiteMenuItemCreation(workingItems, {
        id: 'delayed-item',
        label: 'Delayed item',
        destination: { type: 'home' }
      })
    }, schedule)
    afterSiteMenuOverlayFocusRestored(() => {
      navigated = shouldApplySiteMenuCreateNavigation(
        { token: 1, originRoute: '/_desk/site/menus' },
        1,
        '/_desk/site/menus/global-navigation'
      )
    }, schedule)

    routeMenuId = 'menu-b'
    workingMenuId = 'menu-b'
    workingItems = menuB
    while (callbacks.length) callbacks.shift()!(0)

    expect(menuA).toHaveLength(1)
    expect(menuB).toHaveLength(1)
    expect(navigated).toBe(false)
    expect(isSiteMenuCreationTargetCurrent('menu-a', 'menu-a', 'menu-a')).toBe(true)
    expect(shouldApplySiteMenuCreateNavigation(
      { token: 2, originRoute: '/_desk/site/menus' },
      2,
      '/_desk/site/menus'
    )).toBe(true)
    expect(shouldApplySiteMenuCreateNavigation(
      { token: 3, originRoute: '/_desk/site/menus?view=all#sets' },
      3,
      '/_desk/site/menus?view=unused#sets'
    )).toBe(false)
  })

  it('blocks rapid reopen while delivering one valid item create', () => {
    const callbacks: FrameRequestCallback[] = []
    const schedule = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    let active = true
    let generation = 3
    const scheduledGeneration = generation
    let emitted = 0

    afterSiteMenuOverlayFocusRestored(() => {
      if (shouldEmitDeferredSiteMenuCreation(active, scheduledGeneration, generation)) emitted++
    }, schedule)

    const acceptedRapidReopen = shouldAcceptSiteMenuItemCreateOpenChange(true, true)
    if (acceptedRapidReopen) generation++
    expect(acceptedRapidReopen).toBe(false)
    expect(shouldAcceptSiteMenuItemCreateOpenChange(true, false)).toBe(true)
    expect(shouldAcceptSiteMenuItemCreateOpenChange(false, true)).toBe(true)
    while (callbacks.length) callbacks.shift()!(0)
    expect(emitted).toBe(1)
    expect(callbacks).toHaveLength(0)

    active = false
    generation++
    expect(shouldEmitDeferredSiteMenuCreation(active, scheduledGeneration, generation)).toBe(false)
  })

  it('finalizes one item create when a breakpoint swaps the overlay during close', () => {
    let scheduled: (() => void) | undefined
    const fallback = createSiteMenuOverlayFinalizationFallback((callback) => {
      scheduled = callback
      return 'item-close-fallback'
    }, () => {})
    let pending = { id: 'created-item' } as { id: string } | null
    let deliveryPending = true
    const emitted: string[] = []
    const finalize = () => {
      const created = pending
      if (!created) return
      pending = null
      fallback.cancel()
      deliveryPending = false
      emitted.push(created.id)
    }

    fallback.schedule(finalize)
    // The responsive v-if swaps UModal for USlideover before after:leave.
    scheduled?.()
    expect(emitted).toEqual(['created-item'])
    expect(deliveryPending).toBe(false)
    expect(shouldAcceptSiteMenuItemCreateOpenChange(deliveryPending, true)).toBe(true)

    // A late leave event from either host still cannot commit a second time.
    finalize()
    expect(emitted).toEqual(['created-item'])
  })

  it('finalizes one menu-list create when a breakpoint swaps the overlay during close', () => {
    let scheduled: (() => void) | undefined
    const fallback = createSiteMenuOverlayFinalizationFallback((callback) => {
      scheduled = callback
      return 'menu-close-fallback'
    }, () => {})
    let pending = { id: 'created-menu', name: 'Created menu' } as { id: string; name: string } | null
    let draftName = 'Created menu'
    const navigated: string[] = []
    const finalize = () => {
      const created = pending
      if (!created) return
      pending = null
      fallback.cancel()
      draftName = ''
      navigated.push(created.id)
    }

    fallback.schedule(finalize)
    // No after:leave arrives after the desktop/mobile overlay host changes.
    scheduled?.()
    expect(navigated).toEqual(['created-menu'])
    expect(draftName).toBe('')
    expect(pending).toBeNull()

    finalize()
    expect(navigated).toEqual(['created-menu'])
  })

  it('focuses the exact created/deleted menu target with an empty-list fallback', () => {
    document.body.innerHTML = `
      <h2 data-menu-selector-heading tabindex="-1">Menu set selector</h2>
      <section data-menu-editor-id="old-menu">
        <h2 data-menu-editor-heading tabindex="-1">Old menu heading</h2>
        <input data-menu-name-input aria-label="Old menu name">
      </section>
      <section data-menu-editor-id="new-menu">
        <h2 data-menu-editor-heading tabindex="-1">New menu heading</h2>
        <input data-menu-name-input aria-label="New menu name">
      </section>
    `
    expect(focusSiteMenuEditor('new-menu', 'name')).toBe(true)
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('New menu name')
    expect(focusSiteMenuEditor('new-menu', 'heading')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('New menu heading')

    document.querySelectorAll('[data-menu-editor-id]').forEach(element => element.remove())
    expect(focusSiteMenuEditor(undefined, 'heading')).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toBe('Menu set selector')
  })

  it('parses delete-race usage and structured validation without accepting malformed metadata', () => {
    const usage = [{
      resourceType: 'site-layout' as const,
      resourceId: 'layout-1',
      label: 'Marketing header'
    }]
    const issues = [
      { path: 'name', message: 'Names must be unique' },
      { path: 'document.items.1.value', message: 'Values must be unique' }
    ]
    const error = { data: { data: { usage, issues } } }

    expect(siteMenuUsageFromFetchError(error)).toEqual(usage)
    expect(siteMenuValidationIssuesFromFetchError(error)).toEqual(issues)
    expect(validationMessageForPath(siteMenuValidationIssuesFromFetchError(error), 'name'))
      .toBe('Names must be unique')
    expect(validationMessageForPath(siteMenuValidationIssuesFromFetchError(error), 'document.items.1.value'))
      .toBe('Values must be unique')
    expect(siteMenuUsageFromFetchError({ data: { usage: [{ resourceType: 'unsafe' }] } })).toEqual([])
  })

  it('keeps the no-icon sentinel out of persisted menu documents', () => {
    expect(siteMenuIconFromEditorValue(SITE_MENU_NO_ICON_VALUE)).toBeUndefined()
    expect(siteMenuIconFromEditorValue('i-lucide-not-allowed')).toBeUndefined()
    expect(siteMenuIconFromEditorValue(SITE_MENU_ICONS[0])).toBe(SITE_MENU_ICONS[0])
  })
})
