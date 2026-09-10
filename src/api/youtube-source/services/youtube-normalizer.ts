import type { YoutubeListItem } from './youtube'

export type NormalizedYoutubeVideo = {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  channelTitle: string
  durationSeconds?: number
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
  normalize(item: YoutubeListItem): NormalizedYoutubeVideo {
    const externalUrl = `https://www.youtube.com/watch?v=${item.id}`
    return {
      youtubeVideoId: item.id,
      title: item.title,
      description: item.description,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
      channelTitle: item.channelTitle,
      durationSeconds: item.durationSeconds,
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
          channelTitle: item.channelTitle,
          publishedAt: item.publishedAt,
        },
      },
    }
  },
})
