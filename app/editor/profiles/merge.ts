import type { AnyExtension } from '@tiptap/core'

import type {
  EditorProfile,
  EditorProfileCustomization,
  EditorProfileDefinition,
  EditorProfileHandlers,
  NamedContributionChange,
  NamedFactory
} from './types'

function assertUniqueKeys<T>(items: NamedFactory<T>[], label: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.key || seen.has(item.key)) {
      throw new Error('Duplicate ' + label + ' key: ' + (item.key || '(empty)'))
    }
    seen.add(item.key)
  }
}

function place<T>(items: NamedFactory<T>[], item: NamedFactory<T>, before?: string, after?: string) {
  if (before && after) throw new Error('Contribution ' + item.key + ' cannot specify both before and after')
  if (!before && !after) {
    items.push(item)
    return
  }

  const anchor = before || after
  const anchorIndex = items.findIndex(candidate => candidate.key === anchor)
  if (anchorIndex < 0) throw new Error('Unknown contribution ordering anchor: ' + anchor)
  items.splice(before ? anchorIndex : anchorIndex + 1, 0, item)
}

export function mergeNamedContributions<T>(
  base: NamedFactory<T>[],
  changes: NamedContributionChange<T>[] = [],
  label = 'contribution'
) {
  assertUniqueKeys(base, label)
  const items = [...base]
  const changedKeys = new Set<string>()

  for (const change of changes) {
    if (changedKeys.has(change.key)) {
      throw new Error('Duplicate ' + label + ' customization: ' + change.key)
    }
    changedKeys.add(change.key)

    const existingIndex = items.findIndex(item => item.key === change.key)
    if (change.action === 'remove') {
      if (existingIndex < 0) throw new Error('Cannot remove unknown ' + label + ': ' + change.key)
      items.splice(existingIndex, 1)
      continue
    }

    const next = { key: change.key, create: change.create }
    if (change.action === 'add') {
      if (existingIndex >= 0) throw new Error('Duplicate ' + label + ' key: ' + change.key)
      place(items, next, change.before, change.after)
      continue
    }

    if (existingIndex < 0) throw new Error('Cannot replace unknown ' + label + ': ' + change.key)
    const originalIndex = existingIndex
    items.splice(existingIndex, 1)
    if (change.before || change.after) place(items, next, change.before, change.after)
    else items.splice(originalIndex, 0, next)
  }

  assertUniqueKeys(items, label)
  return items
}

function instantiate<T>(items: NamedFactory<T>[]) {
  return items.map(item => ({ key: item.key, value: item.create() }))
}

function assertUniqueExtensionNames(extensions: AnyExtension[], label: string) {
  const seen = new Set<string>()
  for (const extension of extensions) {
    if (seen.has(extension.name)) throw new Error('Duplicate ' + label + ' extension name: ' + extension.name)
    seen.add(extension.name)
  }
}

export function createEditorProfile(
  definition: EditorProfileDefinition,
  customization: EditorProfileCustomization = {}
): EditorProfile {
  const extensions = instantiate(mergeNamedContributions(
    definition.extensions,
    customization.extensions,
    'extension'
  )).map(item => item.value)
  const readOnlyExtensions = instantiate(mergeNamedContributions(
    definition.readOnlyExtensions,
    customization.readOnlyExtensions,
    'read-only extension'
  )).map(item => item.value)
  assertUniqueExtensionNames(extensions, 'editor')
  assertUniqueExtensionNames(readOnlyExtensions, 'read-only')

  const handlerEntries = instantiate(mergeNamedContributions(
    definition.handlers,
    customization.handlers,
    'handler'
  ))
  const handlers = Object.fromEntries(handlerEntries.map(item => [item.key, item.value])) as EditorProfileHandlers

  const toolbarGroups = instantiate(mergeNamedContributions(
    definition.toolbarGroups,
    customization.toolbarGroups,
    'toolbar group'
  )).map(item => item.value)
  const suggestionGroups = instantiate(mergeNamedContributions(
    definition.suggestionGroups,
    customization.suggestionGroups,
    'suggestion group'
  )).map(item => item.value)
  const quickMenuGroups = instantiate(mergeNamedContributions(
    definition.quickMenuGroups,
    customization.quickMenuGroups,
    'quick-menu group'
  )).map(item => item.value)
  const pluginEntries = instantiate(mergeNamedContributions(
    definition.pluginKeys,
    customization.pluginKeys,
    'plugin'
  ))
  const pluginKeys = Object.fromEntries(pluginEntries.map(item => [item.key, item.value]))

  const duplicatePluginValues = pluginEntries.find((entry, index) => (
    pluginEntries.findIndex(candidate => candidate.value === entry.value) !== index
  ))
  if (duplicatePluginValues) throw new Error('Duplicate plugin key: ' + duplicatePluginValues.value)

  return {
    name: definition.name,
    extensions,
    readOnlyExtensions,
    handlers,
    toolbarGroups,
    suggestionGroups,
    quickMenuGroups,
    pluginKeys
  }
}
