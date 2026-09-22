import type { Editor } from '@tiptap/core'

function scrollPageNodeIntoView(editor: Editor, position: number, accepts: (nodeType: string) => boolean) {
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return
    const node = editor.state.doc.nodeAt(position)
    if (!node || !accepts(node.type.name)) return

    const element = editor.view.nodeDOM(position)
    if (!(element instanceof HTMLElement)) return
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

export function scrollPageContentIntoView(editor: Editor, position: number) {
  scrollPageNodeIntoView(editor, position, () => true)
}

export function scrollPageBlockIntoView(editor: Editor, position: number) {
  scrollPageNodeIntoView(editor, position, nodeType => nodeType === 'pageBlock')
}
