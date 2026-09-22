import { badRequest } from '../utils/http'
import { validatePageDocumentBlocks } from '~~/shared/page-blocks'
import {
  validatePageDocumentForPublication,
  validatePageDocumentHeroes
} from '../../app/editor/page/validation'

export const emptyPageDocument = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Read stored documents without applying current publish-time block validation.
 * Historical/retired blocks stay intact in the raw API projection and are
 * handled by deterministic portable-renderer fallbacks.
 */
export function parseStoredPageContent(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? structuredClone(emptyPageDocument)
  try {
    return JSON.parse(value)
  } catch {
    return structuredClone(emptyPageDocument)
  }
}

export function normalizePageContent(
  value: unknown,
  options: { mode?: 'draft' | 'publish' } = {}
): Record<string, unknown> {
  if (value == null) return structuredClone(emptyPageDocument)
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw badRequest('Invalid content JSON')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest('Invalid content JSON')
  const document = parsed as Record<string, unknown>
  if (document.type !== 'doc') throw badRequest('Page content must be a Tiptap document')
  if (document.content !== undefined && !Array.isArray(document.content)) throw badRequest('Invalid page content')

  if (options.mode === 'publish') {
    const issues = validatePageDocumentForPublication(document)
    if (issues.length) throw badRequest(issues[0]!.message)
  } else {
    const issues = validatePageDocumentBlocks(document, { allowUnknown: true })
    if (issues.length) throw badRequest(issues[0]!.message)
    const heroIssues = validatePageDocumentHeroes(document, { allowImageUpload: true })
    if (heroIssues.length) throw badRequest(heroIssues[0]!.message)
  }

  return document
}
