import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, type EditorState } from '@tiptap/pm/state'
import { isPageBlockComponentKey } from '~~/shared/page-blocks'
import type { PageBlockAttrs, PageBlockComponentKey } from './types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBlock: {
      insertPageBlock: (attrs: Partial<PageBlockAttrs> & { component: PageBlockComponentKey }) => ReturnType
      insertPageBlockAt: (
        position: number,
        attrs: Partial<PageBlockAttrs> & { component: PageBlockComponentKey }
      ) => ReturnType
      duplicatePageBlock: () => ReturnType
      deletePageBlock: () => ReturnType
      movePageBlockUp: () => ReturnType
      movePageBlockDown: () => ReturnType
      updatePageBlockAttributes: (attrs: Partial<PageBlockAttrs>) => ReturnType
    }
  }
}

function hasRegisteredComponent(node: ProseMirrorNode) {
  return isPageBlockComponentKey(node.attrs.component)
}

function isTopLevelPosition(doc: ProseMirrorNode, position: number) {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return false
  return doc.resolve(position).depth === 0
}

function selectedPageBlock(state: EditorState, name: string) {
  const selection = state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return null
  if (selection.$from.depth !== 0 || !hasRegisteredComponent(selection.node)) return null
  return { node: selection.node, position: selection.from }
}

export default Node.create({
  name: 'pageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      component: { default: 'pageHero' },
      props: { default: {} },
      advanced: { default: {} },
      media: { default: { url: '', alt: '' } }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-block"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-block' })]
  },
  addCommands() {
    return {
      insertPageBlock: (attrs) => ({ commands }) => {
        if (!isPageBlockComponentKey(attrs.component)) return false
        return commands.insertContent({ type: this.name, attrs })
      },
      insertPageBlockAt: (position, attrs) => ({ state, tr, dispatch }) => {
        if (!isPageBlockComponentKey(attrs.component) || !isTopLevelPosition(state.doc, position)) return false
        const nodeType = state.schema.nodes[this.name]
        if (!nodeType) return false

        if (dispatch) {
          tr.insert(position, nodeType.create(attrs))
          tr.setSelection(NodeSelection.create(tr.doc, position))
        }
        return true
      },
      duplicatePageBlock: () => ({ state, tr, dispatch }) => {
        const selected = selectedPageBlock(state, this.name)
        if (!selected) return false
        const duplicatePosition = selected.position + selected.node.nodeSize

        if (dispatch) {
          tr.insert(duplicatePosition, selected.node.copy(selected.node.content))
          tr.setSelection(NodeSelection.create(tr.doc, duplicatePosition))
        }
        return true
      },
      deletePageBlock: () => ({ state, tr, dispatch }) => {
        const selected = selectedPageBlock(state, this.name)
        if (!selected) return false
        const previous = state.doc.resolve(selected.position).nodeBefore
        const nextPosition = selected.position + selected.node.nodeSize
        const next = state.doc.resolve(nextPosition).nodeAfter

        if (dispatch) {
          tr.delete(selected.position, nextPosition)
          if (next?.type.name === this.name && tr.doc.nodeAt(selected.position)?.type.name === this.name) {
            tr.setSelection(NodeSelection.create(tr.doc, selected.position))
          } else if (previous?.type.name === this.name) {
            tr.setSelection(NodeSelection.create(tr.doc, selected.position - previous.nodeSize))
          } else {
            const fallback = Math.min(selected.position, tr.doc.content.size)
            tr.setSelection(Selection.near(tr.doc.resolve(fallback), -1))
          }
        }
        return true
      },
      movePageBlockUp: () => ({ state, tr, dispatch }) => {
        const selected = selectedPageBlock(state, this.name)
        if (!selected) return false
        const previous = state.doc.resolve(selected.position).nodeBefore
        if (!previous) return false
        const destination = selected.position - previous.nodeSize

        if (dispatch) {
          tr.delete(selected.position, selected.position + selected.node.nodeSize)
          tr.insert(destination, selected.node)
          tr.setSelection(NodeSelection.create(tr.doc, destination))
        }
        return true
      },
      movePageBlockDown: () => ({ state, tr, dispatch }) => {
        const selected = selectedPageBlock(state, this.name)
        if (!selected) return false
        const nextPosition = selected.position + selected.node.nodeSize
        const next = state.doc.resolve(nextPosition).nodeAfter
        if (!next) return false
        const destination = selected.position + next.nodeSize

        if (dispatch) {
          tr.delete(selected.position, nextPosition)
          tr.insert(destination, selected.node)
          tr.setSelection(NodeSelection.create(tr.doc, destination))
        }
        return true
      },
      updatePageBlockAttributes: (attrs) => ({ state, tr, dispatch }) => {
        const selected = selectedPageBlock(state, this.name)
        if (!selected) return false
        const nextAttrs = { ...selected.node.attrs, ...attrs }
        if (!isPageBlockComponentKey(nextAttrs.component)) return false

        if (dispatch) {
          tr.setNodeMarkup(selected.position, undefined, nextAttrs, selected.node.marks)
          tr.setSelection(NodeSelection.create(tr.doc, selected.position))
        }
        return true
      }
    }
  }
})
