import {
  SITE_MENU_ICONS,
  SITE_MENU_MAX_CHILDREN,
  SITE_MENU_MAX_ITEMS,
  isSiteMenuDynamicItem,
  isSiteMenuStaticItem,
  siteMenuChildSchema,
  type SiteMenuChild,
  type SiteMenuDynamicItem,
  type SiteMenuItem,
  type SiteMenuSourceFieldOption,
  type SiteMenuSourceOptionsResponse,
  type SiteMenuUsage,
  type SiteMenuValidationIssue
} from '~~/shared/site-menu'

export const SITE_MENU_NO_ICON_VALUE = '__none__'

export function siteMenuIconFromEditorValue(value: string): typeof SITE_MENU_ICONS[number] | undefined {
  return SITE_MENU_ICONS.find(icon => icon === value)
}

export function siteMenuTypedFilterValue(
  field: SiteMenuSourceFieldOption | undefined,
  value: unknown
) {
  if (field?.kind === 'boolean') {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
  }
  if ((field?.kind === 'number' || field?.kind === 'integer')
    && (typeof value === 'string' || typeof value === 'number')) {
    if (typeof value === 'string' && value.trim() === '') return ''
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : ''
}

export function shouldInitializeSiteMenuSelection(
  response: unknown,
  requestStatus: string,
  hasWorkingCopy: boolean
) {
  return Boolean(response) && requestStatus === 'success' && !hasWorkingCopy
}

export function isSiteMenuWorkingCopyDirty(
  malformedStoredValue: boolean,
  currentSnapshot: string,
  baselineSnapshot: string
) {
  return malformedStoredValue || currentSnapshot !== baselineSnapshot
}

export type SiteMenuSaveIdentity = {
  token: number
  menuId: string
  snapshot: string
}

export type SiteMenuPreviewIdentity = SiteMenuSaveIdentity

export function shouldApplySiteMenuSaveResult(
  request: SiteMenuSaveIdentity,
  latestToken: number,
  selectedMenuId: string,
  workingMenuId: string | undefined,
  currentSnapshot: string
) {
  return request.token === latestToken
    && request.menuId === selectedMenuId
    && request.menuId === workingMenuId
    && request.snapshot === currentSnapshot
}

export function shouldApplySiteMenuPreviewResult(
  request: SiteMenuPreviewIdentity,
  latestToken: number,
  routeMenuId: string,
  workingMenuId: string | undefined,
  currentSnapshot: string
) {
  return request.token === latestToken
    && request.menuId === routeMenuId
    && request.menuId === workingMenuId
    && request.snapshot === currentSnapshot
}

export function moveSiteMenuArrayItem<T>(items: readonly T[], from: number, to: number) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

export type SiteMenuItemCreationResult = {
  item: SiteMenuChild
  parent?: Exclude<SiteMenuItem, SiteMenuDynamicItem>
  position: number
}

/**
 * Commit a detached modal draft only after successful form submission. Child
 * parents are resolved by stable ID so reordered rows cannot redirect a link.
 */
export function commitSiteMenuItemCreation(
  items: SiteMenuItem[],
  draft: SiteMenuChild,
  parentId?: string
): SiteMenuItemCreationResult | null {
  const created = siteMenuChildSchema.parse(draft)
  if (parentId === undefined) {
    if (items.length >= SITE_MENU_MAX_ITEMS) return null
    const item: SiteMenuItem = isSiteMenuDynamicItem(created)
      ? created
      : { ...created, children: [] }
    items.push(item)
    return { item, position: items.length }
  }

  const parent = items.find(item => item.id === parentId)
  if (!parent || !isSiteMenuStaticItem(parent) || parent.children.length >= SITE_MENU_MAX_CHILDREN) return null
  parent.children.push(created)
  return { item: created, parent, position: parent.children.length }
}

export function siteMenuMoveAnnouncement(
  label: string,
  position: number,
  total: number,
  level: 'parent' | 'child'
) {
  return `Moved ${label} to ${level === 'child' ? 'child ' : ''}position ${position} of ${total}.`
}

export function focusSiteMenuMoveControl(
  itemId: string,
  direction: 'up' | 'down'
) {
  const controls = document.querySelectorAll<HTMLElement>('[data-menu-item-id][data-menu-move]')
  const itemControls = [...controls].filter(candidate => candidate.dataset.menuItemId === itemId)
  const requested = itemControls.find(candidate => candidate.dataset.menuMove === direction)
  const control = requested && !requested.hasAttribute('disabled')
    ? requested
    : itemControls.find(candidate => !candidate.hasAttribute('disabled'))
  if (!control) return false
  control.focus()
  return true
}

export function siteMenuRemovalFocusId<T extends { id: string }>(items: readonly T[], removedIndex: number) {
  return items[removedIndex + 1]?.id ?? items[removedIndex - 1]?.id
}

export type SiteMenuItemSelection = {
  id: string
  parentId?: string
  item: SiteMenuItem | SiteMenuChild
  pathPrefix: string
  parentIndex: number
  childIndex?: number
}

export function findSiteMenuItemSelection(
  items: readonly SiteMenuItem[],
  selectedId: string
): SiteMenuItemSelection | null {
  for (const [parentIndex, item] of items.entries()) {
    if (item.id === selectedId) {
      return {
        id: item.id,
        item,
        pathPrefix: `document.items.${parentIndex}`,
        parentIndex
      }
    }
    if (isSiteMenuDynamicItem(item)) continue
    const childIndex = item.children.findIndex(child => child.id === selectedId)
    if (childIndex !== -1) {
      return {
        id: item.children[childIndex]!.id,
        parentId: item.id,
        item: item.children[childIndex]!,
        pathPrefix: `document.items.${parentIndex}.children.${childIndex}`,
        parentIndex,
        childIndex
      }
    }
  }
  return null
}

export function siteMenuItemIdForValidationPath(
  items: readonly SiteMenuItem[],
  path: string
) {
  const match = /^document\.items\.(\d+)(?:\.children\.(\d+))?/.exec(path)
  if (!match) return undefined
  const parent = items[Number(match[1])]
  if (!parent) return undefined
  return match[2] === undefined || isSiteMenuDynamicItem(parent)
    ? parent.id
    : parent.children[Number(match[2])]?.id
}

export function siteMenuAuthoredItemLabel(item: SiteMenuItem | SiteMenuChild) {
  if (!isSiteMenuDynamicItem(item)) return item.label
  return item.source.type === 'schemaQuery'
    ? `${item.source.schemaKey || 'Content'} query`
    : item.source.scope.type === 'currentParent'
      ? 'Current Page siblings'
      : `Pages under ${item.source.scope.prefix}`
}

export function siteMenuDestinationSummary(item: SiteMenuItem | SiteMenuChild) {
  if (isSiteMenuDynamicItem(item)) {
    if (item.source.type === 'schemaQuery') {
      const filters = item.source.filters.length
      return `Content query · ${item.source.schemaKey || 'Schema required'} · ${filters} ${filters === 1 ? 'filter' : 'filters'} · up to ${item.source.limit}`
    }
    const scope = item.source.scope.type === 'currentParent'
      ? 'Current Page parent'
      : `Direct children of ${item.source.scope.prefix}`
    return `Page list · ${scope} · up to ${item.source.limit}`
  }
  switch (item.destination.type) {
    case 'home':
      return 'Home page'
    case 'page':
      return `Page · ${item.destination.pageId || 'Not selected'}`
    case 'collection':
      return `Collection · ${item.destination.schemaKey || 'Not selected'}`
    case 'content':
      return `Content · ${item.destination.schemaKey || 'schema'} / ${item.destination.contentId || 'item'}`
    case 'external':
      return `External · ${item.destination.url || 'URL required'}`
  }
}

export function countSiteMenuDynamicSources(items: readonly SiteMenuItem[]) {
  return items.reduce((count, item) => count + (isSiteMenuDynamicItem(item)
    ? 1
    : item.children.filter(isSiteMenuDynamicItem).length), 0)
}

export type SiteMenuCreateItemKind = 'static' | 'schemaQuery' | 'pagePrefix'

export function createSiteMenuItemDraft(
  kind: SiteMenuCreateItemKind,
  id: string,
  options?: SiteMenuSourceOptionsResponse | null
): SiteMenuChild {
  if (kind === 'schemaQuery') {
    return {
      kind: 'dynamic',
      id,
      source: {
        version: 1,
        type: 'schemaQuery',
        schemaKey: options?.schemas[0]?.schemaKey ?? '',
        filters: [],
        sort: { type: 'system', field: 'createdAt', direction: 'desc' },
        label: { type: 'systemTitle' },
        limit: 10
      }
    }
  }
  if (kind === 'pagePrefix') {
    return {
      kind: 'dynamic',
      id,
      source: {
        version: 1,
        type: 'pagePrefix',
        scope: { type: 'fixed', prefix: '/' },
        sort: 'title',
        limit: 10
      }
    }
  }
  return { id, label: '', destination: { type: 'home' } }
}

function elementWithDataValue(attribute: string, value: string) {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find(candidate => candidate.getAttribute(attribute) === value)
}

export function focusAfterSiteMenuRemoval(nextItemId: string | undefined, parentItemId?: string) {
  const nextControl = nextItemId
    ? elementWithDataValue('data-menu-row-focus', nextItemId)
    : undefined
  const fallback = parentItemId
    ? elementWithDataValue('data-menu-add-child', parentItemId)
    : document.querySelector<HTMLElement>('[data-menu-add-parent]')
  const target = nextControl ?? fallback
  if (!target) return false
  target.focus()
  return true
}

export function focusSiteMenuRow(itemId: string | undefined) {
  if (!itemId) return false
  const target = elementWithDataValue('data-menu-row-select', itemId)
  if (!target) return false
  target.focus()
  return true
}

export function restoreSiteMenuRowFocusAfterOverlay(
  itemId: string | undefined,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame
) {
  afterSiteMenuOverlayFocusRestored(() => focusSiteMenuRow(itemId), schedule)
}

export function afterSiteMenuOverlayFocusRestored(
  callback: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame
) {
  schedule(() => schedule(() => callback()))
}

export const SITE_MENU_OVERLAY_FINALIZE_FALLBACK_MS = 500

type SiteMenuOverlayFallbackSchedule = (callback: () => void, delay: number) => unknown
type SiteMenuOverlayFallbackCancel = (handle: unknown) => void

/**
 * Keep the overlay transition event authoritative, but provide a bounded
 * fallback when a responsive UModal/USlideover swap unmounts the closing host
 * before it can emit after:leave.
 */
export function createSiteMenuOverlayFinalizationFallback(
  schedule: SiteMenuOverlayFallbackSchedule = (callback, delay) => setTimeout(callback, delay),
  cancel: SiteMenuOverlayFallbackCancel = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
) {
  let handle: unknown | null = null

  function cancelPending() {
    if (handle === null) return
    cancel(handle)
    handle = null
  }

  function scheduleFinalization(callback: () => void) {
    cancelPending()
    handle = schedule(() => {
      handle = null
      callback()
    }, SITE_MENU_OVERLAY_FINALIZE_FALLBACK_MS)
  }

  return {
    schedule: scheduleFinalization,
    cancel: cancelPending
  }
}

export function shouldAcceptSiteMenuCreateOpenChange(isCreating: boolean, nextOpen: boolean) {
  return nextOpen || !isCreating
}

export function shouldAcceptSiteMenuItemCreateOpenChange(
  deliveryPending: boolean,
  nextOpen: boolean
) {
  return !deliveryPending || !nextOpen
}

export function isCurrentSiteMenuResourceReady(
  requestStatus: string,
  pending: boolean,
  hasError: boolean,
  routeMenuId: string,
  sourceMenuId: string | undefined,
  workingMenuId: string | undefined
) {
  return requestStatus === 'success'
    && !pending
    && !hasError
    && Boolean(routeMenuId)
    && sourceMenuId === routeMenuId
    && workingMenuId === routeMenuId
}

export function isSiteMenuCreationTargetCurrent(
  submittedMenuId: string,
  routeMenuId: string,
  workingMenuId: string | undefined
) {
  return Boolean(submittedMenuId)
    && submittedMenuId === routeMenuId
    && submittedMenuId === workingMenuId
}

export type SiteMenuCreateNavigationIdentity = {
  token: number
  originRoute: string
}

export function shouldApplySiteMenuCreateNavigation(
  request: SiteMenuCreateNavigationIdentity,
  latestToken: number,
  currentRoute: string
) {
  return request.token === latestToken && request.originRoute === currentRoute
}

export function shouldEmitDeferredSiteMenuCreation(
  active: boolean,
  scheduledGeneration: number,
  currentGeneration: number
) {
  return active && scheduledGeneration === currentGeneration
}

export function focusSiteMenuEditor(menuId: string | undefined, target: 'name' | 'heading') {
  const editor = menuId ? elementWithDataValue('data-menu-editor-id', menuId) : undefined
  const preferred = editor?.querySelector<HTMLElement>(
    target === 'name' ? '[data-menu-name-input]' : '[data-menu-editor-heading]'
  )
  const fallback = editor?.querySelector<HTMLElement>('[data-menu-editor-heading]')
    ?? document.querySelector<HTMLElement>('[data-menu-selector-heading]')
  const focusTarget = preferred ?? fallback
  if (!focusTarget) return false
  focusTarget.focus()
  return true
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function responsePayload(error: unknown) {
  const response = objectField(error, 'data')
  return objectField(response, 'data') ?? response
}

export function siteMenuUsageFromFetchError(error: unknown): SiteMenuUsage[] | null {
  const usage = objectField(responsePayload(error), 'usage')
  if (!Array.isArray(usage)) return null
  const parsed = usage.flatMap((item): SiteMenuUsage[] => {
    const resourceType = objectField(item, 'resourceType')
    const resourceId = objectField(item, 'resourceId')
    const label = objectField(item, 'label')
    if ((resourceType !== 'public-site-shell' && resourceType !== 'site-layout')
      || typeof resourceId !== 'string' || typeof label !== 'string') return []
    return [{ resourceType, resourceId, label }]
  })
  return parsed
}

export function siteMenuValidationIssuesFromFetchError(error: unknown): SiteMenuValidationIssue[] {
  const issues = objectField(responsePayload(error), 'issues')
  if (!Array.isArray(issues)) return []
  return issues.flatMap((item): SiteMenuValidationIssue[] => {
    const path = objectField(item, 'path')
    const message = objectField(item, 'message')
    return typeof path === 'string' && typeof message === 'string' ? [{ path, message }] : []
  })
}

export function validationMessageForPath(issues: readonly SiteMenuValidationIssue[], path: string) {
  return issues.find(issue => issue.path === path)?.message
}

export function focusFirstSiteMenuValidationIssue(issues: readonly SiteMenuValidationIssue[]) {
  const controls = document.querySelectorAll<HTMLElement>('[data-validation-path]')
  for (const issue of issues) {
    const control = [...controls].find(candidate => candidate.dataset.validationPath === issue.path)
      ?? [...controls].find(candidate => candidate.dataset.validationPath?.startsWith(`${issue.path}.`))
    if (!control) continue
    control.focus()
    return true
  }
  return false
}
