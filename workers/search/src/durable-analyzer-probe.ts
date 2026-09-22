import {
  AnalyzerDurableObject
} from './durable-analyzer'
import {
  createDurableSearchAnalyzer,
  DURABLE_ANALYZER_DESCRIPTOR
} from './durable-analyzer-client'

type Env = {
  ANALYZER: Parameters<typeof createDurableSearchAnalyzer>[0]
}

const fixtures = [
  '아버지가 방에 들어가신다.',
  '어머니가 방에 들어가신다.',
  '방에 들어가'
]

export { AnalyzerDurableObject }

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname !== '/compatibility') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    try {
      const analyzer = createDurableSearchAnalyzer(env.ANALYZER)
      const startedAt = performance.now()
      const compatibility = await analyzer.compatibility()
      const first = await analyzer.analyzeBatch({
        batchId: 'compatibility-cold',
        items: fixtures.map((input, index) => ({ id: `fixture-${index}`, input }))
      })
      const warmStartedAt = performance.now()
      const second = await analyzer.analyzeBatch({
        batchId: 'compatibility-warm',
        items: fixtures.map((input, index) => ({ id: `fixture-${index}`, input }))
      })
      return Response.json({
        ok: true,
        topology: 'durable-object',
        probeRuntime: {
          compatibilityDate: '2026-05-18',
          compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public']
        },
        descriptor: DURABLE_ANALYZER_DESCRIPTOR,
        fixtures: first.items.map((result, index) => ({
          input: fixtures[index],
          id: result.id,
          ok: result.ok,
          rawTerms: result.ok ? result.terms.rawTerms : [],
          morphTerms: result.ok ? result.terms.morphTerms : [],
          error: result.ok ? undefined : result.error
        })),
        compatibility,
        repeatedParity: JSON.stringify(first.items) === JSON.stringify(second.items),
        timings: {
          coldAndFixturesMs: Number((warmStartedAt - startedAt).toFixed(3)),
          warmFixturesMs: Number((performance.now() - warmStartedAt).toFixed(3))
        },
        limitations: [
          'Wasm is a deploy-time CompiledWasm module; raw bytes in Durable Object storage cannot replace deploy-time compilation.',
          'Each analyzer RPC is an additional Durable Object request; document chunks are batched four at a time.'
        ]
      })
    } catch (error) {
      return Response.json({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined
        }
      }, { status: 500 })
    }
  }
}
