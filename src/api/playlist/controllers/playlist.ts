import { factories } from '@strapi/strapi'
import { normalizeYoutubePlaylistId } from '../../../utils/youtube-ids'

type YoutubeSourceRef = {
  id?: number
  documentId?: string
  playlistId?: string | null
  sourceType?: string | null
}

type SyncedVideoRow = {
  id?: number
  documentId: string
  title: string
  thumbnailUrl?: string | null
  durationSeconds?: number | null
  publishedAt?: string | null
  playlistPosition?: number | null
  youtubeVideoId?: string
  externalUrl?: string
  mediaSource?: Record<string, unknown> | null
}

type SerializedVideo = ReturnType<typeof serializeVideo>

function serializeVideo(row: SyncedVideoRow) {
  return {
    id: row.id ?? 0,
    documentId: row.documentId,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl || null,
    durationSeconds: row.durationSeconds ?? null,
    publishedAt: row.publishedAt || null,
    playlistPosition: row.playlistPosition ?? null,
    youtubeVideoId: row.youtubeVideoId || null,
    externalUrl: row.externalUrl || null,
    mediaSource: row.mediaSource || null,
  }
}

function sortByPlaylistPosition(videos: SerializedVideo[]) {
  videos.sort((a, b) => {
    const ap = a.playlistPosition
    const bp = b.playlistPosition
    const aHas = typeof ap === 'number'
    const bHas = typeof bp === 'number'
    if (aHas && bHas && ap !== bp) return ap - bp
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    // Preserve previous default: newer publish date first when positions are unknown.
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0
    return bTime - aTime
  })
  return videos
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
      sort: ['playlistPosition:asc', 'publishedAt:desc'],
      limit: 200,
    })

    const videos = (rows as unknown as SyncedVideoRow[]).map(serializeVideo)
    const missingPositions = videos.some((video) => typeof video.playlistPosition !== 'number')
    const playlistId = normalizeYoutubePlaylistId(youtubeSource.playlistId)

    if (missingPositions && playlistId) {
      try {
        const youtube = strapi.service('api::youtube-source.youtube')
        const order = (await youtube.fetchPlaylistOrder(playlistId)) as Array<{
          id: string
          position: number
        }>
        const positionById = new Map(order.map((item) => [item.id, item.position]))
        const persists: Promise<unknown>[] = []

        for (const video of videos) {
          if (!video.youtubeVideoId) continue
          const position = positionById.get(video.youtubeVideoId)
          if (typeof position !== 'number') continue
          video.playlistPosition = position

          // Persist so later requests stay in playlist order without another YouTube round-trip.
          if (video.id) {
            persists.push(
              strapi.db.query('api::synced-video.synced-video').update({
                where: { id: video.id },
                data: { playlistPosition: position },
              }),
            )
          }
        }

        if (persists.length) {
          await Promise.all(persists)
        }
      } catch (error) {
        strapi.log.warn(
          `Could not resolve playlist order for ${slug}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        )
      }
    }

    ctx.body = { data: sortByPlaylistPosition(videos) }
  },
}))
