import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const workingDir = path.dirname(fileURLToPath(import.meta.url))
const selectedBackgroundDir = path.resolve(workingDir, '../../exports')
const generatedBackgroundDir = path.join(workingDir, '01-background-sources')
const outputDir = path.join(workingDir, '02-deliverables')
const validationDir = path.join(workingDir, '03-validation')
const masterPath = path.resolve(
  workingDir,
  '../02-final-master/halopress-mark-master-v2.png'
)

await mkdir(outputDir, { recursive: true })
await mkdir(validationDir, { recursive: true })

const { data: masterData, info: masterInfo } = await sharp(masterPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const bounds = {
  left: masterInfo.width,
  top: masterInfo.height,
  right: -1,
  bottom: -1
}

for (let y = 0; y < masterInfo.height; y += 1) {
  for (let x = 0; x < masterInfo.width; x += 1) {
    const alpha = masterData[(y * masterInfo.width + x) * 4 + 3]
    if (alpha <= 4) continue
    bounds.left = Math.min(bounds.left, x)
    bounds.top = Math.min(bounds.top, y)
    bounds.right = Math.max(bounds.right, x)
    bounds.bottom = Math.max(bounds.bottom, y)
  }
}

const cropMargin = 2
const crop = {
  left: Math.max(0, bounds.left - cropMargin),
  top: Math.max(0, bounds.top - cropMargin),
  width: Math.min(masterInfo.width - bounds.left + cropMargin, bounds.right - bounds.left + 1 + cropMargin * 2),
  height: Math.min(masterInfo.height - bounds.top + cropMargin, bounds.bottom - bounds.top + 1 + cropMargin * 2)
}

const croppedMark = await sharp(masterPath)
  .extract(crop)
  .png()
  .toBuffer()

const transparentSquareMark = async (size, coverage = 0.96) => {
  const targetHeight = Math.max(1, Math.round(size * coverage))
  const { data, info } = await sharp(croppedMark)
    .resize({ height: targetHeight, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer({ resolveWithObject: true })

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{
      input: data,
      left: Math.round((size - info.width) / 2),
      top: Math.round((size - info.height) / 2)
    }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

const compositeMark = async (backgroundPath, width, height, markHeight, left, top) => {
  const background = await sharp(backgroundPath)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .png()
    .toBuffer()
  const mark = await sharp(croppedMark)
    .resize({ height: markHeight, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()

  return sharp(background)
    .composite([{ input: mark, left, top }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer()
}

const write = async (filename, buffer) => {
  const destination = path.join(outputDir, filename)
  await writeFile(destination, buffer)
  return destination
}

await write('halopress-mark-master-v2.png', await readFile(masterPath))

const publicMark = await transparentSquareMark(1254, 0.92)
await write('halopress-mark-transparent.png', publicMark)
await write('halopress-mark-light.png', publicMark)
await write('halopress-mark-dark.png', publicMark)

const markSizes = [16, 32, 48, 64, 180, 256, 512]
const markBuffers = new Map()

for (const size of markSizes) {
  const buffer = await transparentSquareMark(size, 0.98)
  markBuffers.set(size, buffer)
  await write(`halopress-mark-${size}.png`, buffer)
}

await write('halopress-mark-light-256.png', markBuffers.get(256))
await write('halopress-mark-dark-256.png', markBuffers.get(256))

const createIco = (entries) => {
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entrySize * entries.length
  const header = Buffer.alloc(headerSize + entrySize * entries.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  entries.forEach(({ size, buffer }, index) => {
    const entryOffset = headerSize + index * entrySize
    header.writeUInt8(size === 256 ? 0 : size, entryOffset)
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(buffer.length, entryOffset + 8)
    header.writeUInt32LE(offset, entryOffset + 12)
    offset += buffer.length
  })

  return Buffer.concat([header, ...entries.map(({ buffer }) => buffer)])
}

await write('favicon.ico', createIco(
  [16, 32, 48, 64].map(size => ({ size, buffer: markBuffers.get(size) }))
))

const lightArtwork = await compositeMark(
  path.join(selectedBackgroundDir, 'brand-background-light.png'),
  1254,
  1254,
  700,
  358,
  277
)
const darkArtwork = await compositeMark(
  path.join(selectedBackgroundDir, 'brand-background-dark.png'),
  1254,
  1254,
  700,
  358,
  277
)
await write('halopress-brand-artwork-light.png', lightArtwork)
await write('halopress-brand-artwork-dark.png', darkArtwork)

const selectedDarkBackground = path.join(selectedBackgroundDir, 'brand-background-dark.png')
const socialBackground = await sharp(selectedDarkBackground)
  .extract({ left: 0, top: 0, width: 1100, height: 578 })
  .resize(1200, 630, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .removeAlpha()
  .png()
  .toBuffer()
const socialMark = await sharp(croppedMark)
  .resize({ height: 340, fit: 'inside', kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer()
const socialType = Buffer.from(`
  <svg width="650" height="190" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="78" fill="#FFFFFF"
      font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="700"
      letter-spacing="-2">Halo</text>
    <text x="155" y="78" fill="#5CCBFA"
      font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="700"
      letter-spacing="-2">Press</text>
    <text x="2" y="140" fill="#D7CFF0"
      font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="400"
      letter-spacing="0">Schema-driven publishing</text>
  </svg>
`)
const socialCard = await sharp(socialBackground)
  .composite([
    { input: socialMark, left: 220, top: 70 },
    { input: socialType, left: 520, top: 190 }
  ])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer()
await write('halopress-social-card.png', socialCard)

const wizardBackground = await sharp(path.join(
  generatedBackgroundDir,
  'background-wizard-03-freeform.png'
))
  .resize(2172, 724, { fit: 'cover', position: 'centre' })
  .removeAlpha()
  .png()
  .toBuffer()
const wizardMark = await sharp(croppedMark)
  .resize({ height: 380, fit: 'inside', kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer()
const wizardHeader = await sharp(wizardBackground)
  .composite([{ input: wizardMark, left: 1100, top: 270 }])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer()
await write('halopress-install-wizard-journey.png', wizardHeader)

const sheetBackground = await sharp({
  create: {
    width: 1500,
    height: 1900,
    channels: 4,
    background: { r: 238, g: 238, b: 244, alpha: 1 }
  }
}).png().toBuffer()
const lightPreview = await sharp(lightArtwork).resize(690, 690).png().toBuffer()
const darkPreview = await sharp(darkArtwork).resize(690, 690).png().toBuffer()
const socialPreview = await sharp(socialCard).resize(1380, 725, { fit: 'contain' }).png().toBuffer()
const wizardPreview = await sharp(wizardHeader).resize(1380, 460, { fit: 'contain' }).png().toBuffer()

await sharp(sheetBackground)
  .composite([
    { input: lightPreview, left: 40, top: 40 },
    { input: darkPreview, left: 770, top: 40 },
    { input: socialPreview, left: 60, top: 760 },
    { input: wizardPreview, left: 60, top: 1430 }
  ])
  .png({ compressionLevel: 9 })
  .toFile(path.join(validationDir, 'brand-family-v2-contact-sheet.png'))

const smallLight = await sharp({
  create: {
    width: 620,
    height: 240,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 }
  }
}).png().toBuffer()
const smallDark = await sharp({
  create: {
    width: 620,
    height: 240,
    channels: 4,
    background: { r: 15, g: 15, b: 31, alpha: 1 }
  }
}).png().toBuffer()
const previewSizes = [16, 32, 48, 64, 180]
const positions = [36, 100, 190, 300, 410]
const smallComposites = []

for (let index = 0; index < previewSizes.length; index += 1) {
  const size = previewSizes[index]
  smallComposites.push({
    input: markBuffers.get(size),
    left: positions[index],
    top: Math.round((240 - size) / 2)
  })
}

const lightSizes = await sharp(smallLight).composite(smallComposites).png().toBuffer()
const darkSizes = await sharp(smallDark).composite(smallComposites).png().toBuffer()

await sharp({
  create: {
    width: 1280,
    height: 280,
    channels: 4,
    background: { r: 222, g: 222, b: 228, alpha: 1 }
  }
})
  .composite([
    { input: lightSizes, left: 20, top: 20 },
    { input: darkSizes, left: 640, top: 20 }
  ])
  .png({ compressionLevel: 9 })
  .toFile(path.join(validationDir, 'mark-sizes-light-dark.png'))

console.log(JSON.stringify({
  master: masterPath,
  alphaBounds: bounds,
  crop,
  outputDir,
  validationDir
}, null, 2))
