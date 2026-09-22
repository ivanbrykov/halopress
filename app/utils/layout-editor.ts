import {
  layoutElementRegistry,
  layoutElementSchema,
  moveLayoutElement,
  serializeLayoutDocument,
  type LayoutAdminResource,
  type LayoutDocument,
  type LayoutElement,
  type LayoutElementType,
  type LayoutRegionKey,
  type LayoutUsage,
  type LayoutValidationIssue
} from '~~/shared/site-layout'

export type LayoutEditorSelection = {
  regionId: LayoutRegionKey
  elementId?: string
}

export type LayoutEditorDropPayload =
  | { kind: 'palette', type: LayoutElementType }
  | { kind: 'element', elementId: string }

export type LayoutEditorSnapshot = {
  document: LayoutDocument
  selection: LayoutEditorSelection
}

export type LayoutEditorHistory = {
  past: LayoutEditorSnapshot[]
  current: LayoutEditorSnapshot
  future: LayoutEditorSnapshot[]
}

function cloneSnapshot(snapshot: LayoutEditorSnapshot): LayoutEditorSnapshot {
  return structuredClone(snapshot)
}

function snapshotIdentity(snapshot: LayoutEditorSnapshot) {
  return `${serializeLayoutDocument(snapshot.document)}\n${snapshot.selection.regionId}\n${snapshot.selection.elementId || ''}`
}

export function normalizeLayoutSelection(
  document: LayoutDocument,
  selection: LayoutEditorSelection
): LayoutEditorSelection {
  if (selection.elementId) {
    const element = document.elements.find(candidate => candidate.id === selection.elementId)
    if (element) return { regionId: element.region, elementId: element.id }
  }
  const regionId = document.grid.regions.some(region => region.id === selection.regionId)
    ? selection.regionId
    : document.grid.regions.find(region => region.id === 'content')?.id ?? document.grid.regions[0]!.id
  return { regionId }
}

export function createLayoutEditorHistory(
  document: LayoutDocument,
  selection: LayoutEditorSelection = { regionId: 'content' }
): LayoutEditorHistory {
  return {
    past: [],
    current: { document: structuredClone(document), selection: normalizeLayoutSelection(document, selection) },
    future: []
  }
}

export function commitLayoutEditorHistory(
  history: LayoutEditorHistory,
  document: LayoutDocument,
  selection: LayoutEditorSelection = history.current.selection
): LayoutEditorHistory {
  const next = {
    document: structuredClone(document),
    selection: normalizeLayoutSelection(document, selection)
  }
  if (snapshotIdentity(next) === snapshotIdentity(history.current)) return history
  return {
    past: [...history.past, cloneSnapshot(history.current)],
    current: next,
    future: []
  }
}

export function undoLayoutEditorHistory(history: LayoutEditorHistory): LayoutEditorHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    current: cloneSnapshot(previous),
    future: [cloneSnapshot(history.current), ...history.future]
  }
}

export function redoLayoutEditorHistory(history: LayoutEditorHistory): LayoutEditorHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, cloneSnapshot(history.current)],
    current: cloneSnapshot(next),
    future: history.future.slice(1)
  }
}

export function selectedLayoutElement(document: LayoutDocument, elementId?: string) {
  return elementId ? document.elements.find(element => element.id === elementId) ?? null : null
}

export function layoutElementsInRegion(document: LayoutDocument, regionId: LayoutRegionKey) {
  return document.elements
    .filter(element => element.region === regionId)
    .sort((left, right) => left.order - right.order)
}

export function nextLayoutSelectionAfterDelete(document: LayoutDocument, elementId: string): LayoutEditorSelection {
  const element = document.elements.find(candidate => candidate.id === elementId)
  if (!element) return { regionId: 'content' }
  const siblings = layoutElementsInRegion(document, element.region)
  const index = siblings.findIndex(candidate => candidate.id === elementId)
  const next = siblings[index + 1] ?? siblings[index - 1]
  return next ? { regionId: next.region, elementId: next.id } : { regionId: element.region }
}

