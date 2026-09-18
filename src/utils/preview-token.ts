/**
 * Short-lived HMAC tokens for draft content preview on the public site.
 * Editors mint a token; the frontoffice redeems it to load status=draft.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Preview links expire after 30 minutes. */
export const PREVIEW_TTL_SECONDS = 30 * 60

export type PreviewClaims = {
  collection: string
  documentId: string
  slug: string
  exp: number
}

/** Collections that support public draft preview (path builder per type). */
export const PREVIEW_COLLECTIONS: Record<string, { pathForSlug: (slug: string) => string }> = {
  articles: {
    pathForSlug: (slug) => `/news/${encodeURIComponent(slug)}`,
  },
}

function previewSecret(): string {
  const dedicated = String(process.env.PREVIEW_SECRET || '').trim()
  if (dedicated) return dedicated
  const fromKeys = String(process.env.APP_KEYS || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)
  if (fromKeys) return fromKeys
  throw new Error('PREVIEW_SECRET or APP_KEYS must be configured for draft preview.')
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signBody(body: string): string {
  return createHmac('sha256', previewSecret()).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function signPreviewToken(input: {
  collection: string
  documentId: string
  slug: string
  ttlSeconds?: number
}): { token: string; expiresAt: string; path: string } {
  const collection = String(input.collection || '').trim()
  const config = PREVIEW_COLLECTIONS[collection]
  if (!config) {
    throw new Error(`Preview is not enabled for “${collection}”.`)
  }

  const slug = String(input.slug || '').trim()
  const documentId = String(input.documentId || '').trim()
  if (!slug || !documentId) {
    throw new Error('documentId and slug are required to mint a preview token.')
  }

  const ttl = input.ttlSeconds ?? PREVIEW_TTL_SECONDS
  const exp = Math.floor(Date.now() / 1000) + ttl
  const claims: PreviewClaims = { collection, documentId, slug, exp }
  const body = b64urlJson(claims)
  const token = `${body}.${signBody(body)}`

  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    path: config.pathForSlug(slug),
  }
}

export function verifyPreviewToken(token: string): PreviewClaims {
  const raw = String(token || '').trim()
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) {
    throw new Error('Invalid preview token.')
  }

  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!safeEqual(sig, signBody(body))) {
    throw new Error('Invalid preview token.')
  }

  let claims: PreviewClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PreviewClaims
  } catch {
    throw new Error('Invalid preview token.')
  }

  if (
    !claims ||
    typeof claims.collection !== 'string' ||
    typeof claims.documentId !== 'string' ||
    typeof claims.slug !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    throw new Error('Invalid preview token.')
  }

  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Preview token has expired.')
  }

  if (!PREVIEW_COLLECTIONS[claims.collection]) {
    throw new Error(`Preview is not enabled for “${claims.collection}”.`)
  }

  return claims
}
