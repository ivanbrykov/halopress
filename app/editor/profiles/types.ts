import type {
  EditorCustomHandlers,
  EditorSuggestionMenuItem,
  EditorToolbarItem
} from '@nuxt/ui'
import type { AnyExtension, Editor, JSONContent } from '@tiptap/core'

export type EditorProfileHandlers = EditorCustomHandlers
export type EditorProfileToolbarGroup = EditorToolbarItem<EditorProfileHandlers>[]
export type EditorProfileSuggestionGroup = EditorSuggestionMenuItem<EditorProfileHandlers>[]

export type EditorQuickMenuContext = {
  editor: Editor
  node: JSONContent
  pos: number
}

export type EditorQuickMenuItem = Record<string, unknown>
export type EditorQuickMenuFactory = (context: EditorQuickMenuContext) => EditorQuickMenuItem[][]

export type NamedFactory<T> = {
  key: string
  create: () => T
}

export type NamedContributionChange<T> =
  | { action: 'remove', key: string }
  | { action: 'add', key: string, create: () => T, before?: string, after?: string }
  | { action: 'replace', key: string, create: () => T, before?: string, after?: string }

export type EditorProfileCustomization = {
  extensions?: NamedContributionChange<AnyExtension>[]
  readOnlyExtensions?: NamedContributionChange<AnyExtension>[]
  handlers?: NamedContributionChange<EditorProfileHandlers[keyof EditorProfileHandlers]>[]
  toolbarGroups?: NamedContributionChange<EditorProfileToolbarGroup>[]
  suggestionGroups?: NamedContributionChange<EditorProfileSuggestionGroup>[]
  quickMenuGroups?: NamedContributionChange<EditorQuickMenuFactory>[]
  pluginKeys?: NamedContributionChange<string>[]
}

export type EditorProfile = {
  name: 'richText' | 'page'
  extensions: AnyExtension[]
  readOnlyExtensions: AnyExtension[]
  handlers: EditorProfileHandlers
  toolbarGroups: EditorProfileToolbarGroup[]
  suggestionGroups: EditorProfileSuggestionGroup[]
  quickMenuGroups: EditorQuickMenuFactory[]
  pluginKeys: Record<string, string>
}

export type EditorProfileDefinition = {
  name: EditorProfile['name']
  extensions: NamedFactory<AnyExtension>[]
  readOnlyExtensions: NamedFactory<AnyExtension>[]
  handlers: NamedFactory<EditorProfileHandlers[keyof EditorProfileHandlers]>[]
  toolbarGroups: NamedFactory<EditorProfileToolbarGroup>[]
  suggestionGroups: NamedFactory<EditorProfileSuggestionGroup>[]
  quickMenuGroups: NamedFactory<EditorQuickMenuFactory>[]
  pluginKeys: NamedFactory<string>[]
}
