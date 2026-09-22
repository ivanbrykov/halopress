import { describe, expect, it } from 'vitest'

import * as layoutModule from '../shared/site-layout'
import {
  createLayoutDocumentFromPreset,
  deepFreeze,
  deleteLayoutElement,
  duplicateLayoutElement,
  findForbiddenLayoutData,
  insertLayoutElement,
  layoutDocumentSchema,
  layoutElementDescriptors,
  layoutElementRegistry,
  layoutElementTypes,
  layoutRegionKeys,
  layoutPresetDefinitions,
  layoutPresetMetadata,
  layoutPresetRegistry,
  layoutPresetKeys,
  layoutViewportKeys,
  moveLayoutElement,
  parseLayoutDocument,
  reorderLayoutElement,
  resolvedLayoutProjectionSchema,
  serializeLayoutDocument,
  type LayoutDocument,
  type LayoutElement
} from '../shared/site-layout'
import {
  defineLayoutRendererRegistry,
  resolveLayoutRenderer
} from '../shared/site-layout-renderer'

function clone(document: LayoutDocument) {
  return structuredClone(document) as any
}

describe('Layout domain contract', () => {
  it('validates every deep-cloned preset with exactly one Page content slot, including Blank', () => {
    expect(layoutPresetDefinitions.map(preset => preset.key)).toEqual(layoutPresetKeys)
    for (const preset of layoutPresetDefinitions) {
      const document = createLayoutDocumentFromPreset(preset.key, `layout-${preset.key}`, preset.label)
      expect(layoutDocumentSchema.safeParse(document).success).toBe(true)
      expect(document.elements.filter(element => element.type === 'page-content')).toHaveLength(1)
      expect(document.elements.find(element => element.type === 'page-content')).toMatchObject({
        region: 'content',
        props: {}
      })
    }
    expect(createLayoutDocumentFromPreset('blank', 'blank-layout', 'Blank').elements).toHaveLength(1)
    for (const forbiddenName of [
      'UHeader',
      'UButton',
      'UModal',
      'USlideover',
      'DeskLayout',
      'SiteAdminSection',
      'SettingsShell',
      'PageEditor',
      'AppLogo',
      'SiteWorkspaceShell',
      'app/layouts/desk.vue'
    ]) {
      expect(() => createLayoutDocumentFromPreset('blank', 'unsafe-layout', forbiddenName)).toThrow()
    }
    expect(createLayoutDocumentFromPreset('blank', 'usa-layout', 'USA homepage').name).toBe('USA homepage')
    expect(createLayoutDocumentFromPreset('blank', 'portal-layout', 'User Portal').name).toBe('User Portal')
  })

  it('deep-freezes source presets and descriptors while keeping returned documents independent', () => {
    const original = createLayoutDocumentFromPreset('header-footer', 'layout-before', 'Before')
    const source = layoutPresetRegistry.byKey['header-footer'] as any
    const descriptor = layoutElementDescriptors.find(item => item.type === 'menu') as any

    expect(Object.isFrozen(source.document.grid.regions[0].placement.mobile)).toBe(true)
    for (const vocabulary of [layoutViewportKeys, layoutRegionKeys, layoutElementTypes, layoutPresetKeys]) {
      expect(Object.isFrozen(vocabulary)).toBe(true)
      expect(() => {
        ;(vocabulary as any).push('unsafe')
      }).toThrow(TypeError)
    }
    expect(Object.isFrozen(source.document.elements[0].props)).toBe(true)
    expect(Object.isFrozen(descriptor.defaultProps)).toBe(true)
    expect(Object.isFrozen(descriptor.inspectorFields[1].options)).toBe(true)
    expect(Object.isFrozen(descriptor.inspectorFields[1].options[0])).toBe(true)
    expect(descriptor.reference).toEqual({ kind: 'menu-set', prop: 'menuSetId', resolution: 'live', onDelete: 'restrict' })
    expect(layoutElementDescriptors.find(item => item.type === 'page-content')?.deletion).toBe('required')
    expect(() => {
      source.document.grid.regions[0].placement.mobile.span = 1
    }).toThrow(TypeError)
    expect(() => {
      source.document.elements[0].props.size = 'large'
    }).toThrow(TypeError)
    expect(() => {
      descriptor.inspectorFields[1].options[0].value = 'unsafe'
    }).toThrow(TypeError)

    const metadata = layoutPresetMetadata() as any
    metadata[0].label = 'Mutated return value'
    expect(layoutPresetMetadata()[0]!.label).toBe('Blank')

    const mutated = createLayoutDocumentFromPreset('header-footer', 'layout-mutated', 'Mutated')
    ;(mutated.grid.regions[0]!.placement.mobile as any).span = 1
    ;(mutated.elements[0]!.props as any).size = 'large'
    const after = createLayoutDocumentFromPreset('header-footer', 'layout-after', 'After')
    expect(after.grid.regions[0]!.placement.mobile.span).toBe(original.grid.regions[0]!.placement.mobile.span)
    expect(after.elements[0]!.props).toEqual(original.elements[0]!.props)

    const frozen = deepFreeze({ nested: { options: [{ value: 'safe' }] } }) as any
    expect(() => {
      frozen.nested.options[0].value = 'unsafe'
    }).toThrow(TypeError)
  })

  it('keeps descriptor and reference-policy coverage exhaustive and unique', () => {
    const descriptorTypes = layoutElementDescriptors.map(descriptor => descriptor.type)
    expect(descriptorTypes).toEqual(layoutElementTypes)
    expect(new Set(descriptorTypes).size).toBe(layoutElementTypes.length)
    expect(Object.keys(layoutElementRegistry)).toEqual(layoutElementTypes)
    expect(layoutElementDescriptors.filter(descriptor => descriptor.reference.kind === 'menu-set'))
      .toEqual([expect.objectContaining({ type: 'menu', reference: expect.objectContaining({ prop: 'menuSetId', resolution: 'live', onDelete: 'restrict' }) })])
  })

  it('rejects framework, executable, styling, template, and prototype vocabulary at any depth', () => {
    const base = createLayoutDocumentFromPreset('blank', 'security-layout', 'Security')
    const attacks: Array<{ label: string, mutate: (candidate: any) => void }> = [
      ...['default', 'desk', 'blank'].map(value => ({ label: `nuxtLayout:${value}`, mutate: (candidate: any) => { candidate.nuxtLayout = value } })),
      { label: 'layout:desk', mutate: candidate => { candidate.elements[0].layout = 'desk' } },
      { label: 'component', mutate: candidate => { candidate.elements[0].props.component = 'PageContent' } },
      { label: 'componentKey', mutate: candidate => { candidate.elements[0].componentKey = 'page-content' } },
      { label: 'runtimeComponentKey', mutate: candidate => { candidate.runtimeComponentKey = 'PageContent' } },
      { label: 'import', mutate: candidate => { candidate.elements[0].import = '~/components/PageContent.vue' } },
      { label: 'path', mutate: candidate => { candidate.elements[0].path = 'app/layouts/desk.vue' } },
      { label: 'class', mutate: candidate => { candidate.elements[0].class = 'grid' } },
      { label: 'className', mutate: candidate => { candidate.elements[0].className = 'grid' } },
      { label: 'tailwind', mutate: candidate => { candidate.elements[0].tailwind = 'grid-cols-12' } },
      { label: 'ui', mutate: candidate => { candidate.elements[0].ui = { root: 'unsafe' } } },
      { label: 'slots', mutate: candidate => { candidate.elements[0].slots = { default: 'unsafe' } } },
      { label: 'template', mutate: candidate => { candidate.elements[0].template = '<main />' } },
      { label: 'html', mutate: candidate => { candidate.elements[0].html = '<script />' } },
      { label: 'css', mutate: candidate => { candidate.elements[0].css = 'body{}' } },
      { label: 'script', mutate: candidate => { candidate.elements[0].script = 'alert(1)' } },
      { label: '__proto__', mutate: candidate => { Object.defineProperty(candidate.elements[0], '__proto__', { value: { polluted: true }, enumerable: true }) } },
      { label: 'prototype', mutate: candidate => { candidate.elements[0].prototype = {} } },
      { label: 'constructor', mutate: candidate => { candidate.elements[0].constructor = 'unsafe' } },
      { label: 'UHeader', mutate: candidate => { candidate.name = 'UHeader' } },
      { label: 'UButton', mutate: candidate => { candidate.name = 'UButton' } },
      { label: 'UModal', mutate: candidate => { candidate.name = 'UModal' } },
      { label: 'SiteAdminSection', mutate: candidate => { candidate.name = 'SiteAdminSection' } },
      { label: 'PageEditor', mutate: candidate => { candidate.name = 'PageEditor' } },
      { label: 'DeskLayout', mutate: candidate => { candidate.name = 'DeskLayout' } },
      { label: 'SiteWorkspaceShell', mutate: candidate => { candidate.name = 'SiteWorkspaceShell' } },
      { label: 'NavigationMenuItem', mutate: candidate => { candidate.name = 'NavigationMenuItem' } },
      { label: 'desk vue path', mutate: candidate => { candidate.name = 'app/layouts/desk.vue' } },
      { label: 'default vue path', mutate: candidate => { candidate.name = 'app/layouts/default.vue' } },
      { label: 'blank vue path', mutate: candidate => { candidate.name = 'app/layouts/blank.vue' } },
      { label: 'components alias', mutate: candidate => { candidate.name = '#components/UHeader' } },
      { label: 'tilde import', mutate: candidate => { candidate.name = '~/components/Header.vue' } },
      { label: 'double tilde import', mutate: candidate => { candidate.name = '~~/app/layouts/desk.vue' } },
      { label: 'forbidden object key', mutate: candidate => { candidate['app/layouts/desk.vue'] = true } }
    ]

    for (const attack of attacks) {
      const candidate = clone(base)
      attack.mutate(candidate)
      const result = parseLayoutDocument(candidate)
      expect(result.success, attack.label).toBe(false)
    }

    expect(findForbiddenLayoutData(base)).toEqual([])

    const forbiddenProperty = { ...clone(base), 'app/layouts/desk.vue': true }
    const forbiddenPropertyIssues = findForbiddenLayoutData(forbiddenProperty)
    expect(forbiddenPropertyIssues).toEqual([{
      path: '',
      message: 'Persisted Layout contains a forbidden framework or runtime property name',
      kind: 'forbidden'
    }])
    expect(JSON.stringify(forbiddenPropertyIssues)).not.toContain('app/layouts/desk.vue')
    const parsedForbiddenProperty = parseLayoutDocument(forbiddenProperty)
    expect(parsedForbiddenProperty.success).toBe(false)
    if (!parsedForbiddenProperty.success) {
      expect(JSON.stringify(parsedForbiddenProperty.issues)).not.toContain('app/layouts/desk.vue')
    }
  })

  it('enforces forbidden identifiers through direct document and resolved projection schemas', () => {
    const base = createLayoutDocumentFromPreset('blank', 'direct-schema-layout', 'Direct schema')
    for (const name of ['UButton', 'SiteAdminSection', 'app/layouts/desk.vue']) {
      const document = { ...structuredClone(base), name }
      expect(layoutDocumentSchema.safeParse(document).success, name).toBe(false)
      expect(resolvedLayoutProjectionSchema.safeParse({
        status: 'ready',
        version: 1,
        layoutId: document.layoutId,
        name,
        revision: 1,
        document
      }).success, name).toBe(false)
    }

    const forbiddenKey = 'app/layouts/desk.vue'
    const document = { ...structuredClone(base), [forbiddenKey]: true }
    const directResult = layoutDocumentSchema.safeParse(document)
    expect(directResult.success).toBe(false)
    if (!directResult.success) {
      expect(directResult.error.issues).toEqual([expect.objectContaining({
        code: 'custom',
        path: [],
        message: 'Persisted Layout contains a forbidden framework or runtime property name'
      })])
      expect(JSON.stringify(directResult.error.issues)).not.toContain(forbiddenKey)
    }

    const projectionResult = resolvedLayoutProjectionSchema.safeParse({
      status: 'ready',
      version: 1,
      layoutId: document.layoutId,
      name: document.name,
      revision: 1,
      document
    })
    expect(projectionResult.success).toBe(false)
    if (!projectionResult.success) {
      expect(projectionResult.error.issues).toEqual([expect.objectContaining({
        code: 'custom',
        path: ['document'],
        message: 'Persisted Layout contains a forbidden framework or runtime property name'
      })])
      expect(JSON.stringify(projectionResult.error.issues)).not.toContain(forbiddenKey)
    }
  })

  it('canonicalizes region and element arrays for deterministic serialization and projections', () => {
    const canonical = createLayoutDocumentFromPreset('grid', 'canonical-layout', 'Canonical')
    const shuffled = clone(canonical)
    shuffled.grid.regions.reverse()
    for (const region of layoutRegionKeys) {
      shuffled.elements.filter((element: LayoutElement) => element.region === region)
        .sort((left: LayoutElement, right: LayoutElement) => left.order - right.order)
        .forEach((element: LayoutElement, index: number) => { element.order = (index + 1) * 10 })
    }
    shuffled.elements.reverse()

    const canonicalParsed = parseLayoutDocument(canonical)
    const shuffledParsed = parseLayoutDocument(shuffled)
    expect(canonicalParsed.success).toBe(true)
    expect(shuffledParsed.success).toBe(true)
    if (!canonicalParsed.success || !shuffledParsed.success) throw new Error('Expected valid canonical Layouts')

    expect(shuffledParsed.document).toEqual(canonicalParsed.document)
    expect(serializeLayoutDocument(shuffled)).toBe(serializeLayoutDocument(canonical))
    expect(shuffledParsed.document.elements.map(element => [element.region, element.order, element.id]))
      .toEqual(canonicalParsed.document.elements.map(element => [element.region, element.order, element.id]))

    const projection = resolvedLayoutProjectionSchema.parse({
      status: 'ready',
      version: 1,
      layoutId: shuffled.layoutId,
      name: shuffled.name,
      revision: 1,
      document: shuffled
    })
    expect(projection.status).toBe('ready')
    if (projection.status !== 'ready') throw new Error('Expected a ready Layout projection')
    expect(JSON.stringify(projection.document)).toBe(serializeLayoutDocument(canonical))
  })

  it('rejects invalid regions, responsive bounds, duplicate IDs, copied menu items, and content-slot drift', () => {
    const base = createLayoutDocumentFromPreset('header-footer', 'strict-layout', 'Strict')
    const invalid = [
      (candidate: any) => { candidate.grid.regions[1].placement.desktop.span = 13 },
      (candidate: any) => {
        candidate.grid.regions[1].placement.desktop.column = 12
        candidate.grid.regions[1].placement.desktop.span = 2
      },
      (candidate: any) => { candidate.grid.regions[0].placement.mobile = { row: 1, column: 12, span: 12, visibility: 'hidden' } },
      (candidate: any) => { candidate.grid.regions[1].id = 'header' },
      (candidate: any) => { candidate.elements[1].id = candidate.elements[0].id },
      (candidate: any) => { candidate.elements[0].region = 'content' },
      (candidate: any) => { candidate.elements = candidate.elements.filter((element: any) => element.type !== 'page-content') },
      (candidate: any) => { candidate.elements.push(structuredClone(candidate.elements.find((element: any) => element.type === 'page-content'))) },
      (candidate: any) => { candidate.elements.find((element: any) => element.type === 'menu').props.items = [{ label: 'Copied' }] },
      (candidate: any) => { candidate.elements.find((element: any) => element.type === 'menu').props.menuSetId = '' },
      (candidate: any) => { candidate.elements.find((element: any) => element.type === 'menu').props.orientation = 'diagonal' }
    ]
    for (const mutate of invalid) {
      const candidate = clone(base)
      mutate(candidate)
      expect(parseLayoutDocument(candidate).success).toBe(false)
    }
  })

  it('provides pure insert, move, reorder, duplicate, and delete helpers without weakening the content invariant', () => {
    const original = createLayoutDocumentFromPreset('grid', 'helper-layout', 'Helpers')
    const insertedElement: LayoutElement = {
      id: 'footer-menu-two',
      type: 'menu',
      region: 'footer',
      order: 9,
      props: { menuSetId: 'global-navigation', orientation: 'horizontal' }
    }
    const originalSnapshot = structuredClone(original)
    const inserted = insertLayoutElement(original, insertedElement, 0)
    expect(original).toEqual(originalSnapshot)
    expect(inserted.elements.find(element => element.id === insertedElement.id)).toMatchObject({ region: 'footer', order: 0 })

    const insertedSnapshot = structuredClone(inserted)
    const moved = moveLayoutElement(inserted, insertedElement.id, 'header', 1)
    expect(inserted).toEqual(insertedSnapshot)
    expect(moved.elements.find(element => element.id === insertedElement.id)).toMatchObject({ region: 'header', order: 1 })
    const movedSnapshot = structuredClone(moved)
    const reordered = reorderLayoutElement(moved, insertedElement.id, 0)
    expect(moved).toEqual(movedSnapshot)
    expect(reordered.elements.find(element => element.id === insertedElement.id)?.order).toBe(0)
    const reorderedSnapshot = structuredClone(reordered)
    const duplicated = duplicateLayoutElement(reordered, insertedElement.id, 'footer-menu-three')
    expect(reordered).toEqual(reorderedSnapshot)
    expect(duplicated.elements.some(element => element.id === 'footer-menu-three')).toBe(true)
    const duplicatedSnapshot = structuredClone(duplicated)
    const removed = deleteLayoutElement(duplicated, 'footer-menu-three')
    expect(duplicated).toEqual(duplicatedSnapshot)
    expect(removed.elements.some(element => element.id === 'footer-menu-three')).toBe(false)

    const contentId = original.elements.find(element => element.type === 'page-content')!.id
    expect(() => duplicateLayoutElement(original, contentId, 'content-copy')).toThrow('cannot be duplicated')
    expect(() => deleteLayoutElement(original, contentId)).toThrow('cannot be deleted')
    expect(() => moveLayoutElement(original, contentId, 'header', 0)).toThrow('not allowed')

    const sparse = createLayoutDocumentFromPreset('header-footer', 'sparse-layout', 'Sparse')
    sparse.elements.filter(element => element.region === 'header')
      .sort((left, right) => left.order - right.order)
      .forEach((element, index) => { element.order = (index + 1) * 10 })
    const parsedSparse = parseLayoutDocument(sparse)
    expect(parsedSparse.success).toBe(true)
    if (!parsedSparse.success) throw new Error('Expected sparse Layout input to canonicalize')
    expect(parsedSparse.document.elements.filter(element => element.region === 'header').map(element => element.order))
      .toEqual([0, 1, 2])
    const source = sparse.elements.find(element => element.type === 'site-title')!
    const sparseDuplicate = duplicateLayoutElement(sparse, source.id, 'site-title-copy')
    expect(sparseDuplicate.elements.filter(element => element.region === 'header')
      .sort((left, right) => left.order - right.order)
      .map(element => element.id)).toEqual(['site-logo', 'site-title', 'site-title-copy', 'menu-header'])
  })

  it('keeps the exhaustive renderer registry code-owned and absent from every serializable contract', () => {
    const registry = defineLayoutRendererRegistry({
      'page-content': element => element.type,
      'site-logo': element => element.type,
      'site-title': element => element.type,
      menu: element => element.type,
      'page-list': element => element.type,
      'table-of-contents': element => element.type,
      copyright: element => element.type
    })
    const document = createLayoutDocumentFromPreset('grid', 'projection-layout', 'Projection')
    const renderer = resolveLayoutRenderer(registry, document.elements[0]!)
    expect(renderer(document.elements[0]!)).toBe(document.elements[0]!.type)

    const resource = {
      id: document.layoutId,
      name: document.name,
      revision: 1,
      status: 'ready' as const,
      document,
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      usage: [],
      canDelete: true
    }
    const projection = resolvedLayoutProjectionSchema.parse({
      status: 'ready',
      version: 1,
      layoutId: document.layoutId,
      name: document.name,
      revision: 1,
      document
    })
    const serialized = JSON.stringify({ resource, projection, descriptors: layoutElementDescriptors })
    for (const forbidden of [
      'runtimeComponentKey',
      'componentKey',
      'NavigationMenuItem',
      'SiteWorkspaceShell',
      'app/layouts/desk.vue',
      'UHeader',
      'className',
      'tailwind',
      '"ui"'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(JSON.stringify(registry)).toBe('{}')
    expect(Object.keys(layoutModule).some(key => key.startsWith('SiteLayout'))).toBe(false)
  })
})
