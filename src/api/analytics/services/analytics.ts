type TrafficRow = {
  eventType: string
  provider: string
  externalId: string
  channelId?: string | null
  channelTitle?: string | null
  contentSlug?: string | null
  watchedSeconds?: number | null
  progressPercent?: number | null
}

function groupKey(row: TrafficRow): string {
  const channelId = String(row.channelId || '').trim()
  if (channelId) return `channel:${row.provider}:${channelId}`
  return `media:${row.provider}:${row.externalId}`
}

function emptyBucket(row: TrafficRow) {
  const channelId = String(row.channelId || '').trim() || null
  return {
    key: groupKey(row),
    provider: row.provider,
    channelId,
    channelTitle:
      String(row.channelTitle || '').trim() ||
      (channelId ? channelId : row.externalId),
    contentViews: 0,
    embedImpressions: 0,
    plays: 0,
    outboundClicks: 0,
    watchProgressEvents: 0,
    watchedSecondsTotal: 0,
    maxProgressPercent: 0,
    videos: {} as Record<
      string,
      {
        externalId: string
        contentSlug: string | null
        contentViews: number
        embedImpressions: number
        plays: number
        outboundClicks: number
        watchedSecondsTotal: number
        maxProgressPercent: number
      }
    >,
  }
}

export default ({ strapi }) => ({
  async channelTraffic({
    from,
    to,
    channelKey,
  }: {
    from: string
    to: string
    channelKey?: string | null
  }) {
    const rows = (await strapi.db.query('api::media-traffic-event.media-traffic-event').findMany({
      where: {
        occurredAt: { $gte: from, $lte: to },
      },
      select: [
        'eventType',
        'provider',
        'externalId',
        'channelId',
        'channelTitle',
        'contentSlug',
        'watchedSeconds',
        'progressPercent',
      ],
      limit: 50_000,
      orderBy: { occurredAt: 'desc' },
    })) as TrafficRow[]

    // #region agent log
    try {
      const eventTypeCounts: Record<string, number> = {}
      const missingChannelId = (rows || []).filter((r) => !String(r?.channelId || '').trim()).length
      for (const r of rows || []) {
        const t = String(r?.eventType || 'unknown')
        eventTypeCounts[t] = (eventTypeCounts[t] || 0) + 1
      }
      const uniqueKeys = [
        ...new Set(
          (rows || [])
            .filter((r) => r?.provider && r.externalId && r.eventType)
            .map((r) => groupKey(r)),
        ),
      ]
      const skipped = (rows || []).filter((r) => !r?.provider || !r.externalId || !r.eventType).length
      fetch('http://host.docker.internal:7942/ingest/62e9c20b-80f7-427e-9c94-2f7fa55442a7', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '76e1cd',
        },
        body: JSON.stringify({
          sessionId: '76e1cd',
          hypothesisId: 'H1,H2,H3',
          location: 'analytics.ts:channelTraffic:afterFind',
          message: 'Raw traffic events loaded',
          data: {
            from,
            to,
            rowCount: (rows || []).length,
            skipped,
            missingChannelId,
            eventTypeCounts,
            uniqueGroupKeyCount: uniqueKeys.length,
            uniqueKeys: uniqueKeys.slice(0, 20),
            sample: (rows || []).slice(0, 8).map((r) => ({
              provider: r?.provider,
              externalId: r?.externalId,
              channelId: r?.channelId,
              channelTitle: r?.channelTitle,
              eventType: r?.eventType,
              groupKey: r ? groupKey(r) : null,
            })),
          },
          timestamp: Date.now(),
          runId: 'pre-fix',
        }),
      }).catch(() => {})
    } catch (_e) {}
    // #endregion

    const channels = new Map<string, ReturnType<typeof emptyBucket>>()

    for (const row of rows || []) {
      if (!row?.provider || !row.externalId || !row.eventType) continue
      const key = groupKey(row)
      if (channelKey && key !== channelKey) continue

      let bucket = channels.get(key)
      if (!bucket) {
        bucket = emptyBucket(row)
        channels.set(key, bucket)
      } else if (
        row.channelTitle &&
        (!bucket.channelTitle || bucket.channelTitle === bucket.channelId)
      ) {
        bucket.channelTitle = String(row.channelTitle)
      }

      const videoKey = row.externalId
      if (!bucket.videos[videoKey]) {
        bucket.videos[videoKey] = {
          externalId: row.externalId,
          contentSlug: row.contentSlug || null,
          contentViews: 0,
          embedImpressions: 0,
          plays: 0,
          outboundClicks: 0,
          watchedSecondsTotal: 0,
          maxProgressPercent: 0,
        }
      }
      const video = bucket.videos[videoKey]

      switch (row.eventType) {
        case 'content_view':
          bucket.contentViews += 1
          video.contentViews += 1
          break
        case 'embed_impression':
          bucket.embedImpressions += 1
          video.embedImpressions += 1
          break
        case 'play':
          bucket.plays += 1
          video.plays += 1
          break
        case 'outbound_click':
          bucket.outboundClicks += 1
          video.outboundClicks += 1
          break
        case 'watch_progress': {
          bucket.watchProgressEvents += 1
          // Final flush events omit progressPercent; milestones include it.
          // Only count seconds from flush events to avoid double-counting.
          if (row.progressPercent == null) {
            const seconds = Number(row.watchedSeconds || 0)
            if (seconds > 0) {
              bucket.watchedSecondsTotal += seconds
              video.watchedSecondsTotal += seconds
            }
          }
          const progress = Number(row.progressPercent || 0)
          if (progress > bucket.maxProgressPercent) bucket.maxProgressPercent = progress
          if (progress > video.maxProgressPercent) video.maxProgressPercent = progress
          break
        }
        default:
          break
      }
    }

    const channelList = [...channels.values()]
      .map((channel) => {
        const videos = Object.values(channel.videos)
          .sort(
            (a, b) =>
              b.outboundClicks + b.plays + b.embedImpressions -
              (a.outboundClicks + a.plays + a.embedImpressions),
          )
          .slice(0, 25)
        const { videos: _videos, ...rest } = channel
        return { ...rest, videos }
      })
      .sort(
        (a, b) =>
          b.outboundClicks + b.plays + b.embedImpressions -
          (a.outboundClicks + a.plays + a.embedImpressions),
      )

    // #region agent log
    try {
      fetch('http://host.docker.internal:7942/ingest/62e9c20b-80f7-427e-9c94-2f7fa55442a7', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '76e1cd',
        },
        body: JSON.stringify({
          sessionId: '76e1cd',
          hypothesisId: 'H1,H4,H5',
          location: 'analytics.ts:channelTraffic:beforeReturn',
          message: 'Aggregated channel traffic result',
          data: {
            channelCount: channelList.length,
            totalsPreview: {
              contentViews: channelList.reduce((sum, c) => sum + c.contentViews, 0),
              embedImpressions: channelList.reduce((sum, c) => sum + c.embedImpressions, 0),
              plays: channelList.reduce((sum, c) => sum + c.plays, 0),
              outboundClicks: channelList.reduce((sum, c) => sum + c.outboundClicks, 0),
            },
            channels: channelList.map((c) => ({
              key: c.key,
              provider: c.provider,
              channelId: c.channelId,
              channelTitle: c.channelTitle,
              videoCount: Array.isArray(c.videos) ? c.videos.length : 0,
              contentViews: c.contentViews,
              embedImpressions: c.embedImpressions,
              plays: c.plays,
              outboundClicks: c.outboundClicks,
            })),
          },
          timestamp: Date.now(),
          runId: 'pre-fix',
        }),
      }).catch(() => {})
    } catch (_e) {}
    // #endregion

    return {
      from,
      to,
      totals: {
        channels: channelList.length,
        contentViews: channelList.reduce((sum, c) => sum + c.contentViews, 0),
        embedImpressions: channelList.reduce((sum, c) => sum + c.embedImpressions, 0),
        plays: channelList.reduce((sum, c) => sum + c.plays, 0),
        outboundClicks: channelList.reduce((sum, c) => sum + c.outboundClicks, 0),
        watchedSecondsTotal: channelList.reduce((sum, c) => sum + c.watchedSecondsTotal, 0),
      },
      channels: channelList,
    }
  },
})
