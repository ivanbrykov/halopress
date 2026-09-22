// @vitest-environment happy-dom

import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { scrollPageBlockIntoView } from '../app/editor/page/scroll'

function editorStub(options: {
  destroyed?: boolean
  nodeType?: string
  dom?: Node | null
}) {
  return {
    isDestroyed: options.destroyed ?? false,
    state: {
      doc: {
        nodeAt: vi.fn(() => options.nodeType === undefined
          ? { type: { name: 'pageBlock' } }
          : { type: { name: options.nodeType } })
      }
    },
    view: {
      nodeDOM: vi.fn(() => options.dom ?? null)
    }
  } as unknown as Editor
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('scrollPageBlockIntoView', () => {
  it('reveals the inserted page block on the next animation frame', () => {
    const element = document.createElement('div')
    element.scrollIntoView = vi.fn()
    const editor = editorStub({ dom: element })
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })

    scrollPageBlockIntoView(editor, 12)

    expect(frame).toHaveBeenCalledOnce()
    expect(editor.state.doc.nodeAt).toHaveBeenCalledWith(12)
    expect(editor.view.nodeDOM).toHaveBeenCalledWith(12)
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('does nothing when the editor was destroyed or the position is no longer a page block', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const destroyed = editorStub({ destroyed: true })
    const paragraph = editorStub({ nodeType: 'paragraph' })

    scrollPageBlockIntoView(destroyed, 4)
    scrollPageBlockIntoView(paragraph, 8)

    expect(destroyed.state.doc.nodeAt).not.toHaveBeenCalled()
    expect(paragraph.view.nodeDOM).not.toHaveBeenCalled()
  })

  it('ignores non-element node views', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const editor = editorStub({ dom: document.createTextNode('page block') })

    expect(() => scrollPageBlockIntoView(editor, 3)).not.toThrow()
  })
})
