import { badRequest, conflict } from '../utils/http'

export type EditorialStatus = 'draft' | 'published' | 'archived' | 'deleted'
export type EditorialTransition = 'save' | 'publish' | 'discard' | 'archive' | 'delete' | 'recover' | 'restore'

const allowed: Record<EditorialTransition, EditorialStatus[]> = {
  save: ['draft', 'published', 'archived'],
  publish: ['draft', 'published', 'archived'],
  discard: ['draft', 'archived'],
  archive: ['draft', 'published', 'archived'],
  delete: ['draft', 'published', 'archived'],
  recover: ['deleted'],
  restore: ['draft', 'published', 'archived', 'deleted']
}

export function parseEditorialStatus(value: unknown): EditorialStatus {
  if (!['draft', 'published', 'archived', 'deleted'].includes(String(value))) {
    throw badRequest('Invalid publication status')
  }
  return value as EditorialStatus
}

export function assertEditorialTransition(status: unknown, transition: EditorialTransition) {
  const current = parseEditorialStatus(status)
  if (!allowed[transition].includes(current)) {
    throw conflict(`Cannot ${transition} a ${current} document`)
  }
  return current
}

export function assertDraftWriteStatus(status: unknown) {
  if (status !== undefined && status !== 'draft') {
    throw badRequest('Use an explicit publication transition endpoint')
  }
}
