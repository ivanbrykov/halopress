import { renderToString } from '@vue/server-renderer'
import { createSSRApp, defineComponent, h, type PropType } from 'vue'
import { describe, expect, it } from 'vitest'

import { resolvedMenuNavigationItems, siteNavigationItems } from '../app/utils/site-presentation'
import type { PublicSiteMenuDocument } from '../shared/site-menu'
import { defaultSitePresentation, toPublicSitePresentation } from '../shared/site-presentation'

type RenderedNavigationItem = ReturnType<typeof siteNavigationItems>[number]

// This fixture exercises HaloPress's NavigationMenuItem adapter only. Actual
// public-route horizontal Nuxt UI SSR is covered by the built Worker smoke;
// the vertical UHeader drawer is intentionally unmounted until opened and is a
// browser/runtime contract.
const NavigationItemAdapterFixture = defineComponent({
  props: {
    items: { type: Array as PropType<RenderedNavigationItem[]>, required: true },
    orientation: { type: String as PropType<'horizontal' | 'vertical'>, required: true }
  },
  setup(props) {
    const renderItem = (item: RenderedNavigationItem) => h('li', {
      'data-value': item.value,
      'data-active': String(Boolean(item.active)),
      'data-default-open': String(Boolean(item.defaultOpen))
    }, [
      item.children?.length
        ? h('span', { 'data-trigger': 'true' }, item.label)
        : h('a', { href: String(item.to), target: item.target, rel: item.rel }, item.label),
      item.children?.length
        ? h('ul', item.children.map(child => renderItem(child)))
        : null
    ])
    return () => h('div', {
      'data-adapter-consumer': props.orientation
    }, h('ul', props.items.map(renderItem)))
  }
})

function presentation(document: PublicSiteMenuDocument) {
  const value = toPublicSitePresentation(defaultSitePresentation(), new Set(), 'ssr-test')
  value.navigation = document
  return value
}

describe('public Site menu adapter contract', () => {
  it.each(['horizontal', 'vertical'] as const)('maps stable canonical navigation for a %s consumer', async (orientation) => {
    const document: PublicSiteMenuDocument = {
      version: 1,
      items: [{
        id: 'company',
        label: 'Company',
        to: '/company',
        value: 'company-stable',
        children: [{
          id: 'team',
          label: 'Team',
          to: '/company/team',
          value: 'team-stable'
        }]
      }, {
        id: 'external',
        label: 'Partners',
        to: 'https://example.com',
        value: 'external-stable',
        target: '_blank',
        rel: 'noopener noreferrer',
        children: []
      }]
    }
    const items = resolvedMenuNavigationItems(document, '/company/team')
    expect(items).toEqual(siteNavigationItems(presentation(document), '/company/team'))
    expect(items[0]).toMatchObject({
      type: 'trigger',
      active: true,
      defaultOpen: true,
      children: [{ active: true }]
    })
    const html = await renderToString(createSSRApp(NavigationItemAdapterFixture, { items, orientation }))

    expect(html).toContain(`data-adapter-consumer="${orientation}"`)
    expect(html).toContain('data-value="company-stable"')
    expect(html).toContain('data-value="team-stable"')
    expect(html).toContain('data-default-open="true"')
    expect(html).toContain('href="/company/team"')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
