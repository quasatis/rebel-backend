import { factories } from '@strapi/strapi'

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
  () => ({
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
      return super.create(ctx)
    },

    async update(ctx) {
      ensureProviderExternalKey(ctx.request.body as { data?: Record<string, unknown> })
      return super.update(ctx)
    },
  }),
)