export function moveLayoutElementOrNoop(
  document: LayoutDocument,
  elementId: string,
  targetRegion: LayoutRegionKey,
  targetIndex: number
) {
  try {
    return moveLayoutElement(document, elementId, targetRegion, targetIndex)
  } catch {
    return document
  }
}

/** Converts a visual before-item drop index into the helper's post-removal index. */
export function layoutElementDropIndex(
  document: LayoutDocument,
  elementId: string,
  targetRegion: LayoutRegionKey,
  visualIndex: number
) {
  const source = document.elements.find(element => element.id === elementId)
  if (!source || source.region !== targetRegion) return visualIndex
  const sourceIndex = layoutElementsInRegion(document, source.region)
    .findIndex(element => element.id === elementId)
  return sourceIndex >= 0 && sourceIndex < visualIndex ? visualIndex - 1 : visualIndex
}

export function createLayoutElement(
  type: LayoutElementType,
  region: LayoutRegionKey,
  id: string,
  menuSetId?: string
): LayoutElement {
  const descriptor = layoutElementRegistry[type]
  const props: Record<string, unknown> = structuredClone(descriptor.defaultProps)
  if (type === 'menu' && menuSetId) props.menuSetId = menuSetId
  return layoutElementSchema.parse({ id, type, region, order: 0, props })
}

export function allowedLayoutRegions(document: LayoutDocument, type: LayoutElementType) {
  const present = new Set(document.grid.regions.map(region => region.id))
  return layoutElementRegistry[type].allowedRegions.filter(region => present.has(region))
}

export function hasUsableLayoutMenuItems(items: readonly { disabled?: boolean }[]) {
  return items.some(item => !item.disabled)
}

export function isLayoutElementDropAllowed(
  document: LayoutDocument,
  payload: LayoutEditorDropPayload,
  targetRegion: LayoutRegionKey
) {
  if (!document.grid.regions.some(region => region.id === targetRegion)) return false
  if (payload.kind === 'palette') {
    return isLayoutElementTypeDropAllowed(document, payload.type, targetRegion, true)
  }
  const element = document.elements.find(candidate => candidate.id === payload.elementId)
  return Boolean(element && isLayoutElementTypeDropAllowed(document, element.type, targetRegion, false))
}

export function isLayoutElementTypeDropAllowed(
  document: LayoutDocument,
  type: LayoutElementType,
  targetRegion: LayoutRegionKey,
  fromPalette: boolean
) {
  if (!document.grid.regions.some(region => region.id === targetRegion)) return false
  const descriptor = layoutElementRegistry[type]
  return descriptor.allowedRegions.includes(targetRegion)
    && !(fromPalette && descriptor.required && document.elements.some(element => element.type === type))
}

export type LayoutMutationIdentity = {
  token: number
  layoutId: string
  revision: number
  snapshot: string
}

export function shouldApplyLayoutMutationResult(
  request: LayoutMutationIdentity,
  latestToken: number,
  routeLayoutId: string,
  workingLayoutId: string | undefined
) {
  return request.token === latestToken
    && request.layoutId === routeLayoutId
    && request.layoutId === workingLayoutId
}

export function shouldReplaceLayoutDraft(
  request: LayoutMutationIdentity,
  currentSnapshot: string
) {
  return request.snapshot === currentSnapshot
}

export function reconcileLayoutRenameState(
  currentName: string,
  request: Pick<LayoutMutationIdentity, 'snapshot'>,
  resource: Extract<LayoutAdminResource, { status: 'ready' }>,
  currentDocument: LayoutDocument
) {
  const document = structuredClone(currentDocument)
  document.name = resource.name
  return {
    workingName: currentName === request.snapshot ? resource.name : currentName,
    workingRevision: resource.revision,
    baselineName: resource.name,
    baselineDocument: serializeLayoutDocument(resource.document),
    document
  }
}

export type LayoutCreateNavigationIdentity = {
  token: number
  originRoute: string
}

