import type { AnyExtension, Editor } from '@tiptap/core'
import { Node, mergeAttributes } from '@tiptap/core'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'

import ImageUpload from '../RichEditorImageUpload'
import { createEditorProfile } from './merge'
import type {
  EditorProfileCustomization,
  EditorProfileDefinition,
  EditorQuickMenuContext
} from './types'

const ReadOnlyImageUpload = Node.create({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-upload' })]
  }
})

const createReadOnlyImageUpload = () => ReadOnlyImageUpload.configure({})

const sharedDefinition: Omit<EditorProfileDefinition, 'name'> = {
  extensions: [
    { key: 'textAlign', create: () => TextAlign.configure({ types: ['heading', 'paragraph'] }) },
    { key: 'imageUpload', create: () => ImageUpload.configure({}) }
  ],
  readOnlyExtensions: [
    {
      key: 'starterKit',
      create: () => StarterKit.configure({
        horizontalRule: false,
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false }
      })
    },
    { key: 'horizontalRule', create: () => HorizontalRule.configure({}) },
    { key: 'image', create: () => Image.configure({}) },
    { key: 'mention', create: () => Mention.configure({}) },
    { key: 'textAlign', create: () => TextAlign.configure({ types: ['heading', 'paragraph'] }) },
    { key: 'imageUpload', create: createReadOnlyImageUpload }
  ],
  handlers: [{
    key: 'imageUpload',
    create: () => ({
      canExecute: (editor: Editor) => editor.can().insertContent({ type: 'imageUpload' }),
      execute: (editor: Editor) => editor.chain().focus().insertContent({ type: 'imageUpload' }),
      isActive: (editor: Editor) => editor.isActive('imageUpload'),
      isDisabled: undefined
    })
  }],
  toolbarGroups: [
    { key: 'history', create: () => [
      { kind: 'undo', icon: 'i-lucide-undo', tooltip: { text: 'Undo' } },
      { kind: 'redo', icon: 'i-lucide-redo', tooltip: { text: 'Redo' } }
    ] },
    { key: 'blocks', create: () => [
      { icon: 'i-lucide-heading', tooltip: { text: 'Headings' }, content: { align: 'start' }, items: [
        { kind: 'heading', level: 1, icon: 'i-lucide-heading-1', label: 'Heading 1' },
        { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: 'Heading 2' },
        { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: 'Heading 3' },
        { kind: 'heading', level: 4, icon: 'i-lucide-heading-4', label: 'Heading 4' }
      ] },
      { icon: 'i-lucide-list', tooltip: { text: 'Lists' }, content: { align: 'start' }, items: [
        { kind: 'bulletList', icon: 'i-lucide-list', label: 'Bullet List' },
        { kind: 'orderedList', icon: 'i-lucide-list-ordered', label: 'Ordered List' }
      ] },
      { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Blockquote' } },
      { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code Block' } },
      { kind: 'horizontalRule', icon: 'i-lucide-separator-horizontal', tooltip: { text: 'Horizontal Rule' } }
    ] },
    { key: 'marks', create: () => [
      { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
      { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
      { kind: 'mark', mark: 'underline', icon: 'i-lucide-underline', tooltip: { text: 'Underline' } },
      { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
      { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } }
    ] },
    { key: 'insert', create: () => [
      { slot: 'link', icon: 'i-lucide-link' },
      { kind: 'imageUpload', icon: 'i-lucide-image', tooltip: { text: 'Image' } }
    ] },
    { key: 'alignment', create: () => [{
      icon: 'i-lucide-align-justify',
      tooltip: { text: 'Text Align' },
      content: { align: 'end' },
      items: [
        { kind: 'textAlign', align: 'left', icon: 'i-lucide-align-left', label: 'Align Left' },
        { kind: 'textAlign', align: 'center', icon: 'i-lucide-align-center', label: 'Align Center' },
        { kind: 'textAlign', align: 'right', icon: 'i-lucide-align-right', label: 'Align Right' },
        { kind: 'textAlign', align: 'justify', icon: 'i-lucide-align-justify', label: 'Align Justify' }
      ]
    }] }
  ],
  suggestionGroups: [
    { key: 'style', create: () => [
      { type: 'label', label: 'Style' },
      { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
      { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
      { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
      { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
      { kind: 'bulletList', label: 'Bullet List', icon: 'i-lucide-list' },
      { kind: 'orderedList', label: 'Numbered List', icon: 'i-lucide-list-ordered' },
      { kind: 'blockquote', label: 'Blockquote', icon: 'i-lucide-text-quote' },
      { kind: 'codeBlock', label: 'Code Block', icon: 'i-lucide-square-code' }
    ] },
    { key: 'insert', create: () => [
      { type: 'label', label: 'Insert' },
      { kind: 'imageUpload', label: 'Image', icon: 'i-lucide-image' },
      { kind: 'horizontalRule', label: 'Horizontal Rule', icon: 'i-lucide-separator-horizontal' }
    ] }
  ],
  quickMenuGroups: [
    { key: 'transform', create: () => ({ node, pos }: EditorQuickMenuContext) => [[
      { type: 'label', label: node.type ? node.type.slice(0, 1).toUpperCase() + node.type.slice(1) : 'Block' },
      { label: 'Turn into', icon: 'i-lucide-repeat-2', children: [
        { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
        { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
        { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
        { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
        { kind: 'heading', level: 4, label: 'Heading 4', icon: 'i-lucide-heading-4' },
        { kind: 'bulletList', label: 'Bullet List', icon: 'i-lucide-list' },
        { kind: 'orderedList', label: 'Ordered List', icon: 'i-lucide-list-ordered' },
        { kind: 'blockquote', label: 'Blockquote', icon: 'i-lucide-text-quote' },
        { kind: 'codeBlock', label: 'Code Block', icon: 'i-lucide-square-code' }
      ] },
      { kind: 'clearFormatting', pos, label: 'Reset formatting', icon: 'i-lucide-rotate-ccw' }
    ]] },
    { key: 'clipboard', create: () => ({ editor, pos }: EditorQuickMenuContext) => [[
      { kind: 'duplicate', pos, label: 'Duplicate', icon: 'i-lucide-copy' },
      { label: 'Copy to clipboard', icon: 'i-lucide-clipboard', onSelect: async () => {
        const selected = editor.state.doc.nodeAt(pos)
        const clipboard = typeof globalThis.navigator === 'object'
          ? (globalThis.navigator as { clipboard?: { writeText?: (value: string) => Promise<void> } }).clipboard
          : undefined
        if (selected && typeof clipboard?.writeText === 'function') {
          await clipboard.writeText(selected.textContent)
        }
      } }
    ]] },
    { key: 'move', create: () => ({ pos }: EditorQuickMenuContext) => [[
      { kind: 'moveUp', pos, label: 'Move up', icon: 'i-lucide-arrow-up' },
      { kind: 'moveDown', pos, label: 'Move down', icon: 'i-lucide-arrow-down' }
    ]] },
    { key: 'delete', create: () => ({ pos }: EditorQuickMenuContext) => [[
      { kind: 'delete', pos, label: 'Delete', icon: 'i-lucide-trash' }
    ]] }
  ],
  pluginKeys: [
    { key: 'imageBubble', create: () => 'richtext-image-bubble' },
    { key: 'dragHandle', create: () => 'richtext-drag-handle' },
    { key: 'suggestion', create: () => 'richtext-suggestion-menu' }
  ]
}

export const richTextProfileDefinition: EditorProfileDefinition = {
  name: 'richText',
  ...sharedDefinition
}

export function createRichTextProfile(
  customization: EditorProfileCustomization = {},
  options: { editable?: boolean, imageUploadFactory?: () => AnyExtension } = {}
) {
  const imageUploadFactory = options.editable === false
    ? createReadOnlyImageUpload
    : options.imageUploadFactory
  const definition = imageUploadFactory
    ? {
        ...richTextProfileDefinition,
        extensions: richTextProfileDefinition.extensions.map(contribution => (
          contribution.key === 'imageUpload'
            ? { ...contribution, create: imageUploadFactory }
            : contribution
        ))
      }
    : richTextProfileDefinition
  return createEditorProfile(definition, customization)
}
