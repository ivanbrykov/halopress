import { toRaw } from 'vue'

import type { PageBlockAttrs } from './types'

export function clonePageBlockAttrs(attrs: PageBlockAttrs): PageBlockAttrs {
  return {
    component: attrs.component,
    props: structuredClone(toRaw(attrs.props)),
    advanced: structuredClone(toRaw(attrs.advanced)),
    media: structuredClone(toRaw(attrs.media))
  }
}
