// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { mapEditorItems } from '@nuxt/ui/utils/editor'
import { afterEach, describe, expect, it } from 'vitest'

import PageBlock from '../app/editor/page/PageBlock'
import PageHero from '../app/editor/page/PageHero'
import { pageLibraryInsertionPosition } from '../app/editor/page/insertion'
import PagePattern from '../app/editor/page/PagePattern'
import { clearPageBlockSelection } from '../app/editor/page/selection'
import type { PageBlockAttrs, PageBlockComponentKey } from '../app/editor/page/types'
import { createPageProfile } from '../app/editor/profiles'
import ImageUpload from '../app/editor/RichEditorImageUpload'
import { clonePagePatternContent, pagePatternKeys } from '../shared/page-patterns'

const editors: Editor[] = []
const testStarterKit = StarterKit.configure({ trailingNode: false })
const testTextAlign = TextAlign.configure({ types: ['heading', 'paragraph'] })

function block(component: PageBlockComponentKey, title: string) {
  return {
    type: 'pageBlock',
    attrs: {
      component,
      props: { title },
      advanced: {},
      media: { url: '', alt: '' }
    }
  }
}

function createEditor(components: PageBlockComponentKey[] = ['pageHero', 'pageCard', 'pageCTA']) {
  const editor = new Editor({
    extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
    content: {
      type: 'doc',
      content: components.map(component => block(component, component))
    }
  })
  editors.push(editor)
  return editor
}

function positionAt(editor: Editor, index: number) {
  let position = -1
  editor.state.doc.forEach((_node, offset, childIndex) => {
    if (childIndex === index) position = offset
  })
  if (position < 0) throw new Error(`Missing document child ${index}`)
  return position
}

function selectAt(editor: Editor, index: number) {
  editor.commands.setNodeSelection(positionAt(editor, index))
}

function components(editor: Editor) {
  return (editor.getJSON().content ?? []).map(node => node.attrs?.component)
}

function titleAt(editor: Editor, index: number) {
  return (editor.getJSON().content?.[index]?.attrs?.props as { title?: string } | undefined)?.title
}

function expectSingleTransaction(editor: Editor, action: () => boolean) {
  let transactions = 0
  const handler = () => {
    transactions += 1
  }
  editor.on('transaction', handler)
  expect(action()).toBe(true)
  editor.off('transaction', handler)
  expect(transactions).toBe(1)
}

function dragMenuItems(editor: Editor, index: number) {
  const pos = positionAt(editor, index)
  const node = editor.state.doc.nodeAt(pos)
  if (!node) throw new Error(`Missing node at ${pos}`)
  const profile = createPageProfile()
  const groups = profile.quickMenuGroups.flatMap(create => create({
    editor,
    node: node.toJSON(),
    pos
  }))
  return mapEditorItems(editor, groups as any, profile.handlers) as any[][]
}

