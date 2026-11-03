import { factories } from '@strapi/strapi'
import { enrichYoutubeMediaSourceData, refreshMediaSourceLiveStatus } from '../../../utils/enrich-youtube-media-source'
import { getCachedLiveStatus, setCachedLiveStatus } from '../../../utils/live-status-cache'

/**
 * Strapi 5 Document Service validates required fields before DB lifecycles run,
 * so providerExternalKey must be set here (not only in content-type lifecycles).
 */
function ensureProviderExternalKey(body: { data?: Record<string, unknown> } | undefined) {
  const data = body?.data
  if (!data) return
  const provider = data.provider != null ? String(data.provider).trim() : ''
  const externalId = data.externalId != null ? String(data.externalId).trim() : ''
  if (!provider || !externalId) return
  if (!data.providerExternalKey) {
    data.providerExternalKey = `${provider}:${externalId}`
  }
}

function truthyQuery(value: unknown): boolean {
  return value === true || value === 'true' || value === '1'
}

export default factories.createCoreController(
  'api::media-source.media-source',
  ({ strapi }) => ({
    async find(ctx) {
      const query = (ctx.query || {}) as Record<string, unknown>
      const excludeSyncedEpisodes = truthyQuery(query.excludeSyncedEpisodes)
      delete query.excludeSyncedEpisodes

      if (excludeSyncedEpisodes) {
        const notEpisodes = { origin: { $ne: 'synced-episode' } }
        const existing = query.filters
        query.filters =
          existing && typeof existing === 'object'
            ? { $and: [existing, notEpisodes] }
            : notEpisodes
      }

      return super.find(ctx)
    },

    async create(ctx) {
      const body = ctx.request.body as { data?: Record<string, unknown> }
      ensureProviderExternalKey(body)
      if (body.data && !body.data.origin) body.data.origin = 'manual'
      if (body.data) {
        body.data = await enrichYoutubeMediaSourceData(strapi, body.data)
        ensureProviderExternalKey(body)
      }
      return super.create(ctx)
    },

    async update(ctx) {
      const body = ctx.request.body as { data?: Record<string, unknown> }
      ensureProviderExternalKey(body)
      if (body?.data) {
        body.data = await enrichYoutubeMediaSourceData(strapi, body.data)
        ensureProviderExternalKey(body)
      }
      return super.update(ctx)
    },

    /**
     * Public live/premiere status for a media-source.
     * Refreshes from YouTube with a short in-memory cache (~30s per video id).
     */
    async liveStatus(ctx) {
      const documentId = String(ctx.params.documentId || ctx.params.id || '').trim()
      if (!documentId) {
        return ctx.badRequest('documentId is required')
      }

      const row = await strapi.db.query('api::media-source.media-source').findOne({
        where: { documentId },
        select: ['id', 'documentId', 'provider', 'externalId', 'title', 'thumbnailUrl', 'rawMeta'],
      })
      if (!row) {
        return ctx.notFound('Media source not found')
      }

      const externalId = String(row.externalId || '').trim()
      const cached = getCachedLiveStatus(externalId)
      if (cached) {
        ctx.body = { data: cached }
        return
      }

      try {
        const payload = await refreshMediaSourceLiveStatus(strapi, documentId)
        if (!payload) {
          return ctx.notFound('Media source not found')
        }
        setCachedLiveStatus(payload.externalId || externalId, payload)
        ctx.body = { data: payload }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to refresh live status'
        // Fall back to persisted rawMeta so FO countdown still works offline from YouTube.
        const meta =
          row.rawMeta && typeof row.rawMeta === 'object' && !Array.isArray(row.rawMeta)
            ? (row.rawMeta as Record<string, unknown>)
            : {}
        const liveBroadcastContent = ['live', 'upcoming'].includes(
          String(meta.liveBroadcastContent || '').toLowerCase(),
        )
          ? (String(meta.liveBroadcastContent).toLowerCase() as 'live' | 'upcoming')
          : 'none'
        const fallback = {
          liveBroadcastContent,
          scheduledStartTime: (meta.scheduledStartTime as string) || null,
          actualStartTime: (meta.actualStartTime as string) || null,
          actualEndTime: (meta.actualEndTime as string) || null,
          externalId,
          title: row.title || null,
          thumbnailUrl: row.thumbnailUrl || null,
          refreshedAt: new Date().toISOString(),
          warning: message,
        }
        setCachedLiveStatus(externalId, fallback)
        ctx.body = { data: fallback }
        strapi.log.warn(`media-source.liveStatus: ${message}`)
      }
    },
  }),
)
