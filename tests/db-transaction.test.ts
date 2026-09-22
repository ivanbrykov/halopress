import { describe, expect, it, vi } from 'vitest'

import { executeDbStatement, withDbTransaction } from '../server/db/transaction'
import { replaceBase64ImagesInContent } from '../server/utils/asset-data-url'

describe('withDbTransaction', () => {
  it('runs against the base database on Cloudflare D1 without issuing BEGIN', async () => {
    const statement = { kind: 'write' }
    const batch = vi.fn(async () => undefined)
    const transaction = vi.fn(() => {
      throw new Error('D1 transaction must not be called')
    })
    const db = { batch, transaction }
    const event = {
      context: {
        cloudflare: {
          env: { DB: {} }
        }
      }
    }
    const work = vi.fn(async (tx: unknown, statements?: unknown[]) => {
      expect(tx).toBe(db)
      await executeDbStatement(statement, statements)
      return 'saved'
    })

    await expect(withDbTransaction(event as any, db as any, work)).resolves.toBe('saved')
    expect(work).toHaveBeenCalledOnce()
    expect(transaction).not.toHaveBeenCalled()
    expect(batch).toHaveBeenCalledWith([statement])
  })

  it('retains database transactions outside Cloudflare D1', async () => {
    const tx = { kind: 'local transaction' }
    const transaction = vi.fn(async (work: (value: unknown) => Promise<unknown>) => await work(tx))
    const db = { transaction }
    const statement = Promise.resolve()
    const work = vi.fn(async (value: unknown, statements?: unknown[]) => {
      expect(value).toBe(tx)
      expect(statements).toBeUndefined()
      await executeDbStatement(statement, statements)
      return 'saved'
    })

    await expect(withDbTransaction({ context: {} } as any, db as any, work)).resolves.toBe('saved')
    expect(transaction).toHaveBeenCalledOnce()
    expect(work).toHaveBeenCalledOnce()
  })

  it('does not report a D1 publication group as successful when batch fails', async () => {
    const failure = new Error('D1 batch failed')
    const first = { kind: 'revision insert' }
    const second = { kind: 'published pointer update' }
    const batch = vi.fn(async () => {
      throw failure
    })
    const db = { batch, transaction: vi.fn() }
    const event = { context: { cloudflare: { env: { DB: {} } } } }

    await expect(withDbTransaction(event as any, db as any, async (_tx, statements) => {
      await executeDbStatement(first, statements)
      await executeDbStatement(second, statements)
      return 'published'
    })).rejects.toBe(failure)

    expect(batch).toHaveBeenCalledWith([first, second])
  })

  it('persists pasted image data to R2 and the asset table on Cloudflare D1', async () => {
    const put = vi.fn(async () => undefined)
    const assetInsertStatement = { kind: 'asset insert' }
    const values = vi.fn(() => assetInsertStatement)
    const insert = vi.fn(() => ({ values }))
    const batch = vi.fn(async () => undefined)
    const transaction = vi.fn(() => {
      throw new Error('D1 transaction must not be called')
    })
    const db = { batch, insert, transaction }
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: {},
            CONTENT_ASSETS: { put }
          }
        }
      },
      node: {
        req: {
          headers: { host: 'acme-news.example.com' }
        }
      }
    }
    const content = {
      body: {
        type: 'doc',
        content: [{
          type: 'image',
          attrs: { src: 'data:image/png;base64,YXNzZXQ=' }
        }]
      }
    }

    await withDbTransaction(event as any, db as any, async (tx, statements) => {
      await replaceBase64ImagesInContent({ event: event as any, db: tx, content, statements })
    })

    expect(transaction).not.toHaveBeenCalled()
    expect(batch).toHaveBeenCalledWith([assetInsertStatement])
    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^t\/acme-news\.example\.com\/assets\/[0-9A-Z]+\/orig$/),
      expect.any(Uint8Array),
      { httpMetadata: { contentType: 'image/png' } }
    )
    expect(insert).toHaveBeenCalledOnce()
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 5,
      objectKey: expect.stringMatching(/^t\/acme-news\.example\.com\/assets\/[0-9A-Z]+\/orig$/)
    }))
    expect(content.body.content[0].attrs.src).toMatch(/^\/assets\/[0-9A-Z]+\/raw$/)
  })
})
