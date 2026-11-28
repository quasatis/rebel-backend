import {
  isYoutubeChannelId,
  normalizeYoutubeChannelId,
  normalizeYoutubePlaylistId,
  normalizeYoutubeUsername,
  normalizeYoutubeVideoId,
} from '../../../utils/youtube-ids'
import { setDocumentPublishedAt } from '../../../utils/publish-date'
import {
  YOUTUBE_QUOTA_USER_MESSAGE,
  isYoutubeQuotaCircuitOpen,
  isYoutubeQuotaExceededError,
} from '../../../utils/youtube-quota'
import { isExcludedYoutubeVideoTitle, type YoutubeListItem } from './youtube'

type SyncReason = 'schedule' | 'manual'

function formatSyncFailure(error: unknown): string {
  if (isYoutubeQuotaExceededError(error)) return YOUTUBE_QUOTA_USER_MESSAGE
  const raw = error instanceof Error ? error.message : 'sync failed'
  if (/fetch failed/i.test(raw) || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(raw)) {
    return 'Could not reach YouTube API (network/DNS). Check YOUTUBE_API_KEY and outbound access from Strapi.'
  }
  return raw
}

function skipScheduledSyncReason(source: {
  syncFrequency?: string | null
  lastSyncedAt?: string | Date | null
  lastSyncStatus?: string | null
}): string | null {
  const freq = String(source.syncFrequency || 'hourly')
  if (freq === 'manual') return 'frequency-manual'
  const last = source.lastSyncedAt ? new Date(source.lastSyncedAt).getTime() : 0
  const ok = String(source.lastSyncStatus || '').startsWith('ok')
  if (!last || !ok) return null
  const age = Date.now() - last
  if (freq === 'daily' && age < 20 * 60 * 60 * 1000) return 'frequency-daily'
  if (freq === 'weekly' && age < 6.5 * 24 * 60 * 60 * 1000) return 'frequency-weekly'
  return null
}

function isQuotaPausedStatus(status: string): boolean {
  if (status === 'paused:quota' || status.startsWith('paused:quota')) return true
  return status.toLowerCase().startsWith('error') && /quota|exceeded your/i.test(status)
}

function wantsFullCatalogue(
  source: { videosImported?: number | null; lastSyncStatus?: string | null },
  reason: SyncReason,
): boolean {
  if (reason === 'manual') return true
  if (!Number(source.videosImported || 0)) return true
  const status = String(source.lastSyncStatus || '')
  // A quota pause stays on the public feed until the daily circuit closes
  // (midnight Pacific). `ok` / `ok:rss` already skip a full catalogue.
  if (isQuotaPausedStatus(status)) return !isYoutubeQuotaCircuitOpen()
  return !status.startsWith('ok')
}