export function shouldApplyLayoutCreateNavigation(
  request: LayoutCreateNavigationIdentity,
  latestToken: number,
  currentRoute: string
) {
  return request.token === latestToken && request.originRoute === currentRoute
}

export function shouldAcceptLayoutCreateOpenChange(isCreating: boolean, nextOpen: boolean) {
  return nextOpen || !isCreating
}

export function isCurrentLayoutResourceReady(
  requestStatus: string,
  pending: boolean,
  hasError: boolean,
  routeLayoutId: string,
  sourceLayoutId: string | undefined,
  workingLayoutId: string | undefined
) {
  return requestStatus === 'success'
    && !pending
    && !hasError
    && Boolean(routeLayoutId)
    && routeLayoutId === sourceLayoutId
    && routeLayoutId === workingLayoutId
}

export function afterLayoutOverlayFocusRestored(
  callback: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame
) {
  schedule(() => schedule(() => callback()))
}

function elementWithDataValue(attribute: string, value: string) {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find(candidate => candidate.getAttribute(attribute) === value)
}

export function focusLayoutCreateTrigger() {
  const trigger = document.querySelector<HTMLElement>('[data-layout-create-trigger]')
  trigger?.focus()
  return Boolean(trigger)
}

export function focusLayoutElement(elementId: string | undefined) {
  if (!elementId) return false
  const target = elementWithDataValue('data-layout-element-select', elementId)
  target?.focus()
  return Boolean(target)
}

export function focusLayoutMoveControl(elementId: string, direction: 'up' | 'down') {
  const controls = [...document.querySelectorAll<HTMLElement>('[data-layout-element-id][data-layout-move]')]
    .filter(candidate => candidate.dataset.layoutElementId === elementId)
  const preferred = controls.find(candidate => candidate.dataset.layoutMove === direction && !candidate.hasAttribute('disabled'))
  const target = preferred ?? controls.find(candidate => !candidate.hasAttribute('disabled'))
  target?.focus()
  return Boolean(target)
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function responsePayload(error: unknown) {
  const response = objectField(error, 'data')
  return objectField(response, 'data') ?? response
}

export function layoutValidationIssuesFromFetchError(error: unknown): LayoutValidationIssue[] {
  const issues = objectField(responsePayload(error), 'issues')
  if (!Array.isArray(issues)) return []
  return issues.flatMap((item): LayoutValidationIssue[] => {
    const path = objectField(item, 'path')
    const message = objectField(item, 'message')
    const kind = objectField(item, 'kind')
    return typeof path === 'string' && typeof message === 'string'
      ? [{ path, message, kind: kind === 'forbidden' ? 'forbidden' : 'invalid' }]
      : []
  })
}

export function layoutUsageFromFetchError(error: unknown): LayoutUsage[] | null {
  const usage = objectField(responsePayload(error), 'usage')
  if (!Array.isArray(usage)) return null
  return usage.flatMap((item): LayoutUsage[] => {
    const resourceType = objectField(item, 'resourceType')
    const resourceId = objectField(item, 'resourceId')
    const label = objectField(item, 'label')
    const behavior = objectField(item, 'behavior')
    if (!['site', 'schema', 'page', 'unknown'].includes(String(resourceType))
      || typeof resourceId !== 'string' || typeof label !== 'string') return []
    return [{
      resourceType: resourceType as LayoutUsage['resourceType'],
      resourceId,
      label,
      behavior: behavior === 'use-current' || behavior === 'missing-fallback' ? behavior : 'unknown'
    }]
  })
}

export function layoutStaleConflictFromFetchError(error: unknown) {
  const payload = responsePayload(error)
  const statusCode = objectField(error, 'statusCode') ?? objectField(objectField(error, 'response'), 'status')
  const currentRevision = objectField(payload, 'currentRevision')
  if (Number(statusCode) !== 409 || !Number.isInteger(currentRevision)) return null
  const updatedBy = objectField(payload, 'updatedBy')
  return {
    currentRevision: Number(currentRevision),
    updatedBy: typeof updatedBy === 'string' && updatedBy ? updatedBy : null
  }
}
