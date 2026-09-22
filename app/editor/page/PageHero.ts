import { Node, type JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'

import {
  convertLegacyPageHero,
  normalizePageHeroAttrs,
  type PageHeroAttrs
} from '~~/shared/page-hero'
import type { StoredPageBlockAttrs } from '~~/shared/page-blocks'
import { selectFirstEditableTextblock } from './text-selection'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageHero: {
      updatePageHeroAttributes: (attrs: Partial<PageHeroAttrs>) => ReturnType
      convertLegacyPageHeroBlock: () => ReturnType
    }
  }
}

export type SelectedPageHero = {
  node: ProseMirrorNode
  position: number
  attrs: PageHeroAttrs
}

export function selectedPageHero(state: EditorState): SelectedPageHero | null {
  const selection = state.selection
  if (selection instanceof NodeSelection && selection.node.type.name === 'pageHero') {
    const attrs = normalizePageHeroAttrs(selection.node.attrs)
    return attrs ? { node: selection.node, position: selection.from, attrs } : null
  }
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth)
    if (node.type.name !== 'pageHero') continue
    const attrs = normalizePageHeroAttrs(node.attrs)
    return attrs ? { node, position: selection.$from.before(depth), attrs } : null
  }
  return null
}

function selectedLegacyHero(state: EditorState) {
  const selection = state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'pageBlock') return null
  if (selection.$from.depth !== 0 || selection.node.attrs.component !== 'pageHero') return null
  return {
    node: selection.node,
    position: selection.from,
    attrs: selection.node.attrs as StoredPageBlockAttrs
  }
}

export default Node.create({
  name: 'pageHero',
  group: 'block',
  content: 'paragraph? heading paragraph+ (image | imageUpload)?',
  defining: true,
  isolating: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      orientation: { default: 'vertical' },
      reverse: { default: false }
    }
  },
  parseHTML() {
    return [{
      tag: 'section[data-type="page-hero"]',
      getAttrs: (element) => {
        const dataset = (element as { dataset?: Record<string, string | undefined> }).dataset
        return dataset
          ? {
              orientation: dataset.orientation === 'horizontal' ? 'horizontal' : 'vertical',
              reverse: dataset.reverse === 'true'
            }
          : false
      }
    }]
  },
  renderHTML({ node }) {
    const attrs = normalizePageHeroAttrs(node.attrs) ?? { orientation: 'vertical', reverse: false }
    return ['section', {
      'data-type': 'page-hero',
      'data-orientation': attrs.orientation,
      ...(attrs.reverse ? { 'data-reverse': 'true' } : {})
    }, 0]
  },
  addCommands() {
    return {
      updatePageHeroAttributes: attrs => ({ state, tr, dispatch }) => {
        const selected = selectedPageHero(state)
        if (!selected) return false
        const nextAttrs = normalizePageHeroAttrs({ ...selected.attrs, ...attrs })
        if (!nextAttrs) return false
        if (dispatch) tr.setNodeMarkup(selected.position, undefined, nextAttrs, selected.node.marks)
        return true
      },
      convertLegacyPageHeroBlock: () => ({ state, tr, dispatch }) => {
        const selected = selectedLegacyHero(state)
        if (!selected) return false
        const conversion = convertLegacyPageHero(selected.attrs)
        if (conversion.status !== 'ready') return false

        let replacement: ProseMirrorNode
        try {
          replacement = state.schema.nodeFromJSON(conversion.node as JSONContent)
        } catch {
          return false
        }
        if (replacement.type.name !== this.name) return false

        if (dispatch) {
          tr.replaceWith(selected.position, selected.position + selected.node.nodeSize, replacement)
          selectFirstEditableTextblock(tr, selected.position, selected.position + replacement.nodeSize)
        }
        return true
      }
    }
  }
})
