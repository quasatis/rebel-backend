import { factories } from '@strapi/strapi'

type YoutubeSourceRef = {
  id?: number
  documentId?: string
}

type SyncedVideoRow = {
  id?: number
  documentId: string
  title: string
  thumbnailUrl?: string | null
  durationSeconds?: number | null
  publishedAt?: string | null
  youtubeVideoId?: string
  externalUrl?: string
  mediaSource?: Record<string, unknown> | null
}

function serializeVideo(row: SyncedVideoRow) {
  return {
    id: row.id ?? 0,
    documentId: row.documentId,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl || null,
    durationSeconds: row.durationSeconds ?? null,
    publishedAt: row.publishedAt || null,
    youtubeVideoId: row.youtubeVideoId || null,
    externalUrl: row.externalUrl || null,
    mediaSource: row.mediaSource || null,
  }
}

export default factories.createCoreController('api::playlist.playlist', ({ strapi }) => ({
  async videos(ctx) {
    const slug = String(ctx.params.slug || '').trim()
    if (!slug) {
      return ctx.badRequest('slug is required')
    }

    const playlists = await strapi.documents('api::playlist.playlist').findMany({
      filters: {
        slug: { $eq: slug },
        active: { $eq: true },
      },
      status: 'published',
      populate: ['youtubeSource'],
      limit: 1,
    })

    const playlist = playlists[0]
    if (!playlist) {
      return ctx.notFound('Playlist not found')
    }

    const youtubeSource = playlist.youtubeSource as YoutubeSourceRef | null | undefined
    if (!youtubeSource?.documentId) {
      ctx.body = { data: [] }
      return
    }

    const rows = await strapi.documents('api::synced-video.synced-video').findMany({
      filters: {
        youtubeSource: {
          documentId: { $eq: youtubeSource.documentId },
        },
      },
      populate: ['mediaSource'],
      sort: 'publishedAt:desc',
      limit: 200,
    })

    ctx.body = { data: (rows as unknown as SyncedVideoRow[]).map(serializeVideo) }
  },
}))
