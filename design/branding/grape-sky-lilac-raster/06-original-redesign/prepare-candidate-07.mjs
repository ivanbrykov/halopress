import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const sourcePath = process.env.CANDIDATE_SOURCE
  ?? fileURLToPath(new URL('./candidate-07-original-proportions-chroma.png', import.meta.url))
const outputPath = process.env.CANDIDATE_OUTPUT
  ?? fileURLToPath(new URL('./candidate-07-original-proportions.png', import.meta.url))
const protectedReferencePath = fileURLToPath(new URL('../../halopress-theme-grape-sky.png', import.meta.url))
const referenceCropPath = process.env.CANDIDATE_REFERENCE
  ?? fileURLToPath(new URL('./reference-grape-sky-right.png', import.meta.url))
const comparisonPath = process.env.CANDIDATE_COMPARISON
  ?? fileURLToPath(new URL('./candidate-07-comparison.png', import.meta.url))

const transparentDistance = 45
const opaqueDistance = 110

const { data, info } = await sharp(sourcePath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const borderSamples = [[], [], []]
const borderWidth = 8

for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    if (
      x >= borderWidth &&
      x < info.width - borderWidth &&
      y >= borderWidth &&
      y < info.height - borderWidth
    ) {
      continue
    }

    const offset = (y * info.width + x) * 3
    borderSamples[0].push(data[offset])
    borderSamples[1].push(data[offset + 1])
    borderSamples[2].push(data[offset + 2])
  }
}

const median = (values) => {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

const key = borderSamples.map(median)
const rgba = Buffer.alloc(info.width * info.height * 4)
const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))
const smoothstep = (value) => value * value * (3 - 2 * value)

for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const inputOffset = pixel * 3
  const outputOffset = pixel * 4
  const red = data[inputOffset]
  const green = data[inputOffset + 1]
  const blue = data[inputOffset + 2]
  const distance = Math.hypot(red - key[0], green - key[1], blue - key[2])
  const normalized = Math.max(
    0,
    Math.min(1, (distance - transparentDistance) / (opaqueDistance - transparentDistance))
  )
  const alpha = smoothstep(normalized)

  if (alpha <= 0) {
    rgba[outputOffset] = 0
    rgba[outputOffset + 1] = 0
    rgba[outputOffset + 2] = 0
    rgba[outputOffset + 3] = 0
    continue
  }

  // Recover the foreground color from its chroma-key blend without changing
  // geometry. Fully opaque paper pixels pass through byte-for-byte.
  const recoveredRed = clamp((red - key[0] * (1 - alpha)) / alpha)
  const recoveredGreen = clamp((green - key[1] * (1 - alpha)) / alpha)
  const recoveredBlue = clamp((blue - key[2] * (1 - alpha)) / alpha)
  rgba[outputOffset] = recoveredRed
  rgba[outputOffset + 1] = alpha < 0.98
    ? Math.min(recoveredGreen, Math.max(recoveredRed, recoveredBlue))
    : recoveredGreen
  rgba[outputOffset + 2] = recoveredBlue
  rgba[outputOffset + 3] = clamp(alpha * 255)
}

await sharp(rgba, {
  raw: {
    width: info.width,
    height: info.height,
    channels: 4
  }
})
  .png()
  .toFile(outputPath)

const protectedReference = sharp(protectedReferencePath)
const referenceMetadata = await protectedReference.metadata()
const halfWidth = Math.floor(referenceMetadata.width / 2)

await protectedReference
  .extract({
    left: halfWidth,
    top: 0,
    width: referenceMetadata.width - halfWidth,
    height: referenceMetadata.height
  })
  .png()
  .toFile(referenceCropPath)

const panelSize = 560
const markSize = 520
const gap = 24
const checkerTile = 28
const boardWidth = panelSize * 4 + gap * 5
const boardHeight = panelSize + gap * 2
const candidateBuffer = await sharp(outputPath)
  .resize(markSize, markSize, { fit: 'contain' })
  .png()
  .toBuffer()
const referenceBuffer = await sharp(referenceCropPath)
  .resize(markSize, markSize, { fit: 'contain' })
  .png()
  .toBuffer()

const checker = Buffer.alloc(panelSize * panelSize * 4)
for (let y = 0; y < panelSize; y += 1) {
  for (let x = 0; x < panelSize; x += 1) {
    const offset = (y * panelSize + x) * 4
    const light = (Math.floor(x / checkerTile) + Math.floor(y / checkerTile)) % 2 === 0
    const channel = light ? 236 : 202
    checker[offset] = channel
    checker[offset + 1] = channel
    checker[offset + 2] = channel
    checker[offset + 3] = 255
  }
}

const panelBackgrounds = [
  { r: 15, g: 15, b: 31, alpha: 1 },
  { r: 255, g: 255, b: 255, alpha: 1 },
  { r: 255, g: 255, b: 255, alpha: 1 },
  { r: 15, g: 15, b: 31, alpha: 1 }
]

const composites = []
for (let index = 0; index < panelBackgrounds.length; index += 1) {
  const left = gap + index * (panelSize + gap)
  const background = index === 1
    ? await sharp(checker, {
        raw: { width: panelSize, height: panelSize, channels: 4 }
      }).png().toBuffer()
    : await sharp({
        create: {
          width: panelSize,
          height: panelSize,
          channels: 4,
          background: panelBackgrounds[index]
        }
      }).png().toBuffer()

  composites.push({ input: background, left, top: gap })
  composites.push({
    input: index === 0 ? referenceBuffer : candidateBuffer,
    left: left + (panelSize - markSize) / 2,
    top: gap + (panelSize - markSize) / 2
  })
}

await sharp({
  create: {
    width: boardWidth,
    height: boardHeight,
    channels: 4,
    background: { r: 241, g: 241, b: 245, alpha: 1 }
  }
})
  .composite(composites)
  .png()
  .toFile(comparisonPath)

console.log(JSON.stringify({
  chromaKey: key,
  source: sourcePath,
  output: outputPath,
  referenceCrop: referenceCropPath,
  comparison: comparisonPath
}, null, 2))
