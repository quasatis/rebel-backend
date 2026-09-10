export default ({ strapi }) => ({
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
      `YouTube sync complete for source ${documentId}: imported=${imported} updated=${updated}`,
    )

    return { imported, updated, total }
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
