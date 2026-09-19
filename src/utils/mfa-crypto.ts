/**
 * MFA helpers: AES-GCM secret encryption, SHA-256 hashes, HMAC challenge tokens.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000
export const BACKUP_CODE_COUNT = 10

export type MfaChallengeClaims = {
  purpose: 'mfa-challenge'
  userId: number
  exp: number
  jti: string
}

function mfaSecret(): string {
  const dedicated = String(process.env.MFA_ENCRYPTION_KEY || '').trim()
  if (dedicated) return dedicated
  const fromKeys = String(process.env.APP_KEYS || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)
  if (fromKeys) return fromKeys
  throw new Error('MFA_ENCRYPTION_KEY or APP_KEYS must be configured for MFA.')
}

function keyBytes(): Buffer {
  return createHash('sha256').update(mfaSecret()).digest()
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function tokensMatch(raw: string, hash: string | null | undefined): boolean {
  if (!hash) return false
  const a = Buffer.from(hashToken(raw))
  const b = Buffer.from(String(hash))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Encrypt a TOTP secret for storage (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}

export function decryptSecret(payload: string): string {
  const parts = String(payload || '').split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted secret.')
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const data = Buffer.from(dataB64, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signBody(body: string): string {
  return createHmac('sha256', mfaSecret()).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function signMfaChallenge(userId: number, ttlSeconds = MFA_CHALLENGE_TTL_SECONDS): {
  token: string
  expiresAt: string
  jti: string
} {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const jti = randomBytes(16).toString('base64url')
  const claims: MfaChallengeClaims = {
    purpose: 'mfa-challenge',
    userId,
    exp,
    jti,
  }
  const body = b64urlJson(claims)
  return {
    token: `${body}.${signBody(body)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    jti,
  }
}

export function verifyMfaChallenge(token: string): MfaChallengeClaims {
  const raw = String(token || '').trim()
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) {
    throw new Error('Invalid or expired challenge.')
  }

  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!safeEqual(sig, signBody(body))) {
    throw new Error('Invalid or expired challenge.')
  }

  let claims: MfaChallengeClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MfaChallengeClaims
  } catch {
    throw new Error('Invalid or expired challenge.')
  }

  if (
    !claims ||
    claims.purpose !== 'mfa-challenge' ||
    typeof claims.userId !== 'number' ||
    typeof claims.exp !== 'number' ||
    typeof claims.jti !== 'string'
  ) {
    throw new Error('Invalid or expired challenge.')
  }

  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Invalid or expired challenge.')
  }

  return claims
}

export function generateEmailOtp(): string {
  const n = randomBytes(3).readUIntBE(0, 3) % 1_000_000
  return String(n).padStart(6, '0')
}

/** 10 backup codes like ABCD-EFGH (excluding ambiguous chars). */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8)
    let raw = ''
    for (let j = 0; j < 8; j++) {
      raw += alphabet[bytes[j] % alphabet.length]
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`)
  }
  return codes
}

export function normalizeBackupCode(code: string): string {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function parseBackupHashes(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

export function serializeBackupHashes(hashes: string[]): string {
  return JSON.stringify(hashes)
}
