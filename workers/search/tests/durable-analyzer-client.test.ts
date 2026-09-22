import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { describe, expect, it, vi } from 'vitest'

import {
  SEARCH_ANALYZER_ARTIFACT_VERSION_ID
} from '../../../shared/search-analyzer-artifact'
import {
  createDurableSearchAnalyzer,
  DURABLE_ANALYZER_DESCRIPTOR
} from '../src/durable-analyzer-client'

describe('Durable analyzer identity and client', () => {
  it('uses the complete content-derived object name for every RPC', async () => {
    const compatibility = {
      analyzerContractVersion: 1 as const,
      artifactVersionId: DURABLE_ANALYZER_DESCRIPTOR.artifactVersionId,
      objectName: DURABLE_ANALYZER_DESCRIPTOR.objectName,
      tokenizer: {
        contractVersion: 1 as const,
        tokenizerGeneration: DURABLE_ANALYZER_DESCRIPTOR.tokenizerGeneration as any,
        engineVersion: 'garu-ko@0.9.11' as const,
        modelVersion: '0.9.11',
        modelSha256: '5186b7ccf18bd1544523f408f1b7aa2a14b09b1c2d27ce96185afd49aa08e741' as const,
        profileVersion: 1 as const,
        normalization: 'NFC' as const
      },
      wasmModuleTag: '[object WebAssembly.Module]' as const,
      modelByteLength: DURABLE_ANALYZER_DESCRIPTOR.modelBytes
    }
    const stub = {
      metadata: vi.fn(async () => compatibility.tokenizer),
      compatibility: vi.fn(async () => compatibility),
      analyzeQuery: vi.fn(),
      analyzeBatch: vi.fn()
    }
    const idFromName = vi.fn(() => 'object-id')
    const get = vi.fn(() => stub)

    const client = createDurableSearchAnalyzer({ idFromName, get })
    await expect(client.compatibility()).resolves.toEqual(compatibility)
    expect(idFromName).toHaveBeenCalledWith(DURABLE_ANALYZER_DESCRIPTOR.objectName)
    expect(get).toHaveBeenCalledWith('object-id')
  })

  it('binds object identity to every descriptor input', async () => {
    const descriptorPath = resolve(
      import.meta.dirname,
      '../src/generated-analyzer/descriptor.json'
    )
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
    const identityInput = {
      compatibilityDate: descriptor.compatibilityDate,
      compatibilityFlags: descriptor.compatibilityFlags,
      contractVersion: descriptor.contractVersion,
      tokenizerGeneration: descriptor.tokenizerGeneration,
      analyzerSourceSha256: descriptor.analyzerSourceSha256,
      modelSha256: descriptor.modelSha256,
      wasmSha256: descriptor.wasmSha256
    }
    const digest = (value: unknown) => createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')

    expect(descriptor.artifactDescriptorSha256).toBe(digest(identityInput))
    expect(descriptor.artifactVersionId).toBe(SEARCH_ANALYZER_ARTIFACT_VERSION_ID)
    expect(descriptor.objectName).toBe(`garu:${digest(identityInput)}`)
    expect(digest({ ...identityInput, analyzerSourceSha256: 'changed-fixture' }))
      .not.toBe(descriptor.artifactDescriptorSha256)
  })

  it('binds identity to the main compatibility date and flags', async () => {
    const root = resolve(import.meta.dirname, '../../..')
    const descriptor = JSON.parse(await readFile(resolve(
      import.meta.dirname,
      '../src/generated-analyzer/descriptor.json'
    ), 'utf8'))
    const mainConfig = parseJsonc(await readFile(
      resolve(root, 'wrangler.jsonc'),
      'utf8'
    ))
    const probeConfig = parseJsonc(await readFile(
      resolve(import.meta.dirname, '../wrangler.durable-probe.jsonc'),
      'utf8'
    ))

    expect(descriptor.compatibilityDate).toBe(mainConfig.compatibility_date)
    expect(descriptor.compatibilityFlags).toEqual(mainConfig.compatibility_flags)
    expect(probeConfig.compatibility_date).toBe(descriptor.compatibilityDate)
    expect(probeConfig.compatibility_flags).toEqual(descriptor.compatibilityFlags)
  })
})
