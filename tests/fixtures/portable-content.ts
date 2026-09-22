export const portableContentFixture = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, textAlign: 'center', class: 'fixed', id: 'author-id' },
      content: [{ type: 'text', text: 'Portable <content>' }]
    },
    {
      type: 'paragraph',
      attrs: { style: 'position:fixed', onClick: 'alert(1)' },
      content: [
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' underline', marks: [{ type: 'underline' }] },
        { type: 'text', text: ' strike', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' code', marks: [{ type: 'code' }] },
        {
          type: 'text',
          text: ' safe link',
          marks: [{ type: 'link', attrs: { href: '/docs?from=fixture#start', target: '_blank', class: 'fixed' } }]
        },
        {
          type: 'text',
          text: ' unsafe link',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', target: '_blank' } }]
        },
        { type: 'hardBreak' },
        { type: 'mention', attrs: { id: 'editor', label: 'Editor <one>', class: 'fixed' } }
      ]
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A portable quote' }] }]
    },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }] }]
    },
    {
      type: 'orderedList',
      attrs: { start: 3, class: 'fixed' },
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered' }] }] }]
    },
    { type: 'codeBlock', attrs: { language: 'html', class: 'language-html' }, content: [{ type: 'text', text: '<script>not executable</script>' }] },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { src: '/assets/rich-image/raw?rev=1#preview', alt: 'Rich <image>', class: 'fixed', onError: 'alert(1)' } },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageHero',
        props: {
          headline: 'Portable contract',
          title: 'Hero <title>',
          description: 'A framework-independent hero.',
          orientation: 'horizontal',
          links: [{ label: 'Read docs', to: '/docs', target: '_blank', icon: 'i-lucide-arrow-right' }],
          class: 'fixed inset-0'
        },
        advanced: { class: 'fixed', style: 'display:none' },
        media: { url: '/assets/hero/raw', alt: 'Hero image', width: 1200, height: 800, onError: 'alert(1)' }
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageCard',
        props: {
          icon: 'i-lucide-book-open',
          title: 'Portable card',
          description: 'A linked card.',
          orientation: 'horizontal',
          variant: 'outline',
          highlight: true,
          highlightColor: 'primary',
          spotlight: true,
          spotlightColor: 'primary',
          to: '/card',
          target: '_blank'
        },
        advanced: {},
        media: { url: '/assets/card/raw', alt: 'Card image' }
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageSection',
        props: {
          headline: 'Features',
          title: 'Portable section',
          description: 'A responsive section.',
          icon: 'i-lucide-sparkles',
          orientation: 'horizontal',
          reverse: true,
          features: [
            { title: 'Semantic HTML', description: 'No framework runtime.', icon: 'i-lucide-badge-check', to: '/semantic' },
            { title: 'Safe output', description: 'Allowlisted attributes only.', icon: 'i-lucide-heart' }
          ],
          links: [{ label: 'Explore', to: 'https://example.org/explore', variant: 'soft' }]
        },
        advanced: {},
        media: { url: '/assets/section/raw', alt: 'Section image' }
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageTestimonial',
        props: { quote: 'It works everywhere.', author: 'A. Reader', role: 'Editor', company: 'Example' },
        advanced: {},
        media: { url: '/assets/portrait/raw', alt: 'Reader portrait' }
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageLogos',
        props: {
          title: 'Trusted teams',
          items: [
            { name: 'Halo', src: '/assets/logo/raw', alt: 'Halo logo' },
            { name: 'Text fallback', src: '' }
          ]
        },
        advanced: {},
        media: {}
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageFAQ',
        props: {
          headline: 'FAQ',
          title: 'Questions',
          items: [{ question: 'Does it need Vue?', answer: 'No.' }]
        },
        advanced: {},
        media: {}
      }
    },
    {
      type: 'pageBlock',
      attrs: {
        component: 'pageCTA',
        props: {
          title: 'Ship portable content',
          description: 'Use the API envelope and versioned stylesheet.',
          orientation: 'horizontal',
          variant: 'solid',
          links: [{ label: 'Get started', to: '/start', icon: 'i-lucide-arrow-right' }]
        },
        advanced: {},
        media: { url: '/assets/cta/raw', alt: 'CTA image' }
      }
    }
  ]
} as const
