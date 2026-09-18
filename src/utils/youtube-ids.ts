/**
 * Normalize YouTube identifiers editors paste into CMS fields.
 * Accepts bare IDs or common watch / playlist / channel / short URLs.
 */

function tryUrl(raw: string): URL | null {
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw)
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) {
      return new URL(`https://${raw.replace(/^\/+/, '')}`)
    }
  } catch {
    return null
  }
  return null
}

/** Extract a playlist ID (e.g. PLxxx) from a bare ID or URL. */
export function normalizeYoutubePlaylistId(raw: string | null | undefined): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const url = tryUrl(value)
  if (url) {
    const list = url.searchParams.get('list')
    if (list) return list.trim()
  }

  const listMatch = value.match(/[?&]list=([^&\s#]+)/i)
  if (listMatch?.[1]) return decodeURIComponent(listMatch[1]).trim()

  if (/^list=/i.test(value)) return value.replace(/^list=/i, '').trim()

  return value
}

/** Extract a video ID from a bare ID or watch/embed/shorts/youtu.be URL. */
export function normalizeYoutubeVideoId(raw: string | null | undefined): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const url = tryUrl(value)
  if (url) {
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      if (id) return id.trim()
    }
    const v = url.searchParams.get('v')
    if (v) return v.trim()
    const parts = url.pathname.split('/').filter(Boolean)
    const markers = new Set(['embed', 'shorts', 'live', 'v'])
    for (let i = 0; i < parts.length - 1; i++) {
      if (markers.has(parts[i])) return parts[i + 1].trim()
    }
  }

  const watchMatch = value.match(/[?&]v=([^&\s#]+)/i)
  if (watchMatch?.[1]) return decodeURIComponent(watchMatch[1]).trim()

  return value
}

/** Extract a channel ID (UCxxx) from a bare ID or /channel/ URL. */
export function normalizeYoutubeChannelId(raw: string | null | undefined): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const url = tryUrl(value)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const idx = parts.findIndex((p) => p === 'channel')
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].trim()
  }

  const pathMatch = value.match(/\/channel\/([^/?&#\s]+)/i)
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim()

  // Bare UC… ids only — do not treat @handles or other URLs as channel ids.
  if (/^UC[\w-]{20,}$/.test(value)) return value

  return ''
}

/** True when the value is already a YouTube channel id (UCxxx). */
export function isYoutubeChannelId(raw: string | null | undefined): boolean {
  return /^UC[\w-]{20,}$/.test(String(raw || '').trim())
}

/**
 * Extract a @handle / legacy username from a bare handle or channel URL
 * (e.g. https://www.youtube.com/@anyikowoko/videos → anyikowoko).
 */
export function normalizeYoutubeUsername(raw: string | null | undefined): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const url = tryUrl(value)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const atPart = parts.find((part) => part.startsWith('@'))
    if (atPart) return atPart.replace(/^@/, '').trim()

    const userIdx = parts.findIndex((part) => part === 'user' || part === 'c')
    if (userIdx >= 0 && parts[userIdx + 1]) {
      return parts[userIdx + 1].replace(/^@/, '').trim()
    }
  }

  const atMatch = value.match(/@([\w.-]+)/)
  if (atMatch?.[1]) return atMatch[1].trim()

  return value.replace(/^@/, '').trim()
}
