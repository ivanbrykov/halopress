const PUBLIC_COLOR_MODE_BRIDGE_ID = 'halo-public-color-mode-bridge'
const PUBLIC_COLOR_MODE_BRIDGE_PATTERN = new RegExp(
  `<script(?=[^>]*\\bid="${PUBLIC_COLOR_MODE_BRIDGE_ID}")[^>]*>[\\s\\S]*?<\\/script>`
)

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response) => {
    if (typeof response.body !== 'string' || !response.body.includes(PUBLIC_COLOR_MODE_BRIDGE_ID)) return
    const bridge = response.body.match(PUBLIC_COLOR_MODE_BRIDGE_PATTERN)?.[0]
    if (!bridge || !response.body.includes('</head>')) return

    // @nuxtjs/color-mode appends its storage-aware helper from a render:html
    // hook after Unhead has rendered layout scripts. Move the Halo-owned
    // bridge to the final head position so the server-resolved Site preference
    // wins before CSS paint and is the helper state hydrated by the client.
    response.body = response.body
      .replace(bridge, '')
      .replace('</head>', `${bridge}</head>`)
  })
})
