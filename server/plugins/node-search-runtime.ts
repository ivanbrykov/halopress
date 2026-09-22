export default defineNitroPlugin((nitroApp) => {
  // Cloudflare exposes WebSocketPair. Keep the Node runtime completely dormant
  // in the Worker while the same Nitro handlers use the injected DO analyzer.
  if (typeof (globalThis as any).WebSocketPair !== 'undefined') return

  const start = import('../search/node-runtime').then(async (module) => {
    try {
      await module.startNodeSearchRuntime()
      console.log(JSON.stringify({
        event: 'halopress.search.topology',
        ...module.getNodeSearchRuntime().health()
      }))
    } catch (error) {
      console.error(JSON.stringify({
        event: 'halopress.search.node_startup',
        outcome: 'unavailable',
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  })

  nitroApp.hooks.hook('close', async () => {
    await start
    const module = await import('../search/node-runtime')
    await module.stopNodeSearchRuntime()
  })
})
