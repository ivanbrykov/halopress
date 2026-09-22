// @vitest-environment happy-dom

import { useSortable } from '@vueuse/integrations/useSortable'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Site menu Sortable runtime lifecycle', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('attaches one configured Sortable instance when the gated list mounts', async () => {
    const ready = ref(false)
    const items = ref([
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' }
    ])
    const target = ref<HTMLOListElement | null>(null)
    const host = document.createElement('div')
    document.body.append(host)

    const app = createApp(defineComponent({
      setup() {
        useSortable(target, items, {
          watchElement: true,
          handle: '.hp-menu-drag-handle',
          draggable: '.hp-menu-sort-item'
        })

        return () => ready.value
          ? h('ol', { ref: target, 'aria-label': 'Menu items' }, items.value.map(item => h('li', {
              key: item.id,
              class: 'hp-menu-sort-item'
            }, [
              h('button', { class: 'hp-menu-drag-handle', type: 'button' }, `Drag ${item.label}`),
              item.label
            ])))
          : h('p', 'Loading menu')
      }
    }))

    app.mount(host)
    await nextTick()
    expect(host.querySelector('ol')).toBeNull()

    ready.value = true
    await nextTick()

    const list = host.querySelector<HTMLOListElement>('ol[aria-label="Menu items"]')
    expect(list).not.toBeNull()
    await vi.waitFor(() => {
      expect(Object.keys(list ?? {}).filter(key => key.startsWith('Sortable'))).toHaveLength(1)
    })

    type SortableInstance = { options: { handle?: string, draggable?: string } }
    const expando = Object.keys(list ?? {}).find(key => key.startsWith('Sortable'))
    const instance = expando
      ? (list as unknown as Record<string, SortableInstance>)[expando]
      : undefined
    expect(instance?.options.handle).toBe('.hp-menu-drag-handle')
    expect(instance?.options.draggable).toBe('.hp-menu-sort-item')

    await nextTick()
    expect(Object.keys(list ?? {}).filter(key => key.startsWith('Sortable'))).toHaveLength(1)
    app.unmount()
  })
})
