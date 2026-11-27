/**
 * Normalize Vimeo IDs/URLs and pull title/thumb/duration from oEmbed
 * into a media-source payload (manual Studio embeds).
 */

import { errors } from '@strapi/utils'
import { normalizeVimeoRef, vimeoProviderExternalKey, vimeoWatchUrl } from './vimeo-ids'

type VimeoOembed = {
  title?: string
  thumbnail_url?: string
  duration?: number
  author_name?: string
}

async function fetchVimeoOembed(watchUrl: string): Promise<VimeoOembed | null> {
  try {
    const url = new URL('https://vimeo.com/api/oembed.json')
    url.searchParams.set('url', watchUrl)
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    return (await response.json()) as VimeoOembed
  } catch {
    return null
  }
}

function rawMetaObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

/** Merge Vimeo video/showcase details into a create/update body.data object. */
export async function enrichVimeoMediaSourceData(
  strapi: { log?: { warn?: (message: string) => void } },
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const provider = String(data.provider || '').trim().toLowerCase()
  if (provider !== 'vimeo') return data

  const parsed =
    normalizeVimeoRef(String(data.externalUrl || '')) ||
    normalizeVimeoRef(String(data.externalId || ''))

  if (!parsed) return data
  if (parsed.kind === 'unsupported') {
    throw new errors.ValidationError(parsed.unsupportedReason || 'Unsupported Vimeo URL.')
  }

  const watchUrl = vimeoWatchUrl(parsed)
  const prevMeta = rawMetaObject(data.rawMeta)
  const next: Record<string, unknown> = {
    ...data,
    externalId: parsed.externalId,
    externalUrl: String(data.externalUrl || '').trim() || watchUrl,
    providerExternalKey: vimeoProviderExternalKey(parsed.externalId, parsed.kind),
    rawMeta: {
      ...prevMeta,
      type: parsed.kind,
    },
  }

  const meta = next.rawMeta as Record<string, unknown>
  if (parsed.hash) meta.hash = parsed.hash
  else delete meta.hash

  try {
    const item = await fetchVimeoOembed(String(next.externalUrl) || watchUrl)
    if (!item) return next

    next.title = String(data.title || '').trim() || item.title || next.title
    next.thumbnailUrl = String(data.thumbnailUrl || '').trim() || item.thumbnail_url || next.thumbnailUrl
    if (
      (data.durationSeconds == null || data.durationSeconds === '') &&
      typeof item.duration === 'number' &&
      item.duration > 0
    ) {
      next.durationSeconds = Math.round(item.duration)
    }
    if (!meta.channelTitle && item.author_name) {
      meta.channelTitle = item.author_name
    }
    return next
  } catch (error) {
    strapi.log?.warn?.(
      `Vimeo media-source oEmbed skipped: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    )
    return next
  }
}
