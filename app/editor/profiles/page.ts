import PageBlock from '../page/PageBlock'
import PageHero from '../page/PageHero'
import PagePattern from '../page/PagePattern'
import type { AnyExtension } from '@tiptap/core'
import { createEditorProfile } from './merge'
import { richTextProfileDefinition } from './richText'
import type {
  EditorProfileCustomization,
  EditorProfileDefinition,
  EditorProfileToolbarGroup,
  EditorQuickMenuContext
} from './types'

const pageBlockHistoryKinds = new Set(['undo', 'redo'])

function disablePageBlockToolbarItem(item: any): any {
  if (pageBlockHistoryKinds.has(item.kind)) return item
  const { kind: _kind, ...disabledItem } = item
  if (Array.isArray(item.items)) {
    disabledItem.items = item.items.map((entry: any) => (
      Array.isArray(entry)
        ? entry.map(disablePageBlockToolbarItem)
        : disablePageBlockToolbarItem(entry)
    ))
  }
  return { ...disabledItem, disabled: true }
}

export function getPageToolbarGroups(
  groups: EditorProfileToolbarGroup[],
  selectedNodeType: string | null
) {
  if (selectedNodeType !== 'pageBlock') return groups
  return groups.map(group => group.map(disablePageBlockToolbarItem))
}

const pageQuickMenuGroups = richTextProfileDefinition.quickMenuGroups.map((contribution) => {
  if (contribution.key !== 'transform') return contribution
  return {
    ...contribution,
    create: () => {
      const createTransformMenu = contribution.create()
      return (context: EditorQuickMenuContext) => ['pageBlock', 'pageHero'].includes(context.node.type ?? '')
        ? []
        : createTransformMenu(context)
    }
  }
})

export const pageProfileDefinition: EditorProfileDefinition = {
  ...richTextProfileDefinition,
  name: 'page',
  extensions: [
    ...richTextProfileDefinition.extensions,
    { key: 'pagePattern', create: () => PagePattern.configure({}) },
    { key: 'pageHero', create: () => PageHero.configure({}) },
    { key: 'pageBlock', create: () => PageBlock.configure({}) }
  ],
  readOnlyExtensions: [
    ...richTextProfileDefinition.readOnlyExtensions,
    { key: 'pageHero', create: () => PageHero.configure({}) },
    { key: 'pageBlock', create: () => PageBlock.configure({}) }
  ],
  quickMenuGroups: pageQuickMenuGroups
}

export function createPageProfile(
  customization: EditorProfileCustomization = {},
  options: {
    pageBlockFactory?: () => AnyExtension
    pageHeroFactory?: () => AnyExtension
    imageUploadFactory?: () => AnyExtension
  } = {}
) {
  const definition = {
    ...pageProfileDefinition,
    extensions: pageProfileDefinition.extensions.map((contribution) => {
      if (contribution.key === 'pageBlock' && options.pageBlockFactory) {
        return { ...contribution, create: options.pageBlockFactory }
      }
      if (contribution.key === 'pageHero' && options.pageHeroFactory) {
        return { ...contribution, create: options.pageHeroFactory }
      }
      if (contribution.key === 'imageUpload' && options.imageUploadFactory) {
        return { ...contribution, create: options.imageUploadFactory }
      }
      return contribution
    })
  }
  return createEditorProfile(definition, customization)
}
