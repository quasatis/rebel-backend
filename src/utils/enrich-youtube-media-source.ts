/**
 * Pull title/thumb/duration + live/premiere fields from YouTube into a
 * media-source payload (manual embeds and live-status refresh).
 */

import { normalizeYoutubeVideoId } from './youtube-ids'
import { liveRawMetaFromItem } from '../api/youtube-source/services/youtube'
import { isYouTubePlaylistId } from './youtube-playlist-id'

const MEDIA_UID = 'api::media-source.media-source'

function isPlaylistMeta(rawMeta: unknown, externalId: string): boolean {
  const type = String((rawMeta as { type?: unknown } | null)?.type || '')
    .trim()
    .toLowerCase()
  if (type === 'playlist') return true
  return isYouTubePlaylistId(externalId)
}

export type YoutubeLiveStatusPayload = {
  liveBroadcastContent: 'none' | 'upcoming' | 'live'
  scheduledStartTime: string | null
  actualStartTime: string | null
  actualEndTime: string | null
  externalId: string
  title: string | null
  thumbnailUrl: string | null
  refreshedAt: string
  warning?: string
}

/** Merge YouTube video details into a create/update body.data object. */
export async function enrichYoutubeMediaSourceData(
  strapi: any,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const provider = String(data.provider || '').trim().toLowerCase()
  if (provider !== 'youtube') return data

  const externalId = normalizeYoutubeVideoId(String(data.externalId || ''))
  if (!externalId || isPlaylistMeta(data.rawMeta, String(data.externalId || ''))) {
    return data
  }

  try {
    const youtube = strapi.service('api::youtube-source.youtube')
    const item = await youtube.fetchVideo(externalId)
    if (!item) return data

    const prevMeta =
      data.rawMeta && typeof data.rawMeta === 'object' && !Array.isArray(data.rawMeta)
        ? (data.rawMeta as Record<string, unknown>)
        : {}

    const next: Record<string, unknown> = {
      ...data,
      externalId,
      externalUrl:
        String(data.externalUrl || '').trim() || `https://www.youtube.com/watch?v=${externalId}`,
      title: String(data.title || '').trim() || item.title,
      thumbnailUrl: String(data.thumbnailUrl || '').trim() || item.thumbnailUrl,
      durationSeconds:
        data.durationSeconds != null && data.durationSeconds !== ''
          ? data.durationSeconds
          : item.durationSeconds,
      rawMeta: {
        ...prevMeta,
        type: prevMeta.type || 'video',
        publishedAt: prevMeta.publishedAt || item.publishedAt,
        channelTitle: prevMeta.channelTitle || item.channelTitle || null,
        ...liveRawMetaFromItem(item),
      },
    }
    return next
  } catch {
    return data
  }
}

/** Refresh live/premiere fields on an existing media-source row from YouTube. */
export async function refreshMediaSourceLiveStatus(
  strapi: any,
  documentId: string,
): Promise<YoutubeLiveStatusPayload | null> {
  const row = await strapi.db.query(MEDIA_UID).findOne({
    where: { documentId },
  })
  if (!row) return null

  const provider = String(row.provider || '').trim().toLowerCase()
  const externalId = String(row.externalId || '').trim()
  if (provider !== 'youtube' || !externalId || isPlaylistMeta(row.rawMeta, externalId)) {
    return {
      liveBroadcastContent: 'none',
      scheduledStartTime: null,
      actualStartTime: null,
      actualEndTime: null,
      externalId,
      title: row.title || null,
      thumbnailUrl: row.thumbnailUrl || null,
      refreshedAt: new Date().toISOString(),
    }
  }

  const videoId = normalizeYoutubeVideoId(externalId) || externalId
  const youtube = strapi.service('api::youtube-source.youtube')
  const item = await youtube.fetchVideo(videoId)
  const prevMeta =
    row.rawMeta && typeof row.rawMeta === 'object' && !Array.isArray(row.rawMeta)
      ? (row.rawMeta as Record<string, unknown>)
      : {}

  const liveMeta = item
    ? liveRawMetaFromItem(item)
    : {
        liveBroadcastContent: 'none' as const,
      }

  const nextMeta = {
    ...prevMeta,
    type: prevMeta.type || 'video',
    ...(item?.publishedAt ? { publishedAt: item.publishedAt } : {}),
    ...(item?.channelTitle ? { channelTitle: item.channelTitle } : {}),
    ...liveMeta,
  }

  const updateData: Record<string, unknown> = { rawMeta: nextMeta }
  if (item?.thumbnailUrl && !String(row.thumbnailUrl || '').trim()) {
    updateData.thumbnailUrl = item.thumbnailUrl
  }
  if (item && typeof item.durationSeconds === 'number' && row.durationSeconds == null) {
    updateData.durationSeconds = item.durationSeconds
  }
  if (item?.title && !String(row.title || '').trim()) {
    updateData.title = item.title
  }

  await strapi.db.query(MEDIA_UID).update({
    where: { id: row.id },
    data: updateData,
  })

  return {
    liveBroadcastContent:
      (liveMeta.liveBroadcastContent as 'none' | 'upcoming' | 'live') || 'none',
    scheduledStartTime: (liveMeta.scheduledStartTime as string) || null,
    actualStartTime: (liveMeta.actualStartTime as string) || null,
    actualEndTime: (liveMeta.actualEndTime as string) || null,
    externalId: videoId,
    title: (updateData.title as string) || row.title || null,
    thumbnailUrl: (updateData.thumbnailUrl as string) || row.thumbnailUrl || null,
    refreshedAt: new Date().toISOString(),
  }
}
