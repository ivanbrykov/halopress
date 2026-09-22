import type { webcrypto } from 'node:crypto'

const HASH_ITERATIONS = 100000
const HASH_LENGTH = 32

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string) {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`
  const bytes = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

type WebCrypto = webcrypto.Crypto

async function getCrypto(): Promise<WebCrypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto as unknown as WebCrypto
  const { webcrypto } = await import('node:crypto')
  return webcrypto
}

async function sha256Pbkdf2(password: string, saltHex: string) {
  const crypto = await getCrypto()
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations: HASH_ITERATIONS,
      hash: 'SHA-256'
    },
    key,
    HASH_LENGTH * 8
  )
  return bytesToHex(new Uint8Array(derived))
}

export async function hashPassword(password: string) {
  const crypto = await getCrypto()
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const salt = bytesToHex(saltBytes)
  const hash = await sha256Pbkdf2(password, salt)
  return { hash, salt }
}

export async function verifyPassword(password: string, hash: string, salt: string) {
  const derived = await sha256Pbkdf2(password, salt)
  return secureEqual(derived, hash)
}
