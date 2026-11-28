/**
 * Public YouTube Atom feeds (no API quota). Latest ~15 videos per channel/playlist.
 */

import {
  normalizeYoutubeChannelId,
  normalizeYoutubePlaylistId,
} from './youtube-ids'

type YoutubeListItem = {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  channelTitle: string
}

function isPrivateVideoTitle(title: unknown): boolean {
  return String(title || '').trim().toLowerCase() === 'private video'
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function tagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  return match ? decodeXml(match[1]) : ''
}

function tagAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\b${attr}\\s*=\\s*"([^"]+)"`, 'i')
  const match = xml.match(re)
  return match ? decodeXml(match[1]) : ''
}

export function parseYoutubeAtomFeed(xml: string): YoutubeListItem[] {
  const chunks = String(xml || '').split(/<entry[\s>]/i).slice(1)
  const items: YoutubeListItem[] = []

  for (const chunk of chunks) {
    const entry = chunk.split(/<\/entry>/i)[0] || ''
    const id =
      tagText(entry, 'yt:videoId') ||
      tagText(entry, 'videoId') ||
      (tagText(entry, 'id').match(/yt:video:([A-Za-z0-9_-]{11})/) || [])[1] ||
      ''
    if (!id) continue
    const title = tagText(entry, 'title') || 'Untitled'
    if (isPrivateVideoTitle(title)) continue
    const publishedAt = tagText(entry, 'published') || new Date().toISOString()
    const thumbnailUrl =
      tagAttr(entry, 'media:thumbnail', 'url') ||
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    const description = tagText(entry, 'media:description')
    const channelTitle = tagText(entry, 'name')
    items.push({
      id,
      title,
      description,
      thumbnailUrl,
      publishedAt,
      channelTitle,
    })
  }

  return items
}

export async function fetchYoutubeFeedXml(params: {
  playlistId?: string | null
  channelId?: string | null
}): Promise<string> {
  const playlistId = normalizeYoutubePlaylistId(params.playlistId || '')
  const channelId = normalizeYoutubeChannelId(params.channelId || '')
  const url = playlistId
    ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`
    : channelId
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
      : ''
  if (!url) {
    throw new Error('YouTube RSS feed requires a playlist ID or channel ID')
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/atom+xml, application/xml, text/xml',
      'User-Agent': 'RebelAfriqueCMS/1.0 (+https://rebelafrique.com)',
    },
  })
  if (!response.ok) {
    throw new Error(`YouTube RSS feed error ${response.status}`)
  }
  return response.text()
}

export async function fetchYoutubeFeedVideos(params: {
  playlistId?: string | null
  channelId?: string | null
}): Promise<YoutubeListItem[]> {
  const xml = await fetchYoutubeFeedXml(params)
  return parseYoutubeAtomFeed(xml)
}
