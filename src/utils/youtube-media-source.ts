/**
 * Keep a Media Source row in sync with a YouTube Source so playlists (and other
 * embed relations) can pick the same catalogues created under Shows → YouTube Sources.
 */

type YoutubeSourceLike = {
  id?: number | string
  documentId?: string
  displayTitle?: string | null
  sourceType?: string | null
  playlistId?: string | null
  videoId?: string | null
  channelId?: string | null
}

const MEDIA_UID = 'api::media-source.media-source'
const PLAYLIST_UID = 'api::playlist.playlist'

function buildPayload(source: YoutubeSourceLike) {
  const title = String(source.displayTitle || '').trim() || 'YouTube source'
  const type = String(source.sourceType || '')

  if (type === 'playlist' && source.playlistId) {
    const externalId = String(source.playlistId).trim()
    return {
      provider: 'youtube' as const,
      externalId,
      externalUrl: `https://www.youtube.com/playlist?list=${externalId}`,
      title,
      providerExternalKey: `youtube:playlist:${externalId}`,
      rawMeta: {
        type: 'playlist',
        youtubeSourceDocumentId: source.documentId || null,
        youtubeSourceId: source.id ?? null,
      },
    }
  }

  if (type === 'video' && source.videoId) {
    const externalId = String(source.videoId).trim()
    return {
      provider: 'youtube' as const,
      externalId,
      externalUrl: `https://www.youtube.com/watch?v=${externalId}`,
      title,
      providerExternalKey: `youtube:${externalId}`,
      rawMeta: {
        type: 'video',
        youtubeSourceDocumentId: source.documentId || null,
        youtubeSourceId: source.id ?? null,
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
    return strapi.db.query(MEDIA_UID).update({
      where: { id: existing.id },
      data: {
        title: payload.title,
        externalId: payload.externalId,
        externalUrl: payload.externalUrl,
        rawMeta: payload.rawMeta,
      },
    })
  }

  return strapi.db.query(MEDIA_UID).create({ data: payload })
}

export async function syncAllYoutubeSourcesToMediaSources(strapi: any) {
  const rows = await strapi.db.query('api::youtube-source.youtube-source').findMany({
    select: [
      'id',
      'documentId',
      'displayTitle',
      'sourceType',
      'playlistId',
      'videoId',
      'channelId',
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
      const needsMedia =
        row.mediaSource?.id !== media.id && row.mediaSource?.documentId !== media.documentId
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
