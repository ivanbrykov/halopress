import { Extension } from '@tiptap/core'
import { generateHTML } from '@tiptap/html/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPageProfile,
  createRichTextProfile,
  getPageToolbarGroups,
  mergeNamedContributions
} from '../app/editor/profiles'

function factory(key: string) {
  return { key, create: () => ({ key }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editor profile contribution merging', () => {
  it('adds, removes, replaces, and orders named contributions deterministically', () => {
    expect(mergeNamedContributions([
      factory('a'), factory('b'), factory('c')
    ], [
      { action: 'remove', key: 'b' },
      { action: 'add', key: 'd', create: () => ({ key: 'd' }), before: 'c' }
    ]).map(item => item.key)).toEqual(['a', 'd', 'c'])

    expect(mergeNamedContributions([
      factory('a'), factory('b'), factory('c')
    ], [
      { action: 'replace', key: 'b', create: () => ({ key: 'replacement' }) }
    ]).map(item => item.create())).toEqual([
      { key: 'a' }, { key: 'replacement' }, { key: 'c' }
    ])

    expect(mergeNamedContributions([
      factory('a'), factory('b'), factory('c')
    ], [
      { action: 'replace', key: 'a', create: () => ({ key: 'replacement' }), after: 'c' }
    ]).map(item => item.key)).toEqual(['b', 'c', 'a'])
  })

  it('rejects duplicate keys, repeated customizations, and invalid anchors', () => {
    expect(() => mergeNamedContributions([factory('a'), factory('a')])).toThrow('Duplicate contribution key: a')
    expect(() => mergeNamedContributions([factory('a')], [
      { action: 'remove', key: 'a' },
      { action: 'add', key: 'a', create: () => ({ key: 'a' }) }
    ])).toThrow('Duplicate contribution customization: a')
    expect(() => mergeNamedContributions([factory('a')], [
      { action: 'add', key: 'b', create: () => ({ key: 'b' }), before: 'missing' }
    ])).toThrow('Unknown contribution ordering anchor: missing')
  })
})

describe('richText and page profiles', () => {
  it('creates fresh extension instances for every editor', () => {
    const first = createRichTextProfile()
    const second = createRichTextProfile()

    expect(first.extensions.map(extension => extension.name)).toEqual(['textAlign', 'imageUpload'])
    expect(first.extensions[0]).not.toBe(second.extensions[0])
    expect(first.readOnlyExtensions[0]).not.toBe(second.readOnlyExtensions[0])
  })

  it('does not instantiate edit-only image upload node views for read-only editors', () => {
    const imageUploadFactory = vi.fn(() => Extension.create({ name: 'imageUpload' }))

    const profile = createRichTextProfile({}, {
      editable: false,
      imageUploadFactory
    })

    expect(imageUploadFactory).not.toHaveBeenCalled()
    const imageUpload = profile.extensions.find(extension => extension.name === 'imageUpload')
    expect(imageUpload?.config.addNodeView).toBeUndefined()
    expect(imageUpload?.config.addCommands).toBeUndefined()
  })

  it('composes page pattern, editable Hero, and legacy block capabilities', () => {
    const richText = createRichTextProfile()
    const page = createPageProfile()

    expect(page.extensions.map(extension => extension.name)).toEqual([
      ...richText.extensions.map(extension => extension.name),
      'pagePattern',
      'pageHero',
      'pageBlock'
    ])
    expect(page.readOnlyExtensions.map(extension => extension.name)).toContain('pageHero')
    expect(page.readOnlyExtensions.map(extension => extension.name)).toContain('pageBlock')
  })

  it('does not expose rich-text transforms for atomic page blocks', () => {
    const page = createPageProfile()
    const context = { editor: {} as any, pos: 0 }
    const pageBlockItems = page.quickMenuGroups
      .flatMap(create => create({ ...context, node: { type: 'pageBlock' } }))
      .flat()
    const pageHeroItems = page.quickMenuGroups
      .flatMap(create => create({ ...context, node: { type: 'pageHero' } }))
      .flat()
    const paragraphItems = page.quickMenuGroups
      .flatMap(create => create({ ...context, node: { type: 'paragraph' } }))
      .flat()

    expect(pageBlockItems.map(item => item.label)).not.toContain('Turn into')
    expect(pageBlockItems.map(item => item.label)).not.toContain('Reset formatting')
    expect(pageHeroItems.map(item => item.label)).not.toContain('Turn into')
    expect(pageHeroItems.map(item => item.label)).not.toContain('Reset formatting')
    expect(pageBlockItems.map(item => item.label)).toEqual(expect.arrayContaining([
      'Duplicate', 'Copy to clipboard', 'Move up', 'Move down', 'Delete'
    ]))
    expect(paragraphItems.map(item => item.label)).toEqual(expect.arrayContaining([
      'Turn into', 'Reset formatting'
    ]))
  })

  it('keeps the full toolbar visible but disables non-history controls for atomic page blocks', () => {
    const page = createPageProfile()
    const pageBlockGroups = getPageToolbarGroups(page.toolbarGroups, 'pageBlock')
    const paragraphGroups = getPageToolbarGroups(page.toolbarGroups, 'paragraph')
    const pageBlockItems = pageBlockGroups.flat()

    expect(pageBlockGroups.map(group => group.length)).toEqual(page.toolbarGroups.map(group => group.length))
    expect(pageBlockItems[0]).toMatchObject({ kind: 'undo' })
    expect(pageBlockItems[1]).toMatchObject({ kind: 'redo' })
    expect(pageBlockItems.slice(2).every(item => item.disabled === true && !('kind' in item))).toBe(true)
    const headingMenu = pageBlockItems[2] as any
    expect(headingMenu.items.every((item: any) => item.disabled === true && !('kind' in item))).toBe(true)
    expect(paragraphGroups).toBe(page.toolbarGroups)
    expect(paragraphGroups.flat().some(item => 'kind' in item && item.kind === 'blockquote')).toBe(true)
  })

  it('supports named customization without changing the component implementation', () => {
    const custom = Extension.create({ name: 'customCapability' })
    const profile = createRichTextProfile({
      extensions: [{
        action: 'add',
        key: 'customCapability',
        create: () => custom.configure({}),
        before: 'imageUpload'
      }],
      toolbarGroups: [{ action: 'remove', key: 'alignment' }],
      pluginKeys: [{ action: 'replace', key: 'suggestion', create: () => 'custom-suggestion' }]
    })

    expect(profile.extensions.map(extension => extension.name)).toEqual([
      'textAlign', 'customCapability', 'imageUpload'
    ])
    expect(profile.toolbarGroups).toHaveLength(4)
    expect(profile.pluginKeys.suggestion).toBe('custom-suggestion')
  })

  it('rejects duplicate extension names and plugin keys', () => {
    expect(() => createRichTextProfile({
      extensions: [{
        action: 'add',
        key: 'anotherTextAlign',
        create: () => Extension.create({ name: 'textAlign' })
      }]
    })).toThrow('Duplicate editor extension name: textAlign')

    expect(() => createRichTextProfile({
      pluginKeys: [{
        action: 'replace',
        key: 'suggestion',
        create: () => 'richtext-drag-handle'
      }]
    })).toThrow('Duplicate plugin key: richtext-drag-handle')
  })

  it('renders existing rich-text JSON with the read-only capability set', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'Compatible heading' }]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Existing ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'JSON' }
          ]
        },
        { type: 'imageUpload' }
      ]
    }

    expect(generateHTML(content, createRichTextProfile().readOnlyExtensions)).toContain('Compatible heading')
    expect(generateHTML(content, createRichTextProfile().readOnlyExtensions)).toContain('<strong>JSON</strong>')
    expect(generateHTML(content, createRichTextProfile().readOnlyExtensions)).toContain('<div data-type="image-upload"></div>')
    expect(content).toEqual(JSON.parse(JSON.stringify(content)))
  })

  it('uses clipboard actions only when the browser exposes writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const editor = {
      state: {
        doc: {
          nodeAt: vi.fn(() => ({ textContent: 'Selected text' }))
        }
      }
    }
    const profile = createRichTextProfile()
    const clipboardGroup = profile.quickMenuGroups[1]!
    const action = clipboardGroup({ editor, node: {}, pos: 3 })[0]!
      .find(item => item.label === 'Copy to clipboard') as { onSelect: () => Promise<void> }

    vi.stubGlobal('navigator', {})
    await expect(action.onSelect()).resolves.toBeUndefined()

    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(action.onSelect()).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledWith('Selected text')
  })
})
