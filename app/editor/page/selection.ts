import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import type { ResolvedPos } from '@tiptap/pm/model'
import { AllSelection, NodeSelection } from '@tiptap/pm/state'

const isValidGapCursor = (GapCursor as typeof GapCursor & {
  valid: (position: ResolvedPos) => boolean
}).valid

export function clearPageBlockSelection(editor: Editor) {
  const selection = editor.state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'pageBlock') return false

  const before = editor.state.doc.resolve(selection.from)
  const after = editor.state.doc.resolve(selection.to)
  const nextSelection = isValidGapCursor(before)
    ? new GapCursor(before)
    : isValidGapCursor(after)
      ? new GapCursor(after)
      : new AllSelection(editor.state.doc)
  editor.view.dispatch(editor.state.tr.setSelection(nextSelection))
  return true
}
