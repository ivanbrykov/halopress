import { defineComponent, h, type PropType, type VNodeChild } from 'vue'

import type { AuthoredTextNode } from '~~/shared/authored-document'

const markTags = {
  bold: 'strong',
  italic: 'em',
  strike: 's',
  code: 'code',
  underline: 'u'
} as const

export default defineComponent({
  name: 'SiteTextNode',
  props: {
    node: {
      type: Object as PropType<AuthoredTextNode>,
      required: true
    }
  },
  setup(props) {
    return () => {
      let child: VNodeChild = props.node.text
      for (let index = props.node.marks.length - 1; index >= 0; index -= 1) {
        const mark = props.node.marks[index]!
        if (mark.type === 'link') {
          child = h('a', {
            class: 'site-document-link',
            href: mark.href,
            ...(mark.target === '_blank'
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})
          }, child)
          continue
        }
        child = h(markTags[mark.type], child)
      }
      return child
    }
  }
})
