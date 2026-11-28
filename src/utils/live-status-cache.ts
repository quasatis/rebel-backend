/**
 * Short-TTL in-memory cache for YouTube live-status refreshes (quota-safe).
 */

import type { YoutubeLiveStatusPayload } from './enrich-youtube-media-source'

const TTL_MS = 30_000

type CacheEntry = {
  expiresAt: number
  payload: YoutubeLiveStatusPayload
}

const cache = new Map<string, CacheEntry>()

export function getCachedLiveStatus(externalId: string): YoutubeLiveStatusPayload | null {
  const key = String(externalId || '').trim()
  if (!key) return null
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.payload
}

export function setCachedLiveStatus(
  externalId: string,
  payload: YoutubeLiveStatusPayload,
  ttlMs = TTL_MS,
) {
  const key = String(externalId || '').trim()
  if (!key) return
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : TTL_MS
  cache.set(key, { expiresAt: Date.now() + ttl, payload })
}
