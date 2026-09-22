import { Extension, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'

import { validatePagePatternContent } from '~~/shared/page-patterns'
import { selectFirstEditableTextblock } from './text-selection'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagePattern: {
      insertPagePatternAt: (position: number, nodes: JSONContent[]) => ReturnType
    }
  }
}

export function isTopLevelPagePosition(doc: ProseMirrorNode, position: number) {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return false
  return doc.resolve(position).depth === 0
}

function usesOnlySchemaAttributes(schema: ProseMirrorNode['type']['schema'], value: JSONContent): boolean {
  const type = value.type ? schema.nodes[value.type] : undefined
  if (!type) return false
  if (value.attrs && Object.keys(value.attrs).some(key => !Object.hasOwn(type.spec.attrs ?? {}, key))) return false
  if (value.marks?.some((mark) => {
    const markType = mark.type ? schema.marks[mark.type] : undefined
    return !markType || (mark.attrs && Object.keys(mark.attrs).some(key => !Object.hasOwn(markType.spec.attrs ?? {}, key)))
  })) return false
  return !value.content?.some(child => !usesOnlySchemaAttributes(schema, child))
}

export default Extension.create({
  name: 'pagePattern',
  addCommands() {
    return {
      insertPagePatternAt: (position, nodes) => ({ state, tr, dispatch }) => {
        if (!isTopLevelPagePosition(state.doc, position)) return false
        const validation = validatePagePatternContent(nodes)
        if (validation.issues.length) return false

        let fragment: Fragment
        try {
          const parsed = nodes.map((node) => {
            if (!usesOnlySchemaAttributes(state.schema, node)) throw new Error('Unknown schema attribute')
            const parsedNode = state.schema.nodeFromJSON(structuredClone(node))
            parsedNode.check()
            return parsedNode
          })
          fragment = Fragment.fromArray(parsed)
        } catch {
          return false
        }
        if (!fragment.size || !state.schema.topNodeType.validContent(fragment)) return false

        if (dispatch) {
          tr.insert(position, fragment)
          if (!selectFirstEditableTextblock(tr, position, position + fragment.size)) {
            const inserted = tr.doc.nodeAt(position)
            tr.setSelection(inserted?.type.spec.selectable !== false
              ? NodeSelection.create(tr.doc, position)
              : Selection.near(tr.doc.resolve(position), 1))
          }
        }
        return true
      }
    }
  }
})
