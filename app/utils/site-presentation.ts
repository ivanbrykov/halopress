import type { NavigationMenuItem } from '@nuxt/ui'
import type { ResolvedSiteMenuDocument, ResolvedSiteMenuLeaf } from '~~/shared/site-menu'
import type { PublicSitePresentation } from '~~/shared/site-presentation'

const colorShades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

/** Finite code-owned bridge from Halo Theme tokens to Nuxt UI semantics. */
export function haloThemeAdapterStyle() {
  return {
    '--ui-primary': 'var(--halo-site-color-primary, var(--color-purple-500))',
    '--ui-secondary': 'var(--halo-site-color-secondary, var(--color-blue-500))',
    '--ui-success': 'var(--halo-site-color-success, var(--color-green-600))',
    '--ui-info': 'var(--halo-site-color-info, var(--color-sky-600))',
    '--ui-warning': 'var(--halo-site-color-warning, var(--color-amber-600))',
    '--ui-error': 'var(--halo-site-color-error, var(--color-red-600))',
    '--ui-text': 'var(--halo-site-color-text, var(--color-zinc-700))',
    '--ui-text-dimmed': 'var(--halo-site-color-text-dimmed, var(--color-zinc-400))',
    '--ui-text-muted': 'var(--halo-site-color-text-muted, var(--color-zinc-500))',
    '--ui-text-toned': 'var(--halo-site-color-text-toned, var(--color-zinc-600))',
    '--ui-text-highlighted': 'var(--halo-site-color-text-highlighted, var(--color-zinc-900))',
    '--ui-text-inverted': 'var(--halo-site-color-text-inverted, white)',
    '--ui-bg': 'var(--halo-site-color-background, white)',
    '--ui-bg-muted': 'var(--halo-site-color-background-muted, var(--color-zinc-50))',
    '--ui-bg-elevated': 'var(--halo-site-color-background-elevated, var(--color-zinc-100))',
    '--ui-bg-accented': 'var(--halo-site-color-background-accented, var(--color-zinc-200))',
    '--ui-bg-inverted': 'var(--halo-site-color-background-inverted, var(--color-zinc-900))',
    '--ui-border': 'var(--halo-site-color-border, var(--color-zinc-200))',
    '--ui-border-muted': 'var(--halo-site-color-border-muted, var(--color-zinc-200))',
    '--ui-border-accented': 'var(--halo-site-color-border-accented, var(--color-zinc-300))',
    '--ui-border-inverted': 'var(--halo-site-color-border-inverted, var(--color-zinc-900))',
    '--ui-radius': 'var(--halo-radius-control, 0.25rem)'
  }
}

export function siteThemeStyle(presentation: PublicSitePresentation, haloThemeEnabled = false) {
  const style: Record<string, string> = haloThemeEnabled
    ? haloThemeAdapterStyle()
    : {}
  if (!haloThemeEnabled) {
    for (const shade of colorShades) {
      style[`--ui-color-primary-${shade}`] = `var(--color-${presentation.appearance.primaryColor}-${shade})`
      style[`--ui-color-neutral-${shade}`] = `var(--color-${presentation.appearance.neutralColor}-${shade})`
    }
    style['--ui-radius'] = ({ none: '0rem', sm: '0.125rem', md: '0.25rem', lg: '0.5rem' })[presentation.appearance.radius]
    style['--site-line-height'] = ({ compact: '1.45', default: '1.6', relaxed: '1.75' })[presentation.appearance.typographyScale]
  }
  if (presentation.shell.width === 'wide') style['--ui-container'] = '96rem'
  if (presentation.shell.width === 'centered') style['--ui-container'] = '64rem'
  return style
}

function navigationLeaf(item: ResolvedSiteMenuLeaf, currentPath: string): NavigationMenuItem {
  const internal = item.to.startsWith('/')
  return {
    label: item.label,
    to: item.to,
    active: internal && (currentPath === item.to || (item.to !== '/' && currentPath.startsWith(item.to))),
    target: item.target,
    rel: item.rel,
    value: item.value,
    icon: item.icon,
    badge: item.badge
  }
}

export function resolvedMenuNavigationItems(
  document: ResolvedSiteMenuDocument,
  currentPath: string
): NavigationMenuItem[] {
  return document.items.map((item) => {
    const parent = navigationLeaf(item, currentPath)
    const children = item.children.map(child => navigationLeaf(child, currentPath))
    if (!children.length) return parent
    const activeChild = children.some(child => child.active)

    // Nuxt UI otherwise treats child-bearing parents as horizontal triggers but
    // vertical links with a separate chevron. Make both orientations explicit:
    // while children exist, the parent is a trigger and its saved destination is
    // retained for use if those children are later removed.
    return {
      ...parent,
      to: undefined,
      target: undefined,
      rel: undefined,
      type: 'trigger',
      active: Boolean(parent.active || activeChild),
      defaultOpen: activeChild,
      children
    }
  })
}

export function siteNavigationItems(presentation: PublicSitePresentation, currentPath: string): NavigationMenuItem[] {
  return resolvedMenuNavigationItems(presentation.navigation, currentPath)
}

export function siteFooterLinks(presentation: PublicSitePresentation, currentPath: string): NavigationMenuItem[] {
  return presentation.footer.links.map((item) => {
    const externalWindow = item.destination.type === 'external' && item.destination.newWindow
    return {
      label: item.label,
      to: item.to,
      active: item.to.startsWith('/')
        && (currentPath === item.to || (item.to !== '/' && currentPath.startsWith(item.to))),
      value: item.id,
      target: externalWindow ? '_blank' : undefined,
      rel: externalWindow ? 'noopener noreferrer' : undefined
    }
  })
}
