import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { ApiError } from '@/lib/api/errors'
import { env } from '@/lib/env'

/**
 * Encrypted storage for tenant connector credentials.
 *
 * The schema is deliberate about this: `integrations.config` rejects any key that
 * looks like a credential, and `secret_ref` is a pointer for a managed secret
 * store. Neither is usable by itself on a single-VPS deployment, so a stored
 * credential is sealed here instead:
 *
 * - AES-256-GCM, so tampering fails the authentication tag rather than
 *   decrypting to something else;
 * - the key is derived with scrypt from `INTEGRATION_SECRET_KEY`, salted per
 *   record, so the same credential never produces the same ciphertext;
 * - an unset or short key fails **closed**: nothing is written in plaintext and
 *   no sync runs.
 *
 * Rotating `INTEGRATION_SECRET_KEY` makes stored credentials unreadable. They are
 * reported as a credential error and the operator re-enters them — that is the
 * intended behaviour for a key rotation, not a bug.
 */

const VERSION = 'v1'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

/** True when this deployment can store credentials at all. */
export function credentialsConfigured(): boolean {
  return (env.INTEGRATION_SECRET_KEY ?? '').trim().length >= 32
}

function rootKey(): string {
  const key = (env.INTEGRATION_SECRET_KEY ?? '').trim()
  if (key.length < 32) {
    throw ApiError.serviceUnavailable(
      'Integration credentials are not configured on this deployment. Set INTEGRATION_SECRET_KEY (32+ characters).',
    )
  }
  return key
}

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(rootKey(), salt, KEY_BYTES, SCRYPT_OPTIONS)
}

export function encryptCredential(plaintext: string): string {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(salt), iv)
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    VERSION,
    salt.toString('base64url'),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    sealed.toString('base64url'),
  ].join('.')
}

export function decryptCredential(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw ApiError.serviceUnavailable('The stored credential could not be read. Re-enter it.')
  }
  const [, salt, iv, tag, sealed] = parts as [string, string, string, string, string]
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(Buffer.from(salt, 'base64url')),
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw ApiError.serviceUnavailable(
      'The stored credential could not be decrypted. Re-enter it (this is expected after rotating INTEGRATION_SECRET_KEY).',
    )
  }
}
