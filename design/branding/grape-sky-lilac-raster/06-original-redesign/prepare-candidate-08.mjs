import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const inputPath = fileURLToPath(new URL('./candidate-07-original-proportions.png', import.meta.url))
const outputPath = fileURLToPath(new URL('./candidate-08-color-tuned.png', import.meta.url))
const referenceCropPath = fileURLToPath(new URL('./reference-grape-sky-right.png', import.meta.url))
const comparisonPath = fileURLToPath(new URL('./candidate-08-comparison.png', import.meta.url))

const clamp01 = (value) => Math.max(0, Math.min(1, value))
const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)))

const rgbToHsl = (red, green, blue) => {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2

  if (max === min) {
    return [0, 0, lightness]
  }

  const delta = max - min
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min)

  let hue
  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0)
  } else if (max === g) {
    hue = (b - r) / delta + 2
  } else {
    hue = (r - g) / delta + 4
  }

  return [(hue / 6) * 360, saturation, lightness]
}

const hueToRgb = (p, q, value) => {
  let t = value
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

const hslToRgb = (hue, saturation, lightness) => {
  const h = hue / 360
  if (saturation === 0) {
    const gray = clamp255(lightness * 255)
    return [gray, gray, gray]
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q

  return [
    clamp255(hueToRgb(p, q, h + 1 / 3) * 255),
    clamp255(hueToRgb(p, q, h) * 255),
    clamp255(hueToRgb(p, q, h - 1 / 3) * 255)
  ]
}

const { data, info } = await sharp(inputPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const tuned = Buffer.from(data)

for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const offset = pixel * 4
  const alpha = data[offset + 3]
  if (alpha === 0) continue

  const red = data[offset]
  const blue = data[offset + 2]
  const green = alpha < 250
    ? Math.min(data[offset + 1], Math.max(red, blue))
    : data[offset + 1]
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue)

  let adjustedSaturation = saturation
  let adjustedLightness = lightness

  if (hue >= 175 && hue < 235) {
    // Sky: preserve HSL lightness and strengthen color separation.
    adjustedSaturation = clamp01(saturation * 1.28 + 0.04)
  } else if (hue >= 235 && hue < 310) {
    // Lilac: preserve saturation and lower lightness only slightly.
    adjustedLightness = clamp01(lightness - 0.055)
  }

  const [adjustedRed, adjustedGreen, adjustedBlue] = hslToRgb(
    hue,
    adjustedSaturation,
    adjustedLightness
  )

  tuned[offset] = adjustedRed
  tuned[offset + 1] = adjustedGreen
  tuned[offset + 2] = adjustedBlue
}

await sharp(tuned, {
  raw: {
    width: info.width,
    height: info.height,
    channels: 4
  }
})
  .png()
  .toFile(outputPath)

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
  input: inputPath,
  output: outputPath,
  comparison: comparisonPath,
  adjustments: {
    sky: 'HSL saturation × 1.28 + 0.04; lightness unchanged',
    lilac: 'HSL lightness − 0.055; saturation unchanged'
  }
}, null, 2))
