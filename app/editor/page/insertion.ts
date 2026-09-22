import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { NodeSelection } from '@tiptap/pm/state'

export function focusPageLibraryInsertion(editor: Editor | null) {
  editor?.view.focus()
}

export function pageLibraryInsertionPosition(state: EditorState) {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.$from.depth === 0) return selection.to
  if (selection.$from.depth > 0) return selection.$from.after(1)
  if (selection.empty) return selection.from
  return state.doc.content.size
}
