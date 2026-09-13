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

export default () => ({
  normalize(item: YoutubeListItem, attribution: YoutubeAttribution = {}): NormalizedYoutubeVideo {
    const externalUrl = `https://www.youtube.com/watch?v=${item.id}`
    const channelId = String(attribution.channelId || '').trim() || null
    const channelUrl =
      String(attribution.channelUrl || '').trim() ||
      (channelId ? `https://www.youtube.com/channel/${channelId}` : null)
    return {
      youtubeVideoId: item.id,
      title: item.title,
      description: item.description,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
      channelTitle: item.channelTitle,
      durationSeconds: item.durationSeconds,
      playlistPosition: item.playlistPosition,
      externalUrl,
      mediaSource: {
        provider: 'youtube',
        externalId: item.id,
        externalUrl,
        title: item.title,
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
