import {
  isYoutubeChannelId,
  normalizeYoutubeChannelId,
  normalizeYoutubePlaylistId,
  normalizeYoutubeUsername,
  normalizeYoutubeVideoId,
} from '../../../utils/youtube-ids'

function formatSyncFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'sync failed'
  if (/fetch failed/i.test(raw) || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(raw)) {
    return 'Could not reach YouTube API (network/DNS). Check YOUTUBE_API_KEY and outbound access from Strapi.'
  }
  return raw
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || 'episode'
}

async function uniqueEpisodeSlug(strapi: any, base: string, excludeDocumentId?: string) {
  let candidate = base
  let i = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await strapi.documents('api::show-episode.show-episode').findMany({
      filters: { slug: candidate },
      limit: 1,
    })
    const hit = existing?.[0]
    if (!hit || (excludeDocumentId && hit.documentId === excludeDocumentId)) {
      return candidate
    }
    candidate = `${base}-${i}`
    i += 1
  }
}

/**
 * Fill null episodeNumber values for a show. Never overwrites existing numbers.
 * Order: playlistPosition (via synced-video) ascending when present, else publishedAt asc.
 */
async function assignMissingEpisodeNumbers(strapi: any, showId: number): Promise<number> {
  if (!showId) return 0

  const episodes = await strapi.db.query('api::show-episode.show-episode').findMany({
    where: { show: showId },
    limit: 5000,
  })

  if (!episodes?.length) return 0

  const numbered = episodes.filter(
    (ep: { episodeNumber?: number | null }) =>
      typeof ep.episodeNumber === 'number' && Number.isFinite(ep.episodeNumber),
  )
  const missing = episodes.filter(
    (ep: { episodeNumber?: number | null }) =>
      ep.episodeNumber == null || !Number.isFinite(ep.episodeNumber),
  )

  if (!missing.length) return 0

  let next =
    numbered.reduce(
      (max: number, ep: { episodeNumber: number }) => Math.max(max, ep.episodeNumber),
      0,
    ) + 1

  const mediaSourceIdSet = new Set<number>()
  for (const ep of missing as Array<{ mediaSource?: number | { id?: number } | null }>) {
    if (typeof ep.mediaSource === 'number') mediaSourceIdSet.add(ep.mediaSource)
    else if (ep.mediaSource && typeof ep.mediaSource === 'object' && typeof ep.mediaSource.id === 'number') {
      mediaSourceIdSet.add(ep.mediaSource.id)
    }
  }
  const mediaSourceIds = Array.from(mediaSourceIdSet)

  const positionByMediaSource = new Map<number, number>()
  if (mediaSourceIds.length) {
    const synced = await strapi.db.query('api::synced-video.synced-video').findMany({
      where: { mediaSource: { $in: mediaSourceIds } },
      limit: mediaSourceIds.length,
    })
    for (const row of synced || []) {
      const msId =
        typeof row.mediaSource === 'number'
          ? row.mediaSource
          : row.mediaSource?.id
      if (
        typeof msId === 'number' &&
        typeof row.playlistPosition === 'number' &&
        Number.isFinite(row.playlistPosition)
      ) {
        positionByMediaSource.set(msId, row.playlistPosition)
      }
    }
  }

  type Sortable = {
    id: number
    mediaSourceId: number | null
    playlistPosition: number | null
    publishedAtMs: number
  }

  const sortable: Sortable[] = missing.map(
    (ep: {
      id: number
      mediaSource?: number | { id?: number } | null
      publishedAt?: string | Date | null
      createdAt?: string | Date | null
    }) => {
      const mediaSourceId =
        typeof ep.mediaSource === 'number'
          ? ep.mediaSource
          : ep.mediaSource && typeof ep.mediaSource === 'object' && ep.mediaSource.id
            ? ep.mediaSource.id
            : null
      const playlistPosition =
        mediaSourceId != null && positionByMediaSource.has(mediaSourceId)
          ? (positionByMediaSource.get(mediaSourceId) as number)
          : null
      const publishedRaw = ep.publishedAt || ep.createdAt
      const publishedAtMs = publishedRaw ? new Date(publishedRaw).getTime() : Number.POSITIVE_INFINITY
      return {
        id: ep.id,
        mediaSourceId,
        playlistPosition,
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : Number.POSITIVE_INFINITY,
      }
    },
  )

  sortable.sort((a, b) => {
    const aHas = a.playlistPosition != null
    const bHas = b.playlistPosition != null
    if (aHas && bHas && a.playlistPosition !== b.playlistPosition) {
      return (a.playlistPosition as number) - (b.playlistPosition as number)
    }
    if (aHas !== bHas) return aHas ? -1 : 1
    if (a.publishedAtMs !== b.publishedAtMs) return a.publishedAtMs - b.publishedAtMs
    return a.id - b.id
  })

  let assigned = 0
  for (const row of sortable) {
    await strapi.db.query('api::show-episode.show-episode').update({
      where: { id: row.id },
      data: { episodeNumber: next },
    })
    next += 1
    assigned += 1
  }

  return assigned
}

