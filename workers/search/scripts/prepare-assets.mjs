import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const generatedAssetsOutput = new URL('../src/generated-assets/', import.meta.url)
const generatedDescriptorOutput = new URL('../src/generated-analyzer/', import.meta.url)
await Promise.all([
  mkdir(generatedAssetsOutput, { recursive: true }),
  mkdir(generatedDescriptorOutput, { recursive: true })
])

for (const [specifier, filename] of [
  ['garu-ko/worker/wasm-module', 'garu_wasm_bg.wasm'],
  ['garu-ko/worker/model', 'base.gmdl']
]) {
  const source = fileURLToPath(import.meta.resolve(specifier))
  await copyFile(source, fileURLToPath(new URL(filename, generatedAssetsOutput)))
}

const tokenizer = await import('../../../packages/korean-search-tokenizer/src/index.ts')
const model = await readFile(new URL('../src/generated-assets/base.gmdl', import.meta.url))
const wasm = await readFile(new URL('../src/generated-assets/garu_wasm_bg.wasm', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const compatibilityDate = '2026-05-18'
const compatibilityFlags = ['nodejs_compat', 'global_fetch_strictly_public']
const modelSha256 = sha256(model)
const wasmSha256 = sha256(wasm)
const analyzerSources = [
  '../../../shared/search-analyzer.ts',
  '../src/analyzer-batch.ts',
  '../../../server/search/node-analyzer-worker-source.ts',
  '../../../packages/korean-search-tokenizer/src/index.ts',
  '../../../packages/korean-search-tokenizer/src/worker.ts'
]
const analyzerSourceSha256 = sha256(Buffer.concat(await Promise.all(
  analyzerSources.map(async (path) => {
    const contents = await readFile(new URL(path, import.meta.url))
    return Buffer.concat([Buffer.from(`${path}\0`), contents, Buffer.from('\0')])
  })
)))
if (modelSha256 !== tokenizer.KOREAN_SEARCH_MODEL_SHA256) {
  throw new Error(`Garu model digest changed: expected ${tokenizer.KOREAN_SEARCH_MODEL_SHA256}, got ${modelSha256}`)
}

const artifactIdentity = sha256(JSON.stringify({
  compatibilityDate,
  compatibilityFlags,
  contractVersion: tokenizer.KOREAN_SEARCH_CONTRACT_VERSION,
  tokenizerGeneration: tokenizer.KOREAN_SEARCH_TOKENIZER_GENERATION,
  analyzerSourceSha256,
  modelSha256,
  wasmSha256
}))
const descriptor = {
  artifactVersionId: `halopress-garu-${artifactIdentity.slice(0, 32)}`,
  artifactDescriptorSha256: artifactIdentity,
  objectName: `garu:${artifactIdentity}`,
  compatibilityDate,
  compatibilityFlags,
  tokenizerGeneration: tokenizer.KOREAN_SEARCH_TOKENIZER_GENERATION,
  contractVersion: tokenizer.KOREAN_SEARCH_CONTRACT_VERSION,
  analyzerSources,
  analyzerSourceSha256,
  modelSha256,
  wasmSha256,
  modelBytes: model.byteLength,
  wasmBytes: wasm.byteLength
}

await writeFile(
  new URL('../src/generated-analyzer/descriptor.json', import.meta.url),
  `${JSON.stringify(descriptor, null, 2)}\n`
)

process.stdout.write(`${JSON.stringify(descriptor)}\n`)
