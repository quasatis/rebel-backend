/**
 * Keep a Media Source row in sync with a YouTube Source so playlists (and other
 * embed relations) can pick the same catalogues created under Shows → YouTube Sources.
 */

import {
  normalizeYoutubeChannelId,
  normalizeYoutubePlaylistId,
  normalizeYoutubeVideoId,
} from './youtube-ids'

type YoutubeSourceLike = {
  id?: number | string
  documentId?: string
  displayTitle?: string | null
  sourceType?: string | null
  playlistId?: string | null
  videoId?: string | null
  channelId?: string | null
  channelUrl?: string | null
  /** Optional YouTube channel title (not a youtube-source column; set during sync). */
  channelTitle?: string | null
}

const MEDIA_UID = 'api::media-source.media-source'
const PLAYLIST_UID = 'api::playlist.playlist'
const TRAFFIC_UID = 'api::media-traffic-event.media-traffic-event'
const YOUTUBE_SOURCE_UID = 'api::youtube-source.youtube-source'

function attributionMeta(source: YoutubeSourceLike) {
  const channelId = normalizeYoutubeChannelId(source.channelId) || null
  const channelUrl =
    String(source.channelUrl || '').trim() ||
    (channelId ? `https://www.youtube.com/channel/${channelId}` : null)
  // Prefer an explicit channel title from the API. For channel/username sources the
  // display title is usually the channel name; for playlist/video it is not.
  const type = String(source.sourceType || '')
  const displayAsChannel =
    type === 'channel' || type === 'username'
      ? String(source.displayTitle || '').trim()
      : ''
  return {
    channelId,
    channelUrl,
    channelTitle:
      String(source.channelTitle || '').trim() || displayAsChannel || null,
    youtubeSourceDocumentId: source.documentId || null,
    youtubeSourceId: source.id ?? null,
  }
}

function buildPayload(source: YoutubeSourceLike) {
  const title = String(source.displayTitle || '').trim() || 'YouTube source'
  const type = String(source.sourceType || '')
  const attribution = attributionMeta(source)

  if (type === 'playlist' && source.playlistId) {
    const externalId = normalizeYoutubePlaylistId(source.playlistId)
    if (!externalId) return null
    return {
      provider: 'youtube' as const,
      externalId,
      externalUrl: `https://www.youtube.com/playlist?list=${externalId}`,
      title,
      providerExternalKey: `youtube:playlist:${externalId}`,
      rawMeta: {
        type: 'playlist',
        ...attribution,
      },
    }
  }

  if (type === 'video' && source.videoId) {
    const externalId = normalizeYoutubeVideoId(source.videoId)
    if (!externalId) return null
    return {
      provider: 'youtube' as const,
      externalId,
      externalUrl: `https://www.youtube.com/watch?v=${externalId}`,
      title,
      providerExternalKey: `youtube:${externalId}`,
      rawMeta: {
        type: 'video',
        ...attribution,
      },
    }
  }

  return null
}

export async function syncMediaSourceFromYoutubeSource(strapi: any, source: YoutubeSourceLike) {
  const payload = buildPayload(source)
  if (!payload) return null

  const existing = await strapi.db.query(MEDIA_UID).findOne({
    where: { providerExternalKey: payload.providerExternalKey },
  })

  if (existing) {
    const prevMeta =
      existing.rawMeta && typeof existing.rawMeta === 'object' && !Array.isArray(existing.rawMeta)
        ? (existing.rawMeta as Record<string, unknown>)
        : {}
    const nextMeta = { ...payload.rawMeta } as Record<string, unknown>
    // Don't blank a known channel title when a later sync omits it.
    if (!nextMeta.channelTitle && prevMeta.channelTitle) {
      nextMeta.channelTitle = prevMeta.channelTitle
    }
    const existingTitle = String(existing.title || '').trim()
    return strapi.db.query(MEDIA_UID).update({
      where: { id: existing.id },
      data: {
        // Preserve editor-chosen titles; only fill when blank.
        ...(existingTitle ? {} : { title: payload.title }),
        externalId: payload.externalId,
        externalUrl: payload.externalUrl,
        rawMeta: nextMeta,
      },
    })
  }

  return strapi.db.query(MEDIA_UID).create({ data: payload })
}

export async function syncAllYoutubeSourcesToMediaSources(strapi: any) {
  const rows = await strapi.db.query(YOUTUBE_SOURCE_UID).findMany({
    select: [
      'id',
      'documentId',
      'displayTitle',
      'sourceType',
      'playlistId',
      'videoId',
      'channelId',
      'channelUrl',
    ],
  })
  let synced = 0
  for (const row of rows || []) {
    const result = await syncMediaSourceFromYoutubeSource(strapi, row)
    if (result) synced += 1
  }
  return synced
}

/**
 * Resolve owning channelId for playlist-type YouTube sources, refresh media-source
 * rawMeta, and backfill matching media-traffic-event rows so analytics can roll up.
 */
