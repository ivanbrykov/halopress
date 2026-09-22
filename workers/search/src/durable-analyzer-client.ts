import analyzerDescriptor from './generated-analyzer/descriptor.json'
import type {
  SearchAnalyzer,
  SearchAnalyzerCompatibility
} from '../../../shared/search-analyzer'

export type DurableAnalyzerDescriptor = {
  artifactVersionId: string
  objectName: string
  tokenizerGeneration: string
  modelBytes: number
}

type AnalyzerDurableObjectNamespace = {
  idFromName(name: string): unknown
  get(id: unknown): DurableSearchAnalyzer
}

export const DURABLE_ANALYZER_DESCRIPTOR = analyzerDescriptor as DurableAnalyzerDescriptor

export type DurableAnalyzerCompatibility = SearchAnalyzerCompatibility & {
  objectName: string
  wasmModuleTag: '[object WebAssembly.Module]'
  modelByteLength: number
}

export type DurableSearchAnalyzer = Omit<SearchAnalyzer, 'compatibility'> & {
  compatibility(): Promise<DurableAnalyzerCompatibility>
}

function eventLog(event: string, detail: Record<string, unknown>) {
  console.log(JSON.stringify({
    event,
    topology: 'durable-object',
    artifactVersionId: DURABLE_ANALYZER_DESCRIPTOR.artifactVersionId,
    objectName: DURABLE_ANALYZER_DESCRIPTOR.objectName,
    tokenizerGeneration: DURABLE_ANALYZER_DESCRIPTOR.tokenizerGeneration,
    ...detail
  }))
}

export function createDurableSearchAnalyzer(
  namespace: AnalyzerDurableObjectNamespace
): DurableSearchAnalyzer {
  const object = namespace.get(namespace.idFromName(
    DURABLE_ANALYZER_DESCRIPTOR.objectName
  ))
  const invoke = async <T>(operation: string, call: () => Promise<T>) => {
    const startedAt = performance.now()
    try {
      const result = await call()
      eventLog('halopress.search.durable_analyzer_request', {
        operation,
        elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
        outcome: 'ok'
      })
      return result
    } catch (error) {
      eventLog('halopress.search.durable_analyzer_request', {
        operation,
        elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }
  return {
    metadata: () => invoke('metadata', () => object.metadata()),
    async compatibility() {
      const result = await invoke('compatibility', () => object.compatibility())
      if (result.wasmModuleTag !== '[object WebAssembly.Module]'
        || result.modelByteLength !== DURABLE_ANALYZER_DESCRIPTOR.modelBytes
        || result.artifactVersionId !== DURABLE_ANALYZER_DESCRIPTOR.artifactVersionId
        || result.objectName !== DURABLE_ANALYZER_DESCRIPTOR.objectName
        || result.tokenizer.tokenizerGeneration !== DURABLE_ANALYZER_DESCRIPTOR.tokenizerGeneration) {
        throw new Error('Durable analyzer compatibility response does not match its generated descriptor')
      }
      return result
    },
    analyzeQuery: input => invoke('analyzeQuery', () => object.analyzeQuery(input)),
    analyzeBatch: request => invoke(
      'analyzeBatch',
      () => object.analyzeBatch(request)
    )
  }
}
