import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::show.show', ({ strapi }) => ({
  async sync(ctx) {
    const { documentId } = ctx.params
    if (!documentId) {
      return ctx.badRequest('documentId is required')
    }
    try {
      const result = await strapi.service('api::youtube-source.youtube-sync').syncShow(documentId)
      ctx.body = { data: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      strapi.log.error(`Manual Show sync failed: ${message}`)
      if (message.includes('no YouTube source') || message.includes('not found')) {
        return ctx.badRequest(message)
      }
      return ctx.internalServerError('Synchronization failed')
    }
  },
}))
