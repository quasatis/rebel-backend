/**
 * Resolve Essential Listening track metadata (duration, title) from Spotify / YouTube URLs.
 * YouTube uses Data API (YOUTUBE_API_KEY). Spotify scrapes the public embed page (no API key).
 */

import { normalizeYoutubeVideoId } from './youtube-ids'

export type TrackLinkProvider = 'spotify' | 'youtube'

export type TrackLinkMeta = {
  provider: TrackLinkProvider
  href: string
  title: string | null
  durationSeconds: number | null
  duration: string | null
}

const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist'])

function tryHttpUrl(raw: string): URL | null {
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw)
    if (raw.includes('.') || raw.includes('spotify:') || raw.includes('youtu')) {
      return new URL(`https://${raw.replace(/^\/+/, '')}`)
    }
  } catch {
    return null
  }
  return null
}

/** Returns `type/id` for Spotify resources (same shape as FO shared-types). */
function normalizeSpotifyEmbedId(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const uri = value.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/i)
  if (uri) {
    const type = uri[1].toLowerCase()
    if (SPOTIFY_TYPES.has(type)) return `${type}/${uri[2]}`
  }

  const compact = value.match(/^(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)$/i)
  if (compact) return `${compact[1].toLowerCase()}/${compact[2]}`

  const url = tryHttpUrl(value)
  if (!url) return ''
  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'open.spotify.com' && host !== 'spotify.link') return ''

  const parts = url.pathname.split('/').filter(Boolean)
  let type = ''
  let id = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase()
    if (part === 'embed' && parts[i + 1] && SPOTIFY_TYPES.has(parts[i + 1].toLowerCase())) {
      type = parts[i + 1].toLowerCase()
      id = parts[i + 2] || ''
      break
    }
    if (SPOTIFY_TYPES.has(part)) {
      type = part
      id = parts[i + 1] || ''
      break
    }
  }
  id = id.split('?')[0]
  if (type && /^[A-Za-z0-9]+$/.test(id)) return `${type}/${id}`
  return ''
}

function parseIso8601Duration(iso?: string): number | undefined {
  if (!iso) return undefined
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return undefined
  const h = Number(match[1] || 0)
  const m = Number(match[2] || 0)
  const s = Number(match[3] || 0)
  return h * 3600 + m * 60 + s
}

export function formatTrackDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

async function fetchYoutubeMeta(videoId: string): Promise<{ title: string | null; durationSeconds: number | null }> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) {
    throw new Error('YOUTUBE_API_KEY is not configured')
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('key', key)
  url.searchParams.set('part', 'snippet,contentDetails')
  url.searchParams.set('id', videoId)

  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`YouTube API error ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`)
  }

  const data = (await response.json()) as {
    items?: Array<{
      snippet?: { title?: string }
      contentDetails?: { duration?: string }
    }>
  }
  const item = data.items?.[0]
  if (!item) return { title: null, durationSeconds: null }

  return {
    title: item.snippet?.title?.trim() || null,
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration) ?? null,
  }
}

async function fetchSpotifyMeta(embedId: string): Promise<{ title: string | null; durationSeconds: number | null }> {
  const type = embedId.split('/')[0]
  // Duration is only meaningful for single playable items
  if (type !== 'track' && type !== 'episode') {
    const oembed = await fetchSpotifyOembed(`https://open.spotify.com/${embedId}`)
    return { title: oembed, durationSeconds: null }
  }

  const embedUrl = `https://open.spotify.com/embed/${embedId}`
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; RebelAfriqueCMS/1.0; +https://rebelafrique.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) {
    throw new Error(`Spotify embed error ${response.status}`)
  }
  const html = await response.text()

  let durationSeconds: number | null = null
  const durationMs = html.match(/"duration_ms"\s*:\s*(\d+)/)?.[1]
  const durationAlt = html.match(/"duration"\s*:\s*(\d{4,})/)?.[1]
  const ms = Number(durationMs || durationAlt || 0)
  if (Number.isFinite(ms) && ms > 0) {
    durationSeconds = Math.round(ms / 1000)
  }

  let title: string | null = null
  const nameMatch = html.match(/"name"\s*:\s*"((?:\\.|[^"\\])*)"/)
  if (nameMatch?.[1]) {
    title = nameMatch[1].replace(/\\"/g, '"').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
  }
  if (!title) {
    title = await fetchSpotifyOembed(`https://open.spotify.com/${embedId}`)
  }

  return { title, durationSeconds }
}

async function fetchSpotifyOembed(canonicalUrl: string): Promise<string | null> {
  try {
    const url = new URL('https://open.spotify.com/oembed')
    url.searchParams.set('url', canonicalUrl)
    const response = await fetch(url)
    if (!response.ok) return null
    const data = (await response.json()) as { title?: string }
    return data.title?.trim() || null
  } catch {
    return null
  }
}

/**
 * Resolve duration (and title when available) for a Spotify or YouTube track URL.
 * Returns null when the URL is empty / unrecognized.
 */
export async function resolveTrackLinkMeta(raw: string | null | undefined): Promise<TrackLinkMeta | null> {
  const value = String(raw || '').trim()
  if (!value) return null

  const spotifyId = normalizeSpotifyEmbedId(value)
  if (spotifyId) {
    const meta = await fetchSpotifyMeta(spotifyId)
    const durationSeconds = meta.durationSeconds
    return {
      provider: 'spotify',
      href: `https://open.spotify.com/${spotifyId}`,
      title: meta.title,
      durationSeconds,
      duration: formatTrackDuration(durationSeconds),
    }
  }

  const youtubeId = normalizeYoutubeVideoId(value)
  const looksLikeYoutube =
    /youtu\.?be|youtube\.com/i.test(value) || /^[A-Za-z0-9_-]{11}$/.test(youtubeId)
  if (youtubeId && looksLikeYoutube && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    const meta = await fetchYoutubeMeta(youtubeId)
    return {
      provider: 'youtube',
      href: `https://www.youtube.com/watch?v=${youtubeId}`,
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      duration: formatTrackDuration(meta.durationSeconds),
    }
  }

  return null
}
