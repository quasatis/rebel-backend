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
