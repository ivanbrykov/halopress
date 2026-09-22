import { DurableObject } from 'cloudflare:workers'

import { createWorkerTokenizer } from '@halopress/korean-search-tokenizer/worker'

import analyzerDescriptor from './generated-analyzer/descriptor.json'
import garuModel from './generated-assets/base.gmdl'
import garuWasmModule from './generated-assets/garu_wasm_bg.wasm'
import { analyzeSearchBatch } from './analyzer-batch'
import {
  SEARCH_ANALYZER_CONTRACT_VERSION,
  type SearchAnalyzerBatchRequest
} from '../../../shared/search-analyzer'
import type { DurableSearchAnalyzer } from './durable-analyzer-client'

type DurableAnalyzerDescriptor = {
  artifactVersionId: string
  objectName: string
  tokenizerGeneration: string
  modelBytes: number
}

const descriptor = analyzerDescriptor as DurableAnalyzerDescriptor

export class AnalyzerDurableObject extends DurableObject implements DurableSearchAnalyzer {
  private tokenizer() {
    return createWorkerTokenizer({
      wasmModule: garuWasmModule,
      modelData: garuModel
    })
  }

  async metadata() {
    return (await this.tokenizer()).metadata
  }

  async compatibility() {
    const wasmModuleTag = Object.prototype.toString.call(garuWasmModule)
    if (wasmModuleTag !== '[object WebAssembly.Module]') {
      throw new TypeError(`Durable Object Wasm module has an unsupported representation: ${wasmModuleTag}`)
    }
    return {
      analyzerContractVersion: SEARCH_ANALYZER_CONTRACT_VERSION,
      artifactVersionId: descriptor.artifactVersionId,
      objectName: descriptor.objectName,
      tokenizer: (await this.tokenizer()).metadata,
      wasmModuleTag,
      modelByteLength: garuModel.byteLength
    } as const
  }

  async analyzeQuery(input: string) {
    return (await this.tokenizer()).analyzeQuery(input)
  }

  async analyzeBatch(request: SearchAnalyzerBatchRequest) {
    const startedAt = performance.now()
    const tokenizer = await this.tokenizer()
    const response = analyzeSearchBatch(tokenizer, request)
    console.log(JSON.stringify({
      event: 'halopress.search.durable_analyzer_batch',
      topology: 'durable-object',
      artifactVersionId: descriptor.artifactVersionId,
      objectName: descriptor.objectName,
      batchId: response.batchId,
      batchSize: response.items.length,
      failedItems: response.items.filter(item => !item.ok).length,
      elapsedMs: Number((performance.now() - startedAt).toFixed(3))
    }))
    return response
  }
}
