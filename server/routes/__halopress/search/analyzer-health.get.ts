import { setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  try {
    const { getNodeSearchRuntime } = await import(
      '../../../search/node-runtime'
    )
    const runtime = getNodeSearchRuntime()
    const startedAt = performance.now()
    await runtime.start()
    const [compatibility, query] = await Promise.all([
      runtime.analyzer.compatibility(),
      runtime.analyzer.analyzeQuery('방에 들어가')
    ])
    return {
      ok: true,
      topology: 'node-worker-thread-sqlite',
      compatibility,
      query,
      health: runtime.health(),
      elapsedMs: Number((performance.now() - startedAt).toFixed(3))
    }
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Node search runtime is unavailable',
      data: {
        code: 'analyzer_unavailable',
        retryable: true,
        detail: error instanceof Error ? error.message : String(error)
      }
    })
  }
})