async function enrichMissingVideoDetails(
  strapi: any,
  youtube: { enrichVideoDetails: (items: YoutubeListItem[]) => Promise<YoutubeListItem[]> },
  items: YoutubeListItem[],
): Promise<YoutubeListItem[]> {
  if (!items.length) return items
  const ids = items.map((item) => item.id)
  const existing = await strapi.db.query('api::synced-video.synced-video').findMany({
    where: { youtubeVideoId: { $in: ids } },
    select: ['youtubeVideoId', 'durationSeconds'],
    limit: ids.length,
  })
  const known = new Map(
    (existing || []).map((row: { youtubeVideoId?: string; durationSeconds?: number | null }) => [
      String(row.youtubeVideoId || ''),
      row,
    ]),
  )
  const need = items.filter((item) => {
    const row = known.get(item.id)
    return !row || row.durationSeconds == null
  })
  if (!need.length) return items
  try {
    const enriched = await youtube.enrichVideoDetails(need)
    const byId = new Map(enriched.map((item) => [item.id, item]))
    return items.map((item) => byId.get(item.id) || item)
  } catch (error) {
    if (isYoutubeQuotaExceededError(error)) return items
    throw error
  }
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

/** Draft copies of published shows — Document Service defaults to published-only. */
async function findShowsLinkedToSource(
  strapi: any,
  source: { documentId: string },
): Promise<Array<{ id: number; documentId: string }>> {
  const rows = await strapi.documents('api::show.show').findMany({
    filters: { youtubeSource: { documentId: source.documentId } },
    status: 'draft',
    limit: 50,
  })
  return (rows || []).filter((row: { documentId?: string }) => row?.documentId)
}

async function updateEpisodeVersions(
  strapi: any,
  documentId: string,
  data: Record<string, unknown>,
) {
  const rows: Array<{ id: number }> = await strapi.db.query('api::show-episode.show-episode').findMany({
    where: { documentId },
    select: ['id'],
  })
  for (const row of rows || []) {
    await strapi.db.query('api::show-episode.show-episode').update({
      where: { id: row.id },
      data,
    })
  }
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
 * Prefer YouTube release date (mediaSource.rawMeta.publishedAt), then CMS publishedAt.
 * Channel sync stamps episode.publishedAt to "now", so CMS dates alone are unreliable.
 */
function episodeReleaseMs(ep: {
  publishedAt?: string | Date | null
  createdAt?: string | Date | null
  mediaSource?:
    | number
    | {
        id?: number
        rawMeta?: { publishedAt?: unknown } | null
      }
    | null
}): number {
  const raw =
    ep.mediaSource && typeof ep.mediaSource === 'object'
      ? ep.mediaSource.rawMeta?.publishedAt
      : null
  const fromSource = typeof raw === 'string' ? raw.trim() : ''
  if (fromSource) {
    const ms = new Date(fromSource).getTime()
    if (Number.isFinite(ms)) return ms
  }
  const publishedRaw = ep.publishedAt || ep.createdAt
  const publishedAtMs = publishedRaw ? new Date(publishedRaw).getTime() : Number.POSITIVE_INFINITY
  return Number.isFinite(publishedAtMs) ? publishedAtMs : Number.POSITIVE_INFINITY
}

/**
 * Number episodes for a show by YouTube release date (oldest = EP 1, newest = highest).
 * Overwrites existing values so prior playlist-position / sync-stamp mistakes get repaired.
 */
async function assignMissingEpisodeNumbers(
  strapi: any,
  show: { id?: number; documentId?: string },
): Promise<number> {
  const showDocumentId = show?.documentId
  if (!showDocumentId) return 0

  const episodes = await strapi.documents('api::show-episode.show-episode').findMany({
    filters: { show: { documentId: showDocumentId } },
    status: 'draft',
    populate: ['mediaSource'],
    limit: 5000,
  })

  if (!episodes?.length) return 0

  type Sortable = {
    id: number
    documentId?: string
    episodeNumber: number | null
    publishedAtMs: number
    youtubePublishedAt: string | null
  }

  const sortable: Sortable[] = (episodes as Array<{
    id: number
    documentId?: string
    episodeNumber?: number | null
    publishedAt?: string | Date | null
    createdAt?: string | Date | null
    mediaSource?: {
      id?: number
      rawMeta?: { publishedAt?: unknown } | null
    } | null
  }>).map((ep) => {
    const raw =
      ep.mediaSource && typeof ep.mediaSource === 'object'
        ? ep.mediaSource.rawMeta?.publishedAt
        : null
    const youtubePublishedAt = typeof raw === 'string' && raw.trim() ? raw.trim() : null
    return {
      id: ep.id,
      documentId: ep.documentId,
      episodeNumber:
        typeof ep.episodeNumber === 'number' && Number.isFinite(ep.episodeNumber)
          ? ep.episodeNumber
          : null,
      publishedAtMs: episodeReleaseMs(ep),
      youtubePublishedAt,
    }
  })

  sortable.sort((a, b) => {
    if (a.publishedAtMs !== b.publishedAtMs) return a.publishedAtMs - b.publishedAtMs
    return a.id - b.id
  })

  let assigned = 0
  for (let i = 0; i < sortable.length; i += 1) {
    const next = i + 1
    const row = sortable[i]
    if (row.episodeNumber === next) continue
    if (row.documentId) {
      await updateEpisodeVersions(strapi, row.documentId, { episodeNumber: next })
    } else {
      await strapi.db.query('api::show-episode.show-episode').update({
        where: { id: row.id },
        data: { episodeNumber: next },
      })
    }
    assigned += 1
  }

  // Repair sync-stamped CMS publishedAt so API sorts match YouTube chronology.
  for (const row of sortable) {
    if (!row.youtubePublishedAt || !row.documentId) continue
    const ep = (episodes as Array<{ id: number; publishedAt?: string | Date | null; createdAt?: string | Date | null }>).find(
      (e) => e.id === row.id,
    )
    if (!ep) continue
    const cmsMs = ep.publishedAt ? new Date(ep.publishedAt).getTime() : NaN
    const createdMs = ep.createdAt ? new Date(ep.createdAt).getTime() : NaN
    const youtubeMs = row.publishedAtMs
    const looksLikeSyncStamp =
      Number.isFinite(cmsMs) &&
      Number.isFinite(createdMs) &&
      Math.abs(cmsMs - createdMs) < 5000
    const driftedFromYoutube =
      Number.isFinite(cmsMs) && Number.isFinite(youtubeMs) && Math.abs(cmsMs - youtubeMs) > 60_000
    if (looksLikeSyncStamp || driftedFromYoutube) {
      await setDocumentPublishedAt(
        strapi,
        'api::show-episode.show-episode',
        row.documentId,
        row.youtubePublishedAt,
      )
    }
  }

  return assigned
}

async function backfillMissingEpisodeNumbers(strapi: any): Promise<number> {
  const shows = await strapi.documents('api::show.show').findMany({
    status: 'draft',
    limit: 200,
  })
  let totalAssigned = 0
  for (const show of shows || []) {
    if (!show?.documentId) continue
    totalAssigned += await assignMissingEpisodeNumbers(strapi, show)
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

  const shows = await findShowsLinkedToSource(strapi, source)

  for (const show of shows || []) {
    const episodes = await strapi.documents('api::show-episode.show-episode').findMany({
      filters: { show: { documentId: show.documentId } },
      status: 'draft',
      populate: ['mediaSource'],
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
        if (ep.documentId) await updateEpisodeVersions(strapi, ep.documentId, { isActive: true })
      } else if (!shouldBeActive && ep.isActive !== false) {
        if (ep.documentId) await updateEpisodeVersions(strapi, ep.documentId, { isActive: false })
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
    const shows = await findShowsLinkedToSource(strapi, source)

    if (!shows?.length) {
      return { episodesCreated: 0, episodesUpdated: 0, episodesNumbered: 0 }
    }

    let episodesCreated = 0
    let episodesUpdated = 0
    let episodesNumbered = 0

    for (const show of shows) {
      for (const item of items) {
        const existingEpisodes = await strapi.documents('api::show-episode.show-episode').findMany({
          filters: {
            show: { documentId: show.documentId },
            mediaSource: { id: item.mediaSourceId },
          },
          status: 'draft',
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
          // YouTube is source of truth for synced episode title/description/duration.
          // Keep isActive as editor-owned (disable in CMS without unlinking the video).
          const patch: Record<string, unknown> = {
            title: item.title,
            description: item.description,
          }
          if (item.durationSeconds != null) {
            patch.durationSeconds = item.durationSeconds
          }
          if (existing.documentId) {
            await updateEpisodeVersions(strapi, existing.documentId, patch)
          }
          if (item.publishedAt && existing.documentId) {
            const cmsMs = existing.publishedAt ? new Date(existing.publishedAt).getTime() : NaN
            const createdMs = existing.createdAt ? new Date(existing.createdAt).getTime() : NaN
            const youtubeMs = new Date(item.publishedAt).getTime()
            const looksLikeSyncStamp =
              !Number.isFinite(cmsMs) ||
              (Number.isFinite(createdMs) && Math.abs(cmsMs - createdMs) < 5000)
            const drifted =
              Number.isFinite(cmsMs) &&
              Number.isFinite(youtubeMs) &&
              Math.abs(cmsMs - youtubeMs) > 60_000
            if (looksLikeSyncStamp || drifted) {
              await setDocumentPublishedAt(
                strapi,
                'api::show-episode.show-episode',
                existing.documentId,
                item.publishedAt,
              )
            }
          }
          episodesUpdated += 1
        } else {
          const slug = await uniqueEpisodeSlug(strapi, slugify(item.title))
          const created = await strapi.documents('api::show-episode.show-episode').create({
            data: {
              ...episodeData,
              slug,
              show: show.documentId,
              mediaSource: item.mediaSourceId,
            },
            status: 'published',
          })
          // create({ status: 'published' }) stamps publishedAt to "now"; overwrite with YouTube date.
          if (item.publishedAt && created?.documentId) {
            await setDocumentPublishedAt(
              strapi,
              'api::show-episode.show-episode',
              created.documentId,
              item.publishedAt,
            )
          }
          episodesCreated += 1
        }
      }

      episodesNumbered += await assignMissingEpisodeNumbers(strapi, show)
    }

    return { episodesCreated, episodesUpdated, episodesNumbered }
  },

  async syncSource(documentId: string, options?: { reason?: SyncReason }) {
    const reason: SyncReason = options?.reason === 'schedule' ? 'schedule' : 'manual'
    const source = await strapi.documents('api::youtube-source.youtube-source').findOne({
      documentId,
    })
    if (!source) {
      throw new Error('YouTube source not found')
    }
    if (!source.active || !source.syncEnabled) {
      return { imported: 0, updated: 0, skipped: true }
    }
    if (reason === 'schedule') {
      const skip = skipScheduledSyncReason(source)
      if (skip) {
        return { imported: 0, updated: 0, skipped: true, reason: skip }
      }
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
    const fullCatalogue = wantsFullCatalogue(source, reason)
    if (
      source.sourceType === 'playlist' &&
      source.playlistId &&
      fullCatalogue &&
      !isYoutubeQuotaCircuitOpen()
    ) {
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

    const missingIdentifiersError = () => {
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
      return new Error(`Source is missing required identifiers for type “${type}”. ${hint}`)
    }

    const loadFromRss = async (): Promise<YoutubeListItem[]> => {
      if (source.sourceType === 'playlist' && source.playlistId) {
        return youtube.fetchFeedVideos({ playlistId: source.playlistId })
      }
      if (source.sourceType === 'channel' && source.channelId) {
        return youtube.fetchFeedVideos({ channelId: source.channelId })
      }
      if (source.sourceType === 'username') {
        let channelId = source.channelId
        if (!channelId && source.username && !isYoutubeQuotaCircuitOpen()) {
          channelId = await youtube.resolveChannelIdFromUsername(source.username)
          if (channelId && channelId !== source.channelId) {
            await strapi.db.query('api::youtube-source.youtube-source').update({
              where: { id: source.id },
              data: { channelId },
            })
            source.channelId = channelId
          }
        }
        if (!channelId) {
          throw new Error('Username source has no channel ID for RSS fallback. Run a full sync after quota resets.')
        }
        return youtube.fetchFeedVideos({ channelId })
      }
      throw missingIdentifiersError()
    }

    const loadFromApi = async (): Promise<YoutubeListItem[]> => {
      if (source.sourceType === 'playlist' && source.playlistId) {
        return youtube.fetchPlaylistVideos(source.playlistId, { enrich: false })
      }
      if (source.sourceType === 'channel' && source.channelId) {
        return youtube.fetchChannelUploads(source.channelId, { enrich: false })
      }
      if (source.sourceType === 'username' && source.username) {
        const channelId = await youtube.resolveChannelIdFromUsername(source.username)
        if (channelId && channelId !== source.channelId) {
          await strapi.db.query('api::youtube-source.youtube-source').update({
            where: { id: source.id },
            data: { channelId },
          })
          source.channelId = channelId
        }
        return youtube.fetchChannelUploads(channelId, { enrich: false })
      }
      if (source.sourceType === 'video' && source.videoId) {
        const one = await youtube.fetchVideo(source.videoId)
        return one ? [one] : []
      }
      throw missingIdentifiersError()
    }

    let items: YoutubeListItem[] = []
    let catalogueComplete = false
    try {
      if (source.sourceType === 'video') {
        items = await loadFromApi()
        catalogueComplete = true
      } else if (fullCatalogue) {
        try {
          items = await loadFromApi()
          catalogueComplete = true
        } catch (error) {
          if (!isYoutubeQuotaExceededError(error)) throw error
          strapi.log.warn(
            `YouTube quota exceeded for ${documentId}; falling back to public RSS feed`,
          )
          items = await loadFromRss()
        }
      } else {
        items = await loadFromRss()
      }
      items = await enrichMissingVideoDetails(strapi, youtube, items)
    } catch (error) {
      const quota = isYoutubeQuotaExceededError(error)
      const message = formatSyncFailure(error)
      await strapi.db.query('api::youtube-source.youtube-source').update({
        where: { id: source.id },
        data: {
          // Quota is not a broken source. RSS success is recorded as ok:rss above;
          // a quota failure with no feed still must not stay an `error:` row.
          lastSyncStatus: quota ? 'paused:quota' : `error: ${message}`,
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
      if (isExcludedYoutubeVideoTitle(raw.title)) continue
      const normalized = normalizer.normalize(raw, attribution)
      const existing = await strapi.db.query('api::synced-video.synced-video').findOne({
        where: { youtubeVideoId: normalized.youtubeVideoId },
      })

      if (!catalogueComplete && existing) {
        if (
          normalized.durationSeconds != null &&
          existing.durationSeconds == null
        ) {
          await strapi.db.query('api::synced-video.synced-video').update({
            where: { id: existing.id },
            data: { durationSeconds: normalized.durationSeconds },
          })
          const mediaId =
            typeof existing.mediaSource === 'number'
              ? existing.mediaSource
              : existing.mediaSource?.id
          if (typeof mediaId === 'number') {
            await strapi.db.query('api::media-source.media-source').update({
              where: { id: mediaId },
              data: { durationSeconds: normalized.durationSeconds },
            })
          }
          updated += 1
        }
        continue
      }

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

      const videoData: Record<string, unknown> = {
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
      if (catalogueComplete) {
        videoData.playlistPosition =
          typeof normalized.playlistPosition === 'number' ? normalized.playlistPosition : null
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
    if (source.sourceType === 'playlist' && catalogueComplete) {
      pruned = await pruneSourceToSyncedItems(strapi, source, upsertPayload)
    }

    const total = await strapi.db.query('api::synced-video.synced-video').count({
      where: { youtubeSource: source.id },
    })

    await strapi.db.query('api::youtube-source.youtube-source').update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: catalogueComplete ? 'ok' : 'ok:rss',
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
      status: 'draft',
    })
    if (!show) {
      throw new Error('Show not found')
    }
    const source = show.youtubeSource
    if (!source?.documentId) {
      throw new Error('Show has no YouTube source configured')
    }
    return this.syncSource(source.documentId, { reason: 'manual' })
  },

  /** Repair episodeNumber (+ sync-stamped publishedAt) for every show without hitting YouTube. */
  async renumberAllEpisodes() {
    const updated = await backfillMissingEpisodeNumbers(strapi)
    return { updated }
  },

  async syncAllEnabledSources(options?: { reason?: SyncReason }) {
    const reason: SyncReason = options?.reason === 'manual' ? 'manual' : 'schedule'
    const sources = await strapi.documents('api::youtube-source.youtube-source').findMany({
      filters: { active: true, syncEnabled: true },
      limit: 100,
    })
    const results = []
    for (const source of sources) {
      try {
        results.push({
          documentId: source.documentId,
          ...(await this.syncSource(source.documentId, { reason })),
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

    // Renumber episodes by publishedAt (repairs playlist-position mistakes).
    try {
      const numbered = await backfillMissingEpisodeNumbers(strapi)
      if (numbered > 0) {
        strapi.log.info(`Episode number backfill updated ${numbered} episode(s)`)
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
