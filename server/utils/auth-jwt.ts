import type { JWT, JWTDecodeParams, JWTEncodeParams } from 'next-auth/jwt'
import { EncryptJWT, jwtDecrypt } from 'jose'

const DEFAULT_JWT_MAX_AGE = 30 * 24 * 60 * 60
const NEXTAUTH_JWT_INFO = 'NextAuth.js Generated Encryption Key'

function secretToBytes(secret: JWTEncodeParams['secret']) {
  if (secret instanceof Uint8Array) return new Uint8Array(Array.from(secret))
  return new TextEncoder().encode(String(secret))
}

async function deriveAuthEncryptionKey(secret: JWTEncodeParams['secret']) {
  const enc = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey('raw', secretToBytes(secret), 'HKDF', false, ['deriveBits'])
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(NEXTAUTH_JWT_INFO)
    },
    key,
    256
  )
  return new Uint8Array(bits)
}

export async function encodeAuthToken({ token = {}, secret, maxAge = DEFAULT_JWT_MAX_AGE }: JWTEncodeParams) {
  const encryptionKey = await deriveAuthEncryptionKey(secret)
  return new EncryptJWT(token)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .setJti(globalThis.crypto.randomUUID())
    .encrypt(encryptionKey)
}

export async function decodeAuthToken({ token, secret }: JWTDecodeParams): Promise<JWT | null> {
  if (!token) return null
  const encryptionKey = await deriveAuthEncryptionKey(secret)
  const { payload } = await jwtDecrypt(token, encryptionKey, { clockTolerance: 15 })
  return payload as JWT
}
