import { getSchema } from '@tiptap/core'

import { validatePageDocumentBlocks } from '~~/shared/page-blocks'
import { normalizePageHeroAttrs } from '~~/shared/page-hero'
import { createPageProfile } from '../profiles'

export type PageHeroValidationIssue = {
  path: string
  message: string
}

let pageSchema: ReturnType<typeof getSchema> | undefined

function exactPageSchema() {
  pageSchema ??= getSchema(createPageProfile().readOnlyExtensions)
  return pageSchema
}

function containsNodeType(value: unknown, type: string): boolean {
  if (Array.isArray(value)) return value.some(child => containsNodeType(child, type))
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  return node.type === type || containsNodeType(node.content, type)
}

export function validatePageDocumentHeroes(
  value: unknown,
  options: { allowImageUpload?: boolean } = {}
) {
  const issues: PageHeroValidationIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return issues
  const document = value as Record<string, any>
  if (!Array.isArray(document.content)) return issues

  const visit = (content: unknown[], path: string, topLevel: boolean) => {
    content.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
      const node = candidate as Record<string, any>
      const nodePath = `${path}.${index + 1}`
      if (node.type === 'pageHero') {
        if (!topLevel) {
          issues.push({ path: nodePath, message: 'Editable Hero units must be top-level Page content.' })
          return
        }
        if (!normalizePageHeroAttrs(node.attrs ?? {})) {
          issues.push({ path: nodePath, message: 'Editable Hero has invalid structural attributes.' })
          return
        }
        if (!options.allowImageUpload && containsNodeType(node.content, 'imageUpload')) {
          issues.push({ path: nodePath, message: 'Editable Hero has an unfinished image upload.' })
          return
        }
        try {
          const parsed = exactPageSchema().nodeFromJSON(node)
          parsed.check()
          if (parsed.type.name !== 'pageHero') throw new Error('Unexpected Page node')
        } catch {
          issues.push({ path: nodePath, message: 'Editable Hero has invalid child content.' })
        }
        return
      }
      if (Array.isArray(node.content)) visit(node.content, `${nodePath}.content`, false)
    })
  }

  visit(document.content, 'content', true)
  return issues
}

export function validatePageDocumentImageUploads(value: unknown) {
  return containsNodeType(value, 'imageUpload')
    ? [{ path: 'content', message: 'Page has an unfinished image upload.' } satisfies PageHeroValidationIssue]
    : []
}

export function validatePageDocumentForPublication(value: unknown) {
  return [
    ...validatePageDocumentBlocks(value),
    ...validatePageDocumentHeroes(value),
    ...validatePageDocumentImageUploads(value)
  ]
}
