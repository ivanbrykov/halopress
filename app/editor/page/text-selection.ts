import type { Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

export function selectFirstEditableTextblock(
  tr: Transaction,
  from: number,
  to: number
) {
  let position: number | null = null
  tr.doc.nodesBetween(from, Math.min(to, tr.doc.content.size), (node, pos) => {
    if (position !== null) return false
    if (!node.isTextblock) return true
    position = Math.min(pos + 1, tr.doc.content.size)
    return false
  })
  if (position === null) return false
  tr.setSelection(TextSelection.near(tr.doc.resolve(position), 1))
  return true
}
