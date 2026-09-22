<script setup lang="ts">
import type { DropdownMenuItem, EditorToolbarItem } from '@nuxt/ui'
import { mapEditorItems } from '@nuxt/ui/utils/editor'
import type { DragHandleProps } from '@tiptap/extension-drag-handle-vue-3'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { markRaw } from 'vue'

import ImageUpload from '~/editor/RichEditorImageUpload'
import RichEditorImageUploadNode from '~/editor/RichEditorImageUploadNode.vue'
import { createRichTextProfile } from '~/editor/profiles'
import type { EditorProfileCustomization } from '~/editor/profiles'
import RichEditorLinkPopover from './RichEditorLinkPopover.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: any
  placeholder?: string
  editable?: boolean
  profile?: EditorProfileCustomization
}>(), {
  placeholder: 'Write…',
  editable: true,
  profile: () => ({})
})

const emit = defineEmits<{
  'update:modelValue': [value: any]
}>()

const value = computed({
  get: () => props.modelValue,
  set: nextValue => emit('update:modelValue', nextValue)
})

const ImageUploadEditor = ImageUpload.extend({
  addNodeView() {
    return VueNodeViewRenderer(RichEditorImageUploadNode)
  }
})
const editorProfile = createRichTextProfile(props.profile, {
  editable: props.editable,
  imageUploadFactory: () => ImageUploadEditor.configure({})
})
const extensions = markRaw(editorProfile.extensions.map(extension => markRaw(extension)))
const selectedNode = ref<{ node: JSONContent | null, pos: number } | null>(null)

const getDragHandleItems = (editor: Editor): DropdownMenuItem[][] => {
  const selected = selectedNode.value
  if (!selected?.node?.type) return []

  const groups = editorProfile.quickMenuGroups.flatMap(create => create({
    editor,
    node: selected.node!,
    pos: selected.pos
  }))
  return mapEditorItems(editor, groups as any, editorProfile.handlers) as DropdownMenuItem[][]
}

const onNodeChange = (event: { node: JSONContent | null, pos: number }) => {
  selectedNode.value = event
}

const dragHandleNestedOptions = undefined as unknown as DragHandleProps['nestedOptions']

const getImageToolbarItems = (editor: Editor): EditorToolbarItem[][] => {
  const node = editor.state.doc.nodeAt(editor.state.selection.from)

  return [[{
    icon: 'i-lucide-download',
    to: node?.attrs?.src,
    download: true,
    tooltip: { text: 'Download' }
  }, {
    icon: 'i-lucide-refresh-cw',
    tooltip: { text: 'Replace' },
    onClick: () => {
      const { selection } = editor.state
      const pos = selection.from
      const current = editor.state.doc.nodeAt(pos)
      if (!current || current.type.name !== 'image') return
      editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).insertContentAt(pos, { type: 'imageUpload' }).run()
    }
  }], [{
    icon: 'i-lucide-trash',
    tooltip: { text: 'Delete' },
    onClick: () => {
      const pos = editor.state.selection.from
      const current = editor.state.doc.nodeAt(pos)
      if (current?.type.name === 'image') {
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run()
      }
    }
  }]]
}
</script>

<template>
  <ClientOnly>
    <UEditor
      v-slot="{ editor, handlers }"
      v-model="value"
      content-type="json"
      :extensions="extensions"
      :handlers="editorProfile.handlers"
      :editable="editable"
      :placeholder="placeholder"
      class="w-full min-h-48 rounded-md border border-muted bg-default"
      :style="{ borderRadius: 'var(--ui-radius)' }"
      :ui="{ base: 'px-4 py-3' }"
      v-bind="$attrs"
    >
      <UEditorToolbar
        v-if="editable"
        :editor="editor"
        :items="editorProfile.toolbarGroups"
        class="border-b border-muted bg-default px-2 py-2 flex-wrap"
        :style="{
          borderTopLeftRadius: 'var(--ui-radius)',
          borderTopRightRadius: 'var(--ui-radius)'
        }"
      >
        <template #link>
          <RichEditorLinkPopover :editor="editor" auto-open />
        </template>
      </UEditorToolbar>

      <UEditorToolbar
        v-if="editable"
        :editor="editor"
        :items="getImageToolbarItems(editor)"
        layout="bubble"
        :plugin-key="editorProfile.pluginKeys.imageBubble"
        :should-show="({ editor: currentEditor, view }: any) => currentEditor.isActive('image') && view.hasFocus()"
      />

      <UEditorDragHandle
        v-if="editable"
        v-slot="{ ui, onClick }"
        :editor="editor"
        :nested-options="dragHandleNestedOptions"
        :plugin-key="editorProfile.pluginKeys.dragHandle"
        @node-change="onNodeChange"
      >
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          :class="ui.handle()"
          @click="(event: MouseEvent) => {
            event.stopPropagation()
            const node = onClick()
            handlers.suggestion?.execute(editor, { pos: node?.pos }).run()
          }"
        />

        <UDropdownMenu
          v-slot="{ open }"
          :modal="false"
          :items="getDragHandleItems(editor)"
          :content="{ side: 'left' }"
          :ui="{ content: 'w-48', label: 'text-xs' }"
          @update:open="editor.chain().setMeta('lockDragHandle', $event).run()"
        >
          <UButton
            color="neutral"
            variant="ghost"
            active-variant="soft"
            size="sm"
            icon="i-lucide-grip-vertical"
            :active="open"
            :class="ui.handle()"
          />
        </UDropdownMenu>
      </UEditorDragHandle>

      <UEditorSuggestionMenu
        v-if="editable"
        :editor="editor"
        :items="editorProfile.suggestionGroups"
        :plugin-key="editorProfile.pluginKeys.suggestion"
      />
    </UEditor>
    <template #fallback>
      <USkeleton class="h-48 w-full" />
    </template>
  </ClientOnly>
</template>
