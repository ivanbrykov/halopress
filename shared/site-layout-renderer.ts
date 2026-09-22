import type { LayoutElement, LayoutElementOfType, LayoutElementType } from './site-layout'

/**
 * Exhaustive code-owned renderer seam for #73. A renderer is selected only by
 * a validated semantic LayoutElement.type. There is deliberately no persisted
 * or API-facing component key, import path, or dynamic lookup string.
 */
export type LayoutRenderer<Element extends LayoutElement = LayoutElement, Result = unknown> = (
  element: Element
) => Result

export type LayoutRendererRegistry<Result = unknown> = {
  [Type in LayoutElementType]: LayoutRenderer<LayoutElementOfType<Type>, Result>
}

export function defineLayoutRendererRegistry<Result>(registry: LayoutRendererRegistry<Result>) {
  return Object.freeze({ ...registry }) as Readonly<LayoutRendererRegistry<Result>>
}

export function resolveLayoutRenderer<Result>(
  registry: Readonly<LayoutRendererRegistry<Result>>,
  element: LayoutElement
): LayoutRenderer<LayoutElement, Result> {
  // The discriminated element type is the only lookup input. Runtime #73 code
  // owns this exhaustive registry; documents cannot name or replace entries.
  return registry[element.type] as LayoutRenderer<LayoutElement, Result>
}
