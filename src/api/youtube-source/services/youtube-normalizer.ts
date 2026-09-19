import type { YoutubeListItem } from './youtube'

export type YoutubeAttribution = {
  channelId?: string | null
  channelUrl?: string | null
  youtubeSourceDocumentId?: string | null
  youtubeSourceId?: number | string | null
}

export type NormalizedYoutubeVideo = {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  channelTitle: string
  durationSeconds?: number
  playlistPosition?: number
  externalUrl: string
  mediaSource: {
    provider: 'youtube'
    externalId: string
    externalUrl: string
    title: string
    thumbnailUrl: string
    durationSeconds?: number
    providerExternalKey: string
    rawMeta?: Record<string, unknown>
  }
}

/** Match show-episode / media-source schema maxLength so sync does not 400/500. */
const TITLE_MAX = 100
const DESCRIPTION_MAX = 2000

function clip(value: unknown, max: number): string {
  const text = String(value ?? '')
  if (text.length <= max) return text
  return text.slice(0, max)
}

export default () => ({
  normalize(item: YoutubeListItem, attribution: YoutubeAttribution = {}): NormalizedYoutubeVideo {
    const externalUrl = `https://www.youtube.com/watch?v=${item.id}`
    const channelId = String(attribution.channelId || '').trim() || null
    const channelUrl =
      String(attribution.channelUrl || '').trim() ||
      (channelId ? `https://www.youtube.com/channel/${channelId}` : null)
    const title = clip(item.title, TITLE_MAX)
    const description = clip(item.description, DESCRIPTION_MAX)
    return {
      youtubeVideoId: item.id,
      title,
      description,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
      channelTitle: clip(item.channelTitle, TITLE_MAX),
      durationSeconds: item.durationSeconds,
      playlistPosition: item.playlistPosition,
      externalUrl,
      mediaSource: {
        provider: 'youtube',
        externalId: item.id,
        externalUrl,
        title,
        thumbnailUrl: item.thumbnailUrl,
        durationSeconds: item.durationSeconds,
        providerExternalKey: `youtube:${item.id}`,
        rawMeta: {
          type: 'video',
          channelTitle: item.channelTitle,
          channelId,
          channelUrl,
          publishedAt: item.publishedAt,
          playlistPosition: item.playlistPosition ?? null,
          youtubeSourceDocumentId: attribution.youtubeSourceDocumentId || null,
          youtubeSourceId: attribution.youtubeSourceId ?? null,
        },
      },
    }
  },
})
