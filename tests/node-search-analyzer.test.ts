import { afterEach, describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'

import {
  KOREAN_SEARCH_TOKENIZER_GENERATION
} from '@halopress/korean-search-tokenizer'

import {
  NodeSearchAnalyzerExecutor
} from '../server/search/node-analyzer-executor'
import {
  NODE_ANALYZER_WORKER_SOURCE
} from '../server/search/node-analyzer-worker-source'
import {
  SEARCH_ANALYZER_ARTIFACT_VERSION_ID
} from '../shared/search-analyzer-artifact'

let executor: NodeSearchAnalyzerExecutor | null = null

afterEach(async () => {
  await executor?.stop()
  executor = null
})

async function waitForAvailable(current: NodeSearchAnalyzerExecutor) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (current.availability().status === 'available') return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Node analyzer did not restart')
}

describe('Node Worker Thread search analyzer', () => {
  it('initializes one pinned generation and returns the fixed Korean terms', async () => {
    executor = new NodeSearchAnalyzerExecutor()
    expect(executor.availability()).toMatchObject({
      status: 'initializing',
      retryable: true
    })
    const cold = await executor.start()
    const compatibility = await executor.compatibility()

    expect(cold).toMatchObject({
      status: 'available',
      metrics: {
        modelBytes: 1_438_231
      }
    })
    expect(cold.metrics!.initializationMs).toBeGreaterThan(0)
    expect(cold.metrics!.rssBytes).toBeGreaterThan(cold.metrics!.modelBytes)
    expect(compatibility).toMatchObject({
      analyzerContractVersion: 1,
      artifactVersionId: SEARCH_ANALYZER_ARTIFACT_VERSION_ID,
      tokenizer: {
        tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION
      }
    })
    await expect(executor.analyzeQuery('방에 들어가')).resolves.toMatchObject({
      rawTerms: ['방에', '들어가'],
      morphTerms: ['방', '들어가']
    })
    await expect(executor.analyzeQuery('학교')).resolves.toMatchObject({
      rawTerms: ['학교'],
      morphTerms: ['학교']
    })
    await expect(executor.analyzeQuery('먹다')).resolves.toMatchObject({
      rawTerms: ['먹다'],
      morphTerms: ['먹']
    })
  })

  it('keeps ordered batch errors typed and analysis off the main event loop', async () => {
    executor = new NodeSearchAnalyzerExecutor()
    await executor.start()
    let timerFired = false
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 0)
    })
    const batch = executor.analyzeBatch({
      batchId: 'node-batch',
      items: [
        { id: 'valid', input: '학교에서 밥을 먹었다.' },
        { id: 'invalid', input: '가'.repeat(25 * 1024) }
      ]
    })
    await timer
    expect(timerFired).toBe(true)
    await expect(batch).resolves.toMatchObject({
      batchId: 'node-batch',
      tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
      items: [
        { id: 'valid', ok: true },
        {
          id: 'invalid',
          ok: false,
          error: { code: 'invalid_input', retryable: false }
        }
      ]
    })
    expect(executor.availability().metrics!.lastCallMs).toBeGreaterThanOrEqual(0)
  })

  it('restarts a crashed thread and serves the same analyzer generation', async () => {
    executor = new NodeSearchAnalyzerExecutor()
    await executor.start()
    await executor.crashForTests()
    await waitForAvailable(executor)

    await expect(executor.analyzeQuery('먹다')).resolves.toMatchObject({
      tokenizerGeneration: KOREAN_SEARCH_TOKENIZER_GENERATION,
      morphTerms: ['먹']
    })
    await expect(executor.compatibility()).resolves.toMatchObject({
      artifactVersionId: SEARCH_ANALYZER_ARTIFACT_VERSION_ID
    })
  })

  it('exits instead of retaining a message listener after initialization fails', async () => {
    const worker = new Worker(NODE_ANALYZER_WORKER_SOURCE, {
      eval: true,
      workerData: {
        garuModule: 'file:///halopress-missing-garu-module.mjs'
      }
    })
    const exited = new Promise<number>((resolve) => {
      worker.once('exit', resolve)
    })
    try {
      await expect(new Promise((resolve) => {
        worker.once('message', resolve)
      })).resolves.toMatchObject({
        kind: 'initialization-error'
      })
      await expect(exited).resolves.toBe(0)
    } finally {
      await worker.terminate()
    }
  })
})
