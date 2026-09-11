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

export default ({ strapi }) => ({
  async upsertShowEpisodes(source: { id: number; documentId: string }, items: Array<{
    youtubeVideoId: string
    title: string
    description: string
    thumbnailUrl: string
    publishedAt: string
    durationSeconds?: number
    mediaSourceId: number
  }>) {
    const shows = await strapi.documents('api::show.show').findMany({
      filters: { youtubeSource: { id: source.id } },
      limit: 50,
    })

    if (!shows?.length) {
      return { episodesCreated: 0, episodesUpdated: 0 }
    }

    let episodesCreated = 0
    let episodesUpdated = 0

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
            data: episodeData,
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
    }

    return { episodesCreated, episodesUpdated }
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
      await strapi.db.query('api::youtube-source.youtube-source').update({
        where: { id: source.id },
        data: {
          lastSyncStatus: `error: ${error instanceof Error ? error.message : 'sync failed'}`,
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
    }> = []

    for (const raw of items) {
      const normalized = normalizer.normalize(raw)
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
      `YouTube sync complete for source ${documentId}: imported=${imported} updated=${updated} episodesCreated=${episodeResult.episodesCreated} episodesUpdated=${episodeResult.episodesUpdated}`,
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
    return results
  },
})