export async function backfillPlaylistChannelAttribution(strapi: any) {
  const youtube = strapi.service('api::youtube-source.youtube')
  const sources = await strapi.db.query(YOUTUBE_SOURCE_UID).findMany({
    where: { sourceType: 'playlist' },
    select: [
      'id',
      'documentId',
      'displayTitle',
      'sourceType',
      'playlistId',
      'channelId',
      'channelUrl',
    ],
  })

  let sourcesUpdated = 0
  let mediaUpdated = 0
  let trafficUpdated = 0

  for (const source of sources || []) {
    const playlistId = normalizeYoutubePlaylistId(source.playlistId)
    if (!playlistId) continue

    let channelId = normalizeYoutubeChannelId(source.channelId) || null
    let channelUrl = String(source.channelUrl || '').trim() || null
    let channelTitle: string | null = null

    const existingMedia = playlistId
      ? await strapi.db.query(MEDIA_UID).findOne({
          where: { providerExternalKey: `youtube:playlist:${playlistId}` },
          select: ['rawMeta'],
        })
      : null
    const existingTitle = String(
      (existingMedia?.rawMeta as { channelTitle?: unknown } | null)?.channelTitle || '',
    ).trim()

    if (!channelId) {
      const meta = await youtube.fetchPlaylistMeta(playlistId)
      if (!meta?.channelId) continue
      channelId = meta.channelId
      channelTitle = meta.channelTitle
      channelUrl = `https://www.youtube.com/channel/${channelId}`
      await strapi.db.query(YOUTUBE_SOURCE_UID).update({
        where: { id: source.id },
        data: { channelId, channelUrl },
      })
      sourcesUpdated += 1
    } else {
      channelTitle = existingTitle || null
      if (!channelUrl) {
        channelUrl = `https://www.youtube.com/channel/${channelId}`
        await strapi.db.query(YOUTUBE_SOURCE_UID).update({
          where: { id: source.id },
          data: { channelUrl },
        })
      }
      // One-time title fill when media still lacks channelTitle.
      if (!channelTitle) {
        try {
          const meta = await youtube.fetchPlaylistMeta(playlistId)
          channelTitle = meta?.channelTitle || null
        } catch {
          /* keep null */
        }
      }
    }

    const media = await syncMediaSourceFromYoutubeSource(strapi, {
      ...source,
      playlistId,
      channelId,
      channelUrl,
      channelTitle,
    })
    if (media) mediaUpdated += 1

    const events = await strapi.db.query(TRAFFIC_UID).findMany({
      where: {
        provider: 'youtube',
        externalId: playlistId,
        $or: [{ channelId: null }, { channelId: '' }],
      },
      select: ['id'],
      limit: 10_000,
    })
    for (const event of events || []) {
      await strapi.db.query(TRAFFIC_UID).update({
        where: { id: event.id },
        data: {
          channelId,
          ...(channelTitle ? { channelTitle } : {}),
        },
      })
      trafficUpdated += 1
    }
  }

  return { sourcesUpdated, mediaUpdated, trafficUpdated }
}

/**
 * Public site cannot read youtube-source rows, and draft/published are separate
 * DB rows. Copy youtubeSource + matching mediaSource onto every version of each
 * playlist document that has a YouTube source on at least one version.
 */
export async function linkPlaylistsToYoutubeMediaSources(
  strapi: any,
  documentId?: string | null,
) {
  const rows = await strapi.db.query(PLAYLIST_UID).findMany({
    where: documentId ? { documentId } : undefined,
    populate: ['youtubeSource', 'mediaSource'],
  })

  const byDocument = new Map<string, any[]>()
  for (const row of rows || []) {
    const key = row.documentId
    if (!key) continue
    const list = byDocument.get(key) || []
    list.push(row)
    byDocument.set(key, list)
  }

  let linked = 0
  for (const versions of byDocument.values()) {
    const withYoutube = versions.find((row) => row.youtubeSource)
    if (!withYoutube?.youtubeSource) continue

    const youtube = withYoutube.youtubeSource
    const media = await syncMediaSourceFromYoutubeSource(strapi, youtube)
    if (!media) continue

    for (const row of versions) {
      const needsYoutube = row.youtubeSource?.id !== youtube.id
      const mediaProvider = String(row.mediaSource?.provider || '').toLowerCase()
      // Preserve non-YouTube mediaSource (e.g. Vimeo) linked from the playlist form.
      const canReplaceMedia = !row.mediaSource || mediaProvider === 'youtube' || !mediaProvider
      const needsMedia =
        canReplaceMedia &&
        row.mediaSource?.id !== media.id &&
        row.mediaSource?.documentId !== media.documentId
      if (!needsYoutube && !needsMedia) continue

      const data: Record<string, unknown> = {}
      if (needsYoutube) data.youtubeSource = youtube.id
      if (needsMedia) data.mediaSource = media.id

      await strapi.db.query(PLAYLIST_UID).update({
        where: { id: row.id },
        data,
      })
      linked += 1
    }
  }
  return linked
}
