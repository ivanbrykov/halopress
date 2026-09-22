import type { webcrypto } from 'node:crypto'

type WebCrypto = webcrypto.Crypto

const ENCRYPTION_ALGORITHM = 'AES-GCM'
const ENCRYPTION_KEY_BYTES = 32
const IV_BYTES = 12

async function getCrypto(): Promise<WebCrypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto as unknown as WebCrypto
  const { webcrypto } = await import('node:crypto')
  return webcrypto
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

async function importKey(secret: string) {
  const crypto = await getCrypto()
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  const keyBytes = new Uint8Array(digest).slice(0, ENCRYPTION_KEY_BYTES)
  return await crypto.subtle.importKey('raw', keyBytes, ENCRYPTION_ALGORITHM, false, ['encrypt', 'decrypt'])
}

export async function encryptString(value: string, secret: string) {
  if (!secret) throw new Error('Encryption secret is required')
  const crypto = await getCrypto()
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    enc.encode(value)
  )
  return `${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`
}

export async function decryptString(payload: string, secret: string) {
  if (!secret) throw new Error('Decryption secret is required')
  const [ivRaw, dataRaw] = payload.split(':')
  if (!ivRaw || !dataRaw) throw new Error('Invalid encrypted payload')
  const crypto = await getCrypto()
  const key = await importKey(secret)
  const iv = base64ToBytes(ivRaw)
  const data = base64ToBytes(dataRaw)
  const decrypted = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    data
  )
  return new TextDecoder().decode(decrypted)
}
