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

export default factories.createCoreController(
  'api::media-source.media-source',
  () => ({
    async create(ctx) {
      ensureProviderExternalKey(ctx.request.body as { data?: Record<string, unknown> })
      return super.create(ctx)
    },

    async update(ctx) {
      ensureProviderExternalKey(ctx.request.body as { data?: Record<string, unknown> })
      return super.update(ctx)
    },
  }),
)
