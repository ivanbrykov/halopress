import type { H3Event } from 'h3'

import { asset as assetTable } from '../db/schema'
import { executeDbStatement } from '../db/transaction'
import type { DbStatement } from '../db/transaction'
import { assetObjectKey, putObject } from '../storage/assets'
import { newId } from './ids'

function kindFromMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

function parseBase64DataUrl(value: string) {
  if (!value.startsWith('data:')) return null
  const commaIndex = value.indexOf(',')
  if (commaIndex === -1) return null
  const meta = value.slice(5, commaIndex)
  const data = value.slice(commaIndex + 1).replace(/\s/g, '')
  if (!/;base64/i.test(meta)) return null
  const mimeType = meta.split(';')[0] || 'application/octet-stream'
  const bytes = new Uint8Array(Buffer.from(data, 'base64'))
  return { mimeType, bytes }
}

type ReplaceOptions = {
  event: H3Event
  db: any
  createdBy?: string | null
  content: Record<string, unknown>
  urlPrefix?: string
  statements?: DbStatement[]
}

export async function replaceBase64ImagesInContent(options: ReplaceOptions) {
  const { event, db, createdBy, content } = options
  const urlPrefix = options.urlPrefix ?? '/assets'
  const cache = new Map<string, string>()
  let replaced = 0

  async function ensureAsset(dataUrl: string) {
    if (cache.has(dataUrl)) return cache.get(dataUrl)!
    const parsed = parseBase64DataUrl(dataUrl)
    if (!parsed) return dataUrl
    if (!parsed.mimeType.startsWith('image/')) return dataUrl

    const assetId = newId()
    const objectKey = assetObjectKey(event, assetId)
    await putObject(event, objectKey, parsed.bytes, parsed.mimeType)

    const now = new Date()
    await executeDbStatement(db.insert(assetTable).values({
      id: assetId,
      kind: kindFromMime(parsed.mimeType),
      status: 'ready',
      objectKey,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.bytes.byteLength,
      sha256: null,
      width: null,
      height: null,
      durationMs: null,
      createdBy: createdBy ?? null,
      createdAt: now
    }), options.statements)

    const url = `${urlPrefix}/${assetId}/raw`
    cache.set(dataUrl, url)
    replaced += 1
    return url
  }

  async function walk(node: unknown): Promise<unknown> {
    if (typeof node === 'string') {
      return await ensureAsset(node)
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = await walk(node[i])
      }
      return node
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        const value = (node as Record<string, unknown>)[key]
        ;(node as Record<string, unknown>)[key] = await walk(value)
      }
      return node
    }
    return node
  }

  await walk(content)

  return { content, replaced }
}