function dragMenuAction(editor: Editor, index: number, label: string) {
  const items = dragMenuItems(editor, index).flat()
  const matches = items.filter(item => item.label === label)
  expect(matches).toHaveLength(1)
  return matches[0]
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

describe('page block transaction commands', () => {
  it('accepts every shipped definition through the exact Page schema', () => {
    for (const key of pagePatternKeys) {
      const editor = createEditor(['pageCTA'])
      expect(editor.commands.insertPagePatternAt(0, clonePagePatternContent(key)), key).toBe(true)
      expect(editor.commands.undo(), key).toBe(true)
      expect(components(editor), key).toEqual(['pageCTA'])
    }
  })

  it('inserts registered blocks at exact top-level positions and selects the insertion', () => {
    const editor = createEditor(['pageHero', 'pageCTA'])
    const attrs: PageBlockAttrs & { component: PageBlockComponentKey } = {
      component: 'pageCard',
      props: { title: 'Inserted card' },
      advanced: {},
      media: { url: '', alt: '' }
    }

    expectSingleTransaction(editor, () => editor.commands.insertPageBlockAt(positionAt(editor, 1), attrs))

    expect(components(editor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])
    expect(titleAt(editor, 1)).toBe('Inserted card')
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(positionAt(editor, 1))
    expect(editor.commands.undo()).toBe(true)
    expect(components(editor)).toEqual(['pageHero', 'pageCTA'])
  })

  it('inserts a mixed pattern in one transaction, places a text caret, and removes it with one undo', () => {
    const editor = createEditor(['pageHero', 'pageCTA'])
    const pattern = clonePagePatternContent('testimonial-social-proof')
    const destination = positionAt(editor, 1)

    expectSingleTransaction(editor, () => editor.commands.insertPagePatternAt(destination, pattern))

    expect((editor.getJSON().content ?? []).map(node => node.type)).toEqual([
      'pageBlock', 'blockquote', 'paragraph', 'pageBlock', 'pageBlock'
    ])
    expect(components(editor)).toEqual(['pageHero', undefined, undefined, 'pageLogos', 'pageCTA'])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.commands.undo()).toBe(true)
    expect(components(editor)).toEqual(['pageHero', 'pageCTA'])
    expect(pattern).toEqual(clonePagePatternContent('testimonial-social-proof'))
  })

  it('inserts a non-atomic Hero and edits its heading with normal text and mark commands', () => {
    const editor = createEditor(['pageHero'])
    expect(editor.commands.insertPagePatternAt(editor.state.doc.content.size, clonePagePatternContent('centered-hero'))).toBe(true)

    const inserted = editor.getJSON().content?.[1]
    expect(inserted).toMatchObject({
      type: 'pageHero',
      attrs: { orientation: 'vertical', reverse: false }
    })
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.$from.parent.type.name).toBe('heading')
    expect(editor.state.selection.$from.node(1).type.name).toBe('pageHero')

    expect(editor.chain().toggleBold().insertContent('Editable ').run()).toBe(true)
    expect(editor.getJSON().content?.[1]?.content?.[0]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Editable ',
      marks: [{ type: 'bold' }]
    })
  })

  it('inserts after a whole selected editable unit instead of at the document end', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [...clonePagePatternContent('centered-hero'), block('pageCTA', 'Closing')]
      }
    })
    editors.push(editor)
    editor.commands.setNodeSelection(positionAt(editor, 0))

    const destination = pageLibraryInsertionPosition(editor.state)
    expect(destination).toBe(positionAt(editor, 1))
    expect(editor.commands.insertPagePatternAt(destination, clonePagePatternContent('closing-cta'))).toBe(true)
    expect((editor.getJSON().content ?? []).map(node => node.type)).toEqual([
      'pageHero', 'heading', 'paragraph', 'paragraph', 'pageBlock'
    ])
  })

  it('uses the live Page schema to reject malformed nesting and unknown nodes without mutation', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] }
    })
    editors.push(editor)
    const before = editor.getJSON()
    const malformed = clonePagePatternContent('centered-hero') as any
    malformed[0].attrs.class = 'fixed inset-0'
    const unknownAttrs = clonePagePatternContent('feature-grid') as any
    unknownAttrs[0].attrs.futureRuntimeKey = 'unknown'
    const invalidNesting = clonePagePatternContent('centered-hero') as any
    invalidNesting[0].content = [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Missing required copy' }] }]

    expect(editor.commands.insertPagePatternAt(0, malformed)).toBe(false)
    expect(editor.commands.insertPagePatternAt(0, unknownAttrs)).toBe(false)
    expect(editor.commands.insertPagePatternAt(0, invalidNesting)).toBe(false)
    expect(editor.commands.insertPagePatternAt(0, [{ type: 'remotePatternWidget' }] as any)).toBe(false)
    expect(editor.commands.insertPagePatternAt(1, clonePagePatternContent('centered-hero'))).toBe(false)
    expect(editor.commands.insertPagePatternAt(0, [])).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('updates Hero structure without flattening child content or losing the nested caret', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: { type: 'doc', content: clonePagePatternContent('centered-hero') }
    })
    editors.push(editor)
    editor.commands.setTextSelection(2)
    const before = structuredClone(editor.getJSON().content?.[0]?.content)

    expectSingleTransaction(editor, () => editor.commands.updatePageHeroAttributes({
      orientation: 'horizontal',
      reverse: true
    }))

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'pageHero',
      attrs: { orientation: 'horizontal', reverse: true },
      content: before
    })
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.$from.node(1).type.name).toBe('pageHero')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ orientation: 'vertical', reverse: false })
  })

  it('accepts the normal Image upload node at the end of editable Hero content', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: { type: 'doc', content: clonePagePatternContent('centered-hero') }
    })
    editors.push(editor)
    let lastParagraphEnd = -1
    editor.state.doc.descendants((node, pos, parent) => {
      if (node.type.name === 'paragraph' && parent?.type.name === 'pageHero') {
        lastParagraphEnd = pos + node.nodeSize - 1
      }
    })
    expect(lastParagraphEnd).toBeGreaterThan(0)
    editor.commands.setTextSelection(lastParagraphEnd)

    expectSingleTransaction(editor, () => editor.commands.insertImageUpload())

    expect(editor.getJSON().content?.[0]?.content?.at(-1)?.type).toBe('imageUpload')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.at(-1)?.type).toBe('paragraph')
  })

  it('resolves a Hero upload through the normal Image replacement transaction', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: { type: 'doc', content: clonePagePatternContent('split-hero') }
    })
    editors.push(editor)
    let uploadPosition = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'imageUpload') uploadPosition = pos
    })
    expect(uploadPosition).toBeGreaterThan(0)

    expectSingleTransaction(editor, () => editor.chain()
      .deleteRange({ from: uploadPosition, to: uploadPosition + 1 })
      .setImage({ src: '/assets/review-image/raw', alt: 'Resolved Hero image' })
      .run())

    expect(editor.getJSON().content?.[0]?.content?.at(-1)).toMatchObject({
      type: 'image',
      attrs: { src: '/assets/review-image/raw', alt: 'Resolved Hero image' }
    })
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.at(-1)?.type).toBe('imageUpload')
  })

  it('converts a legacy Hero explicitly in one lossless transaction and supports undo', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: {
              headline: 'Eyebrow',
              title: 'Legacy title',
              description: 'Legacy description',
              orientation: 'horizontal',
              reverse: true,
              links: [{ label: 'Read more', to: '#more' }]
            },
            advanced: {},
            media: { url: '/assets/hero/raw', alt: 'Hero image' }
          }
        }]
      }
    })
    editors.push(editor)
    selectAt(editor, 0)

    expectSingleTransaction(editor, () => editor.commands.convertLegacyPageHeroBlock())

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'pageHero',
      attrs: { orientation: 'horizontal', reverse: true }
    })
    expect(editor.state.doc.nodeAt(0)?.textContent).toContain('EyebrowLegacy titleLegacy descriptionRead more')
    expect(editor.getJSON().content?.[0]?.content?.at(-1)).toMatchObject({
      type: 'image',
      attrs: { src: '/assets/hero/raw', alt: 'Hero image' }
    })
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'pageBlock',
      attrs: { component: 'pageHero' }
    })
  })

  it('blocks legacy Hero conversion when advanced data would be lost', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: { title: 'Legacy title' },
            advanced: { custom: true },
            media: {}
          }
        }]
      }
    })
    editors.push(editor)
    selectAt(editor, 0)
    const before = editor.getJSON()

    expect(editor.commands.convertLegacyPageHeroBlock()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it.each([
    {
      label: 'action presentation',
      props: { title: 'Legacy title', links: [{ label: 'Go', to: '#go', variant: 'solid' }] },
      media: {}
    },
    {
      label: 'unknown properties',
      props: { title: 'Legacy title', futureValue: 'retain me' },
      media: {}
    },
    {
      label: 'media workflow data',
      props: { title: 'Legacy title' },
      media: { requiredAction: 'Upload an image later' }
    }
  ])('blocks legacy Hero conversion when $label would be lost', ({ props, media }) => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: { component: 'pageHero', props, advanced: {}, media }
        }]
      }
    })
    editors.push(editor)
    selectAt(editor, 0)
    const before = editor.getJSON()

    expect(editor.commands.convertLegacyPageHeroBlock()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('preserves empty legacy Hero text without inventing replacement copy', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [{
          type: 'pageBlock',
          attrs: {
            component: 'pageHero',
            props: { title: '', description: '' },
            advanced: {},
            media: {}
          }
        }]
      }
    })
    editors.push(editor)
    selectAt(editor, 0)

    expect(editor.commands.convertLegacyPageHeroBlock()).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'pageHero',
      content: [{ type: 'heading' }, { type: 'paragraph' }]
    })
    expect(editor.state.doc.nodeAt(0)?.textContent).toBe('')
  })

  it('rejects unknown component keys and non-top-level insertion positions', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }]
      }
    })
    editors.push(editor)
    const before = editor.getJSON()
    const attrs = {
      component: 'retiredBlock',
      props: {},
      advanced: {},
      media: {}
    } as any

    expect(editor.commands.insertPageBlockAt(0, attrs)).toBe(false)
    expect(editor.commands.insertPageBlockAt(1, { ...attrs, component: 'pageHero' })).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('duplicates the live selected block, selects the copy, and undoes in one step', () => {
    const editor = createEditor()
    selectAt(editor, 1)

    expectSingleTransaction(editor, () => editor.commands.duplicatePageBlock())

    expect(components(editor)).toEqual(['pageHero', 'pageCard', 'pageCard', 'pageCTA'])
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(positionAt(editor, 2))
    expect(editor.commands.undo()).toBe(true)
    expect(components(editor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])
  })

  it('deletes the live selected block and selects a neighboring page block', () => {
    const editor = createEditor()
    selectAt(editor, 1)

    expectSingleTransaction(editor, () => editor.commands.deletePageBlock())

    expect(components(editor)).toEqual(['pageHero', 'pageCTA'])
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(positionAt(editor, 1))
    expect(editor.commands.undo()).toBe(true)
    expect(components(editor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])

    selectAt(editor, 2)
    expect(editor.commands.deletePageBlock()).toBe(true)
    expect(editor.state.selection.from).toBe(positionAt(editor, 1))
  })

  it('moves the live selected block in either direction with stable selection', () => {
    const editor = createEditor()
    selectAt(editor, 1)

    expectSingleTransaction(editor, () => editor.commands.movePageBlockUp())
    expect(components(editor)).toEqual(['pageCard', 'pageHero', 'pageCTA'])
    expect(editor.state.selection.from).toBe(positionAt(editor, 0))
    expect(editor.commands.undo()).toBe(true)

    selectAt(editor, 1)
    expectSingleTransaction(editor, () => editor.commands.movePageBlockDown())
    expect(components(editor)).toEqual(['pageHero', 'pageCTA', 'pageCard'])
    expect(editor.state.selection.from).toBe(positionAt(editor, 2))
    expect(editor.commands.undo()).toBe(true)
    expect(components(editor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])
  })

  it('updates selected block attributes without using a cached position', () => {
    const editor = createEditor()
    selectAt(editor, 2)

    expectSingleTransaction(editor, () => editor.commands.updatePageBlockAttributes({
      props: { title: 'Updated CTA' }
    }))

    expect(titleAt(editor, 2)).toBe('Updated CTA')
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(positionAt(editor, 2))
    expect(editor.commands.undo()).toBe(true)
    expect(titleAt(editor, 2)).toBe('pageCTA')
  })

  it('clears an atomic page-block selection without mutating content', () => {
    const editor = createEditor()
    selectAt(editor, 1)
    const before = editor.getJSON()

    expect(clearPageBlockSelection(editor)).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(GapCursor)
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.getJSON()).toEqual(before)
    expect(clearPageBlockSelection(editor)).toBe(false)
  })

  it('emits selectionUpdate synchronously when a page block is selected', () => {
    const editor = createEditor()
    selectAt(editor, 1)
    expect(clearPageBlockSelection(editor)).toBe(true)
    let selectionUpdates = 0
    editor.on('selectionUpdate', () => selectionUpdates++)

    expect(editor.commands.setNodeSelection(positionAt(editor, 1))).toBe(true)
    expect(selectionUpdates).toBe(1)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('targets the clicked drag-handle position with one built-in action each', () => {
    const duplicateEditor = createEditor()
    const pageBlockItems = dragMenuItems(duplicateEditor, 1).flat()
    expect(pageBlockItems.map(item => item.label)).not.toContain('Turn into')
    expect(pageBlockItems.map(item => item.label)).not.toContain('Reset formatting')
    expect(pageBlockItems.map(item => item.label)).toEqual(expect.arrayContaining([
      'Duplicate', 'Copy to clipboard', 'Move up', 'Move down', 'Delete'
    ]))
    selectAt(duplicateEditor, 0)
    dragMenuAction(duplicateEditor, 1, 'Duplicate').onSelect()
    expect(components(duplicateEditor)).toEqual(['pageHero', 'pageCard', 'pageCard', 'pageCTA'])
    expect(duplicateEditor.state.selection).toBeInstanceOf(NodeSelection)
    expect(duplicateEditor.state.selection.from).toBe(positionAt(duplicateEditor, 2))
    expect(duplicateEditor.commands.undo()).toBe(true)
    expect(components(duplicateEditor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])

    const moveEditor = createEditor()
    expect(dragMenuAction(moveEditor, 0, 'Move up').disabled).toBe(true)
    expect(dragMenuAction(moveEditor, 2, 'Move down').disabled).toBe(true)
    dragMenuAction(moveEditor, 1, 'Move up').onSelect()
    expect(components(moveEditor)).toEqual(['pageCard', 'pageHero', 'pageCTA'])
    expect(moveEditor.state.selection.from).toBe(positionAt(moveEditor, 0))
    expect(moveEditor.commands.undo()).toBe(true)
    dragMenuAction(moveEditor, 1, 'Move down').onSelect()
    expect(components(moveEditor)).toEqual(['pageHero', 'pageCTA', 'pageCard'])
    expect(moveEditor.state.selection.from).toBe(positionAt(moveEditor, 2))
    expect(moveEditor.commands.undo()).toBe(true)

    const deleteEditor = createEditor()
    dragMenuAction(deleteEditor, 1, 'Delete').onSelect()
    expect(components(deleteEditor)).toEqual(['pageHero', 'pageCTA'])
    expect(deleteEditor.state.selection).toBeInstanceOf(NodeSelection)
    expect(deleteEditor.state.selection.from).toBe(positionAt(deleteEditor, 0))
    expect(deleteEditor.commands.undo()).toBe(true)
    expect(components(deleteEditor)).toEqual(['pageHero', 'pageCard', 'pageCTA'])
  })

  it('keeps whole-unit duplicate, move, and delete actions for editable Heroes', () => {
    const editor = new Editor({
      extensions: [testStarterKit, testTextAlign, Image, ImageUpload, PagePattern, PageHero, PageBlock],
      content: {
        type: 'doc',
        content: [...clonePagePatternContent('centered-hero'), block('pageCTA', 'Closing')]
      }
    })
    editors.push(editor)

    dragMenuAction(editor, 0, 'Duplicate').onSelect()
    expect((editor.getJSON().content ?? []).map(node => node.type)).toEqual(['pageHero', 'pageHero', 'pageBlock'])
    dragMenuAction(editor, 1, 'Move down').onSelect()
    expect((editor.getJSON().content ?? []).map(node => node.type)).toEqual(['pageHero', 'pageBlock', 'pageHero'])
    dragMenuAction(editor, 2, 'Delete').onSelect()
    expect((editor.getJSON().content ?? []).map(node => node.type)).toEqual(['pageHero', 'pageBlock'])
  })

  it('rejects commands without a registered page-block NodeSelection', () => {
    const editor = createEditor(['pageHero'])
    const before = editor.getJSON()
    editor.commands.selectAll()

    expect(editor.commands.duplicatePageBlock()).toBe(false)
    expect(editor.commands.deletePageBlock()).toBe(false)
    expect(editor.commands.movePageBlockUp()).toBe(false)
    expect(editor.commands.movePageBlockDown()).toBe(false)
    expect(editor.commands.updatePageBlockAttributes({ component: 'retiredBlock' } as any)).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })
})
