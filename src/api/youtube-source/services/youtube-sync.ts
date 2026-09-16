import {
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
    const idPatch: Record<string, string | null> = {}
    for (const key of ['playlistId', 'videoId', 'channelId', 'username'] as const) {
      if (cleaned[key] && cleaned[key] !== source[key]) {
        idPatch[key] = cleaned[key]
        source[key] = cleaned[key]
      }
    }
    if (Object.keys(idPatch).length) {
      await strapi.db.query('api::youtube-source.youtube-source').update({
        where: { id: source.id },
        data: idPatch,
      })
    }

    // Playlist sources often have no channelId on create — resolve the owner so
    // media-source rawMeta and traffic events can roll up under a real channel.
    if (source.sourceType === 'playlist' && source.playlistId) {
      try {
        const meta = await youtube.fetchPlaylistMeta(source.playlistId)
        if (meta?.channelId) {
          const channelUrl =
            String(source.channelUrl || '').trim() ||
            `https://www.youtube.com/channel/${meta.channelId}`
          const patch: Record<string, string> = {}
          if (meta.channelId !== source.channelId) {
            patch.channelId = meta.channelId
            source.channelId = meta.channelId
          }
          if (channelUrl !== source.channelUrl) {
            patch.channelUrl = channelUrl
            source.channelUrl = channelUrl
          }
          if (Object.keys(patch).length) {
            await strapi.db.query('api::youtube-source.youtube-source').update({
              where: { id: source.id },
              data: patch,
            })
          }
          source.channelTitle = meta.channelTitle
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
        throw new Error('Source is missing required identifiers')
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
      channelId: source.channelId || null,
      channelUrl: source.channelUrl || null,
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
        channelId: source.channelId,
        channelUrl: source.channelUrl,
        channelTitle: source.channelTitle || null,
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
      `YouTube sync complete for source ${documentId}: imported=${imported} updated=${updated} episodesCreated=${episodeResult.episodesCreated} episodesUpdated=${episodeResult.episodesUpdated} episodesNumbered=${episodeResult.episodesNumbered}`,
    )

    return { imported, updated, total, ...episodeResult }
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
