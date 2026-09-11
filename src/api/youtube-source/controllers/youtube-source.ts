import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::youtube-source.youtube-source', ({ strapi }) => ({
  async sync(ctx) {
    const { documentId } = ctx.params
    if (!documentId) {
      return ctx.badRequest('documentId is required')
    }
    try {
      const result = await strapi.service('api::youtube-source.youtube-sync').syncSource(documentId)
      ctx.body = { data: result }
    } catch (error) {
      strapi.log.error(
        `Manual YouTube sync failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
      return ctx.internalServerError('Synchronization failed')
    }
  },

  async syncAll(ctx) {
    try {
      const results = await strapi.service('api::youtube-source.youtube-sync').syncAllEnabledSources()
      const failed = results.filter((row: { error?: boolean }) => row.error).length
      const synced = results.length - failed
      ctx.body = {
        data: {
          synced,
          failed,
          total: results.length,
          results,
        },
      }
    } catch (error) {
      strapi.log.error(
        `Manual YouTube sync-all failed: ${error instanceof Error ? error.message : 'unknown'}`,
      )
      return ctx.internalServerError('Synchronization failed')
    }
  },
}))
