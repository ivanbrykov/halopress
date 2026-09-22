import { isSafePageUrl } from '~~/shared/page-blocks'

export type PageBlockLinkDraft = {
  label: string
  to: string
  target: '_self' | '_blank'
  icon?: string
  color?: string
  variant?: string
  original: Record<string, unknown>
  error?: string
}

function curatedLinkProperties(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const candidate = value as Record<string, unknown>
  return Object.fromEntries(
    ['label', 'to', 'target', 'icon', 'color', 'variant']
      .filter(key => candidate[key] !== undefined)
      .map(key => [key, candidate[key]])
  )
}

export function createPageBlockLinkDrafts(value: unknown): PageBlockLinkDraft[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map((item) => {
    const original = curatedLinkProperties(item)
    return {
      label: typeof original.label === 'string' ? original.label : '',
      to: typeof original.to === 'string' ? original.to : '',
      target: original.target === '_blank' ? '_blank' as const : '_self' as const,
      icon: typeof original.icon === 'string' ? original.icon : '',
      color: typeof original.color === 'string' ? original.color : '',
      variant: typeof original.variant === 'string' ? original.variant : '',
      original: { ...original }
    }
  })
}

export function commitPageBlockLink(
  current: unknown,
  index: number,
  draft: PageBlockLinkDraft
): { links?: Record<string, unknown>[], error?: string } {
  if (!isSafePageUrl(draft.to)) return { error: 'Use a relative, http(s), mailto, tel, or fragment URL.' }

  const links = Array.isArray(current)
    ? current.slice(0, 12).map(curatedLinkProperties)
    : []
  if (index < 0 || index >= 12) return { error: 'A block can have at most 12 links.' }

  const next: Record<string, unknown> = {
    ...draft.original,
    label: draft.label,
    to: draft.to
  }
  if (draft.target === '_blank') next.target = '_blank'
  else delete next.target
  if (draft.icon) next.icon = draft.icon
  else delete next.icon
  if (draft.color) next.color = draft.color
  else delete next.color
  if (draft.variant) next.variant = draft.variant
  else delete next.variant
  links[index] = next
  return { links }
}

export function movePageBlockLink(
  drafts: PageBlockLinkDraft[],
  current: unknown,
  index: number,
  direction: -1 | 1
): { drafts: PageBlockLinkDraft[], links: Record<string, unknown>[] } | undefined {
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= drafts.length) return undefined

  const nextDrafts = [...drafts]
  const [draft] = nextDrafts.splice(index, 1)
  nextDrafts.splice(destination, 0, draft!)

  const links = Array.isArray(current)
    ? current.slice(0, 12).map(curatedLinkProperties)
    : []
  const [link] = links.splice(index, 1)
  links.splice(destination, 0, link ?? {})

  return { drafts: nextDrafts, links }
}
