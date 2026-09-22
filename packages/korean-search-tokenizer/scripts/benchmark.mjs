import { performance } from 'node:perf_hooks'
import { Garu } from 'garu-ko'

const sentence = '학교에서 Cloudflare Workers AI와 BM25 검색을 공부하고 점심을 먹었다.'
const samples = [5, 10, 50, 75]
const started = performance.now()
const garu = await Garu.load()
const coldInitializationMs = performance.now() - started
const measurements = []

for (const count of samples) {
  const text = Array.from({ length: count }, () => sentence).join(' ')
  const warmStarted = performance.now()
  const result = garu.analyze(text)
  measurements.push({
    sentences: count,
    utf8Bytes: Buffer.byteLength(text),
    elapsedMs: performance.now() - warmStarted,
    analyzerElapsedMs: result.elapsed,
    tokens: result.tokens.length
  })
}

const queryStarted = performance.now()
garu.analyze('학교에서 먹었다')
const warmQueryMs = performance.now() - queryStarted

console.log(JSON.stringify({
  runtime: process.version,
  model: garu.modelInfo(),
  coldInitializationMs,
  warmQueryMs,
  measurements
}, null, 2))
garu.destroy()
