/**
 * YouTube Data API client. Credentials stay server-side only.
 * Includes light quota batching + exponential backoff on 403/429.
 */

export type YoutubeListItem = {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  channelTitle: string
  durationSeconds?: number
}

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) {
    throw new Error('YOUTUBE_API_KEY is not configured')
  }
  return key
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function youtubeGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
  url.searchParams.set('key', getApiKey())
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }

  const maxAttempts = 4
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url)
    if (response.ok) {
      return (await response.json()) as T
    }

    const retryable = response.status === 403 || response.status === 429 || response.status >= 500
    const body = await response.text().catch(() => '')
    lastError = new Error(`YouTube API error ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`)

    if (!retryable || attempt === maxAttempts) {
      throw lastError
    }

    // Exponential backoff with jitter: ~500ms, 1s, 2s
    const delay = Math.min(8000, 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200))
    await sleep(delay)
  }

  throw lastError || new Error('YouTube API request failed')
}

function parseDuration(iso?: string): number | undefined {
  if (!iso) return undefined
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return undefined
  const h = Number(match[1] || 0)
  const m = Number(match[2] || 0)
  const s = Number(match[3] || 0)
  return h * 3600 + m * 60 + s
}

/** Batch video IDs (max 50 per YouTube videos.list call) and attach durations. */
async function enrichDurations(items: YoutubeListItem[]): Promise<YoutubeListItem[]> {
  if (!items.length) return items
  const byId = new Map(items.map((item) => [item.id, { ...item }]))
  const ids = [...byId.keys()]

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await youtubeGet<{
      items?: Array<{ id?: string; contentDetails?: { duration?: string } }>
    }>('videos', {
      part: 'contentDetails',
      id: chunk.join(','),
    })
    for (const row of data.items || []) {
      if (!row.id) continue
      const existing = byId.get(row.id)
      if (existing) {
        existing.durationSeconds = parseDuration(row.contentDetails?.duration)
      }
    }
    // Small pause between batches to reduce quota spikes
    if (i + 50 < ids.length) await sleep(150)
  }

  return [...byId.values()]
}

export default () => ({
  async fetchPlaylistVideos(playlistId: string): Promise<YoutubeListItem[]> {
    const items: YoutubeListItem[] = []
    let pageToken = ''
    do {
      const page = await youtubeGet<{
        nextPageToken?: string
        items?: Array<{
          snippet?: {
            title?: string
            description?: string
            publishedAt?: string
            channelTitle?: string
            resourceId?: { videoId?: string }
            thumbnails?: { high?: { url?: string }; medium?: { url?: string } }
          }
        }>
      }>('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: '50',
        pageToken,
      })
      for (const item of page.items || []) {
        const videoId = item.snippet?.resourceId?.videoId
        if (!videoId) continue
        items.push({
          id: videoId,
          title: item.snippet?.title || 'Untitled',
          description: item.snippet?.description || '',
          thumbnailUrl:
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
          channelTitle: item.snippet?.channelTitle || '',
        })
      }
      pageToken = page.nextPageToken || ''
      if (pageToken) await sleep(150)
    } while (pageToken)
    return enrichDurations(items)
  },

  async fetchChannelUploads(channelId: string): Promise<YoutubeListItem[]> {
    const channel = await youtubeGet<{
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>
    }>('channels', {
      part: 'contentDetails',
      id: channelId,
    })
    const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return []
    return this.fetchPlaylistVideos(uploads)
  },

  /**
   * Resolve a YouTube @handle or legacy username to a channel ID.
   */
  async resolveChannelIdFromUsername(username: string): Promise<string> {
    const handle = username.replace(/^@/, '').trim()
    if (!handle) {
      throw new Error('YouTube username/handle is empty')
    }

    const byHandle = await youtubeGet<{
      items?: Array<{ id?: string }>
    }>('channels', {
      part: 'id',
      forHandle: handle,
    })
    let channelId = byHandle.items?.[0]?.id

    if (!channelId) {
      const byUsername = await youtubeGet<{
        items?: Array<{ id?: string }>
      }>('channels', {
        part: 'id',
        forUsername: handle,
      })
      channelId = byUsername.items?.[0]?.id
    }

    if (!channelId) {
      throw new Error(`YouTube channel not found for username/handle: ${handle}`)
    }

    return channelId
  },

  /**
   * Resolve a YouTube @handle or legacy username to a channel ID, then fetch uploads.
   */
  async fetchUsernameUploads(username: string): Promise<YoutubeListItem[]> {
    const channelId = await this.resolveChannelIdFromUsername(username)
    return this.fetchChannelUploads(channelId)
  },

  async fetchVideo(videoId: string): Promise<YoutubeListItem | null> {
    const data = await youtubeGet<{
      items?: Array<{
        id?: string
        snippet?: {
          title?: string
          description?: string
          publishedAt?: string
          channelTitle?: string
          thumbnails?: { high?: { url?: string }; medium?: { url?: string } }
        }
        contentDetails?: { duration?: string }
      }>
    }>('videos', {
      part: 'snippet,contentDetails',
      id: videoId,
    })
    const item = data.items?.[0]
    if (!item?.id) return null
    return {
      id: item.id,
      title: item.snippet?.title || 'Untitled',
      description: item.snippet?.description || '',
      thumbnailUrl:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
      channelTitle: item.snippet?.channelTitle || '',
      durationSeconds: parseDuration(item.contentDetails?.duration),
    }
  },
})