async function backfillMissingEpisodeNumbers(strapi: any): Promise<number> {
  const missing = await strapi.db.query('api::show-episode.show-episode').findMany({
    where: { episodeNumber: { $null: true } },
    populate: ['show'],
    limit: 5000,
  })

  const showIdSet = new Set<number>()
  for (const ep of (missing || []) as Array<{ show?: number | { id?: number } | null }>) {
    if (typeof ep.show === 'number') showIdSet.add(ep.show)
    else if (ep.show && typeof ep.show === 'object' && typeof ep.show.id === 'number') {
      showIdSet.add(ep.show.id)
    }
  }
  const showIds = Array.from(showIdSet)

  let totalAssigned = 0
  for (const showId of showIds) {
    totalAssigned += await assignMissingEpisodeNumbers(strapi, showId)
  }
  return totalAssigned
}

/**
 * For playlist sources: drop synced-videos that are no longer in the playlist,
 * and deactivate linked show episodes that aren't in the current item set.
 */
async function pruneSourceToSyncedItems(
  strapi: any,
  source: { id: number; documentId: string },
  keepItems: Array<{ youtubeVideoId: string; mediaSourceId: number }>,
): Promise<number> {
  const keepVideoIds = new Set(keepItems.map((item) => item.youtubeVideoId).filter(Boolean))
  const keepMediaIds = new Set(
    keepItems.map((item) => item.mediaSourceId).filter((id) => typeof id === 'number'),
  )

  const linked = await strapi.db.query('api::synced-video.synced-video').findMany({
    where: { youtubeSource: source.id },
    limit: 5000,
  })

  let pruned = 0
  for (const row of linked || []) {
    const videoId = String(row.youtubeVideoId || '')
    if (videoId && keepVideoIds.has(videoId)) continue
    await strapi.db.query('api::synced-video.synced-video').delete({
      where: { id: row.id },
    })
    pruned += 1
  }

  const shows = await strapi.documents('api::show.show').findMany({
    filters: { youtubeSource: { id: source.id } },
    limit: 50,
  })

  for (const show of shows || []) {
    const episodes = await strapi.db.query('api::show-episode.show-episode').findMany({
      where: { show: show.id },
      limit: 5000,
    })
    for (const ep of episodes || []) {
      const mediaId =
        typeof ep.mediaSource === 'number'
          ? ep.mediaSource
          : ep.mediaSource && typeof ep.mediaSource === 'object'
            ? ep.mediaSource.id
            : null
      if (typeof mediaId !== 'number') continue
      const shouldBeActive = keepMediaIds.has(mediaId)
      if (shouldBeActive && ep.isActive === false) {
        await strapi.db.query('api::show-episode.show-episode').update({
          where: { id: ep.id },
          data: { isActive: true },
        })
      } else if (!shouldBeActive && ep.isActive !== false) {
        await strapi.db.query('api::show-episode.show-episode').update({
          where: { id: ep.id },
          data: { isActive: false },
        })
      }
    }
  }

  return pruned
}

