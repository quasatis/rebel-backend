/**
 * YouTube Data API client. Credentials stay server-side only.
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

async function youtubeGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
  url.searchParams.set('key', getApiKey())
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`YouTube API error ${response.status}`)
  }
  return (await response.json()) as T
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
    } while (pageToken)
    return items
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