export default ({ strapi }) => ({
  async upsertShowEpisodes(source: { id: number; documentId: string }, items: Array<{
    youtubeVideoId: string
    title: string
    description: string
    thumbnailUrl: string
    publishedAt: string
    durationSeconds?: number
    mediaSourceId: number
    playlistPosition?: number | null
  }>) {
    const shows = await strapi.documents('api::show.show').findMany({
      filters: { youtubeSource: { id: source.id } },
      limit: 50,
    })

    if (!shows?.length) {
      return { episodesCreated: 0, episodesUpdated: 0, episodesNumbered: 0 }
    }

    let episodesCreated = 0
    let episodesUpdated = 0
    let episodesNumbered = 0

    for (const show of shows) {
      for (const item of items) {
        const existingEpisodes = await strapi.db.query('api::show-episode.show-episode').findMany({
          where: {
            show: show.id,
            mediaSource: item.mediaSourceId,
          },
          limit: 1,
        })
        const existing = existingEpisodes?.[0]

        const episodeData = {
          title: item.title,
          description: item.description,
          durationSeconds: item.durationSeconds ?? null,
          isActive: true,
          mediaSource: item.mediaSourceId,
          show: show.id,
        }

        if (existing) {
          await strapi.db.query('api::show-episode.show-episode').update({
            where: { id: existing.id },
            data: {
              ...episodeData,
              // Repair rows imported before the publish-date fix. Only touch
              // already-published rows so drafts stay drafts.
              ...(existing.publishedAt && item.publishedAt
                ? { publishedAt: item.publishedAt }
                : {}),
            },
          })
          episodesUpdated += 1
        } else {
          const slug = await uniqueEpisodeSlug(strapi, slugify(item.title))
          await strapi.documents('api::show-episode.show-episode').create({
            data: {
              ...episodeData,
              slug,
              show: show.documentId,
              mediaSource: item.mediaSourceId,
              publishedAt: item.publishedAt || new Date().toISOString(),
            },
            status: 'published',
          })
          episodesCreated += 1
        }
      }

      episodesNumbered += await assignMissingEpisodeNumbers(strapi, show.id)
    }

    return { episodesCreated, episodesUpdated, episodesNumbered }
  },

  async syncSource(documentId: string) {
    const source = await strapi.documents('api::youtube-source.youtube-source').findOne({
      documentId,
    })
    if (!source) {
      throw new Error('YouTube source not found')
    }
    if (!source.active || !source.syncEnabled) {
      return { imported: 0, updated: 0, skipped: true }
    }

    const youtube = strapi.service('api::youtube-source.youtube')
    const normalizer = strapi.service('api::youtube-source.youtube-normalizer')

    // Persist cleaned IDs when editors pasted full YouTube URLs.
    const rawChannelId = String(source.channelId || '').trim()
    const cleaned = {
      playlistId: source.playlistId
        ? normalizeYoutubePlaylistId(source.playlistId)
        : source.playlistId,
      videoId: source.videoId ? normalizeYoutubeVideoId(source.videoId) : source.videoId,
      channelId: source.channelId
        ? normalizeYoutubeChannelId(source.channelId)
        : source.channelId,
      username: source.username ? normalizeYoutubeUsername(source.username) : source.username,
    }

    // Heal @handle URLs pasted into Channel ID — but never for playlist sources
    // (playlist sync must stay scoped to playlistId only).
    if (
      source.sourceType !== 'playlist' &&
      !cleaned.username &&
      rawChannelId &&
      !isYoutubeChannelId(rawChannelId)
    ) {
      const handleFromChannel = normalizeYoutubeUsername(rawChannelId)
      if (handleFromChannel) cleaned.username = handleFromChannel
    }

    const idPatch: Record<string, string | null> = {}
    for (const key of ['playlistId', 'videoId', 'channelId', 'username'] as const) {
      const next = cleaned[key] || null
      const prev = source[key] || null
      if (next !== prev) {
        idPatch[key] = next
        source[key] = next
      }
    }

    // If the declared type has no matching id, pick the best available type.
    // Prefer an explicit playlistId over channel/username so editors who only
    // paste a playlist stay on playlist sync.
    const inferredType = (() => {
      if (source.sourceType === 'playlist' && source.playlistId) return 'playlist'
      if (source.playlistId && source.sourceType !== 'channel' && source.sourceType !== 'username') {
        return 'playlist'
      }
      if (source.sourceType === 'channel' && isYoutubeChannelId(source.channelId)) return 'channel'
      if (source.sourceType === 'username' && source.username) return 'username'
      if (source.sourceType === 'video' && source.videoId) return 'video'
      if (source.playlistId) return 'playlist'
      if (isYoutubeChannelId(source.channelId)) return 'channel'
      if (source.username) return 'username'
      if (source.videoId) return 'video'
      return source.sourceType
    })()
    if (inferredType && inferredType !== source.sourceType) {
      idPatch.sourceType = inferredType
      source.sourceType = inferredType
    }

    // Playlist sources should not carry channel/username fields — those make it
    // look like a channel sync and confuse editors. Attribution still resolves
    // the owner channel in-memory below.
    if (source.sourceType === 'playlist') {
      if (source.channelId) {
        idPatch.channelId = null
        source.channelId = null
      }
      if (source.channelUrl) {
        idPatch.channelUrl = null
        source.channelUrl = null
      }
      if (source.username) {
        idPatch.username = null
        source.username = null
      }
    }

    if (Object.keys(idPatch).length) {
      await strapi.db.query('api::youtube-source.youtube-source').update({
        where: { id: source.id },
        data: idPatch,
      })
    }

    // Resolve playlist owner for traffic attribution only (do not persist on the source).
    let attributionChannelId = source.channelId || null
    let attributionChannelUrl = source.channelUrl || null
    let attributionChannelTitle: string | null = source.channelTitle || null
    if (source.sourceType === 'playlist' && source.playlistId) {
      try {
        const meta = await youtube.fetchPlaylistMeta(source.playlistId)
        if (meta?.channelId) {
          attributionChannelId = meta.channelId
          attributionChannelUrl = `https://www.youtube.com/channel/${meta.channelId}`
          attributionChannelTitle = meta.channelTitle || attributionChannelTitle
        }
      } catch (error) {
        strapi.log.warn(
          `Could not resolve playlist owner channel for ${source.playlistId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        )
      }
    }

    let items = []
    try {
      if (source.sourceType === 'playlist' && source.playlistId) {
        items = await youtube.fetchPlaylistVideos(source.playlistId)
      } else if (source.sourceType === 'channel' && source.channelId) {
        items = await youtube.fetchChannelUploads(source.channelId)
      } else if (source.sourceType === 'username' && source.username) {
        const channelId = await youtube.resolveChannelIdFromUsername(source.username)
        if (channelId && channelId !== source.channelId) {
          await strapi.db.query('api::youtube-source.youtube-source').update({
            where: { id: source.id },
            data: { channelId },
          })
          source.channelId = channelId
        }
        items = await youtube.fetchChannelUploads(channelId)
      } else if (source.sourceType === 'video' && source.videoId) {
        const one = await youtube.fetchVideo(source.videoId)
        items = one ? [one] : []
      } else {
        const type = String(source.sourceType || 'unknown')
        const hint =
          type === 'video'
            ? 'Set a Video ID, or change Source type to Username/Channel/Playlist.'
            : type === 'playlist'
              ? 'Set a Playlist ID.'
              : type === 'channel'
                ? 'Set a Channel ID (UC…).'
                : type === 'username'
                  ? 'Set a Username / @handle.'
                  : 'Check Source type and identifiers.'
        throw new Error(`Source is missing required identifiers for type “${type}”. ${hint}`)
      }
    } catch (error) {
      const message = formatSyncFailure(error)
      await strapi.db.query('api::youtube-source.youtube-source').update({
        where: { id: source.id },
        data: {
          lastSyncStatus: `error: ${message}`,
          lastSyncedAt: new Date().toISOString(),
        },
      })
      throw error
    }

    let imported = 0
    let updated = 0
    const upsertPayload: Array<{
      youtubeVideoId: string
      title: string
      description: string
      thumbnailUrl: string
      publishedAt: string
      durationSeconds?: number
      mediaSourceId: number
      playlistPosition?: number | null
    }> = []

    const attribution = {
      channelId: attributionChannelId,
      channelUrl: attributionChannelUrl,
      youtubeSourceDocumentId: source.documentId || null,
      youtubeSourceId: source.id ?? null,
    }

    // Keep the playlist/video catalogue media-source in sync with attribution.
    try {
      const { syncMediaSourceFromYoutubeSource } = await import(
        '../../../utils/youtube-media-source'
      )
      await syncMediaSourceFromYoutubeSource(strapi, {
        id: source.id,
        documentId: source.documentId,
        displayTitle: source.displayTitle,
        sourceType: source.sourceType,
        playlistId: source.playlistId,
        videoId: source.videoId,
        channelId: attributionChannelId,
        channelUrl: attributionChannelUrl,
        channelTitle: attributionChannelTitle,
      })
    } catch (error) {
      strapi.log.warn(
        `YouTube source media-source sync skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    for (const raw of items) {
      const normalized = normalizer.normalize(raw, attribution)
      const existing = await strapi.db.query('api::synced-video.synced-video').findOne({
        where: { youtubeVideoId: normalized.youtubeVideoId },
      })

      let mediaSourceId = existing?.mediaSource
      const mediaPayload = normalized.mediaSource

      if (mediaSourceId) {
        await strapi.db.query('api::media-source.media-source').update({
          where: { id: mediaSourceId },
          data: mediaPayload,
        })
      } else {
        const existingMedia = await strapi.db.query('api::media-source.media-source').findOne({
          where: {
            provider: 'youtube',
            externalId: normalized.youtubeVideoId,
          },
        })
        if (existingMedia) {
          mediaSourceId = existingMedia.id
          await strapi.db.query('api::media-source.media-source').update({
            where: { id: mediaSourceId },
            data: mediaPayload,
          })
        } else {
          const createdMedia = await strapi.db.query('api::media-source.media-source').create({
            data: mediaPayload,
          })
          mediaSourceId = createdMedia.id
        }
      }

      const videoData = {
        youtubeVideoId: normalized.youtubeVideoId,
        title: normalized.title,
        description: normalized.description,
        thumbnailUrl: normalized.thumbnailUrl,
        publishedAt: normalized.publishedAt,
        playlistPosition:
          typeof normalized.playlistPosition === 'number' ? normalized.playlistPosition : null,
        channelTitle: normalized.channelTitle,
        durationSeconds: normalized.durationSeconds,
        externalUrl: normalized.externalUrl,
        syncedAt: new Date().toISOString(),
        mediaSource: mediaSourceId,
        youtubeSource: source.id,
      }

      if (existing) {
        await strapi.db.query('api::synced-video.synced-video').update({
          where: { id: existing.id },
          data: videoData,
        })
        updated += 1
      } else {
        await strapi.db.query('api::synced-video.synced-video').create({
          data: videoData,
        })
        imported += 1
      }

      upsertPayload.push({
        youtubeVideoId: normalized.youtubeVideoId,
        title: normalized.title,
        description: normalized.description,
        thumbnailUrl: normalized.thumbnailUrl,
        publishedAt: normalized.publishedAt,
        durationSeconds: normalized.durationSeconds,
        mediaSourceId,
        playlistPosition:
          typeof normalized.playlistPosition === 'number' ? normalized.playlistPosition : null,
      })
    }

    const episodeResult = await this.upsertShowEpisodes(source, upsertPayload)

    let pruned = 0
    if (source.sourceType === 'playlist') {
      pruned = await pruneSourceToSyncedItems(strapi, source, upsertPayload)
    }

    const total = await strapi.db.query('api::synced-video.synced-video').count({
      where: { youtubeSource: source.id },
    })

    await strapi.db.query('api::youtube-source.youtube-source').update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'ok',
        videosImported: total,
      },
    })

    strapi.log.info(
      `YouTube sync complete for source ${documentId}: imported=${imported} updated=${updated} pruned=${pruned} episodesCreated=${episodeResult.episodesCreated} episodesUpdated=${episodeResult.episodesUpdated} episodesNumbered=${episodeResult.episodesNumbered}`,
    )

    return { imported, updated, pruned, total, ...episodeResult }
  },

  async syncShow(showDocumentId: string) {
    const show = await strapi.documents('api::show.show').findOne({
      documentId: showDocumentId,
      populate: ['youtubeSource'],
    })
    if (!show) {
      throw new Error('Show not found')
    }
    const source = show.youtubeSource
    if (!source?.documentId) {
      throw new Error('Show has no YouTube source configured')
    }
    return this.syncSource(source.documentId)
  },

  async syncAllEnabledSources() {
    const sources = await strapi.documents('api::youtube-source.youtube-source').findMany({
      filters: { active: true, syncEnabled: true },
      limit: 100,
    })
    const results = []
    for (const source of sources) {
      try {
        results.push({
          documentId: source.documentId,
          ...(await this.syncSource(source.documentId)),
        })
      } catch (error) {
        strapi.log.error(
          `YouTube sync failed for ${source.documentId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        )
        results.push({ documentId: source.documentId, error: true })
      }
    }

    // Fill any remaining null episodeNumbers (e.g. shows not touched by a source this run).
    try {
      const numbered = await backfillMissingEpisodeNumbers(strapi)
      if (numbered > 0) {
        strapi.log.info(`Episode number backfill assigned ${numbered} missing number(s)`)
      }
    } catch (error) {
      strapi.log.warn(
        `Episode number backfill failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }

    return results
  },
})
